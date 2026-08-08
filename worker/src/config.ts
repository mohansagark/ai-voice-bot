export interface Persona {
  botName: string;                       // visitor-facing name the bot goes by (configurable)
  owner: { name: string; role: string };
  bio: string;
  tone: string;
  facts: string[];
  do_not: string[];
}

export interface ProviderConfig { model: string; baseURL?: string; keyEnv: string; }

export interface AppConfig {
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
  persona: Persona;
  allowedOrigins: string[];
  maxMessageChars: number;
  maxTurnsPerSession: number;
  mode: "dev" | "prod";
  ttsVoice: string;
  maxTtsChars: number;
}

/** Site config blob stored in PORTFOLIO_KV under key `app_config` (synced at deploy time). */
export interface KvAppConfig {
  allowedOrigins?: string[];
  persona?: Partial<Persona> & { owner?: Partial<Persona["owner"]> };
  behavior?: {
    maxMessageChars?: number;
    maxTurnsPerSession?: number;
    ttsVoice?: string;
    maxTtsChars?: number;
    defaultProvider?: string;
    mode?: "dev" | "prod";
  };
  widget?: Record<string, unknown>;
}

export interface Env {
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  // Fallback TTS provider — used only when Groq's TTS call fails (rate limit, outage, etc.).
  DEEPGRAM_API_KEY?: string;
  // Fallback chat provider — used only when Groq's chat call fails (rate limit, outage, etc.).
  OPENROUTER_API_KEY?: string;
  ALLOWED_ORIGINS?: string;
  DEFAULT_PROVIDER?: string;
  MAX_MESSAGE_CHARS?: string;
  MAX_TURNS_PER_SESSION?: string;
  MODE?: string;
  TTS_VOICE?: string;
  MAX_TTS_CHARS?: string;
  PERSONA_JSON?: string;
  SESSION_DO: DurableObjectNamespace;

  // v0.3 — leads
  LEAD_NOTIFY_FROM?: string;
  LEAD_NOTIFY_TO?: string;
  DB?: D1Database;
  // Resend API key for lead notification emails — not Cloudflare Email Sending, which is
  // gated behind the Workers Paid plan.
  RESEND_API_KEY?: string;
  // Optional, deployment-specific: portfolio knowledge (`context`) + site app config
  // (`app_config`) live in KV so the shared worker repo stays free of personal SoT data.
  PORTFOLIO_KV?: { get(key: string): Promise<string | null> };
}

export const defaultPersona: Persona = {
  botName: "Leo",
  owner: { name: "Alex", role: "Software Engineer" },
  bio: "A software engineer who enjoys building things and solving interesting problems.",
  tone: "warm, a little playful, and genuinely curious — a friendly guide, never a corporate bio",
  facts: [
    "Alex works across full-stack development and enjoys tackling hard technical problems.",
    "Alex is open to freelance projects and full-time roles.",
  ],
  do_not: ["quote prices", "commit to dates", "schedule meetings"],
};

export function mergePersona(base: Persona, override?: Partial<Persona> & { owner?: Partial<Persona["owner"]> }): Persona {
  if (!override) return base;
  return {
    ...base,
    ...override,
    owner: { ...base.owner, ...(override.owner ?? {}) },
  };
}

export function loadPersona(env: Env): Persona {
  if (!env.PERSONA_JSON) return defaultPersona;
  try {
    const parsed = JSON.parse(env.PERSONA_JSON) as Partial<Persona>;
    return mergePersona(defaultPersona, parsed);
  } catch {
    return defaultPersona;
  }
}

export const providers: Record<string, ProviderConfig> = {
  groq: {
    model: "llama-3.3-70b-versatile",
    baseURL: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
  },
  // Google's OpenAI-compatible endpoint, so buildModel's ChatOpenAI client can target Gemini.
  gemini: { model: "gemini-2.0-flash", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", keyEnv: "GEMINI_API_KEY" },
  // Cross-vendor fallback for /chat — a free OpenRouter model, used only when Groq fails.
  openrouter: {
    model: "nvidia/nemotron-3-super-120b-a12b:free",
    baseURL: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
  },
};

export function loadConfig(env: Env): AppConfig {
  return {
    defaultProvider: env.DEFAULT_PROVIDER || "groq",
    providers,
    persona: loadPersona(env),
    allowedOrigins: (env.ALLOWED_ORIGINS || "")
      .split(",").map((s) => s.trim()).filter(Boolean),
    maxMessageChars: Number(env.MAX_MESSAGE_CHARS || "2000"),
    maxTurnsPerSession: Number(env.MAX_TURNS_PER_SESSION || "30"),
    mode: env.MODE === "dev" ? "dev" : "prod",
    ttsVoice: env.TTS_VOICE || "hannah",
    maxTtsChars: Number(env.MAX_TTS_CHARS || "1200"),
  };
}

/** Overlay synced KV `app_config` on top of env-derived config. KV wins for app fields. */
export function applyKvAppConfig(base: AppConfig, raw: KvAppConfig | null | undefined): AppConfig {
  if (!raw || typeof raw !== "object") return base;
  const b = raw.behavior ?? {};
  return {
    ...base,
    persona: mergePersona(base.persona, raw.persona),
    allowedOrigins: Array.isArray(raw.allowedOrigins) && raw.allowedOrigins.length
      ? raw.allowedOrigins.map((s) => String(s).trim()).filter(Boolean)
      : base.allowedOrigins,
    maxMessageChars: b.maxMessageChars ?? base.maxMessageChars,
    maxTurnsPerSession: b.maxTurnsPerSession ?? base.maxTurnsPerSession,
    ttsVoice: b.ttsVoice ?? base.ttsVoice,
    maxTtsChars: b.maxTtsChars ?? base.maxTtsChars,
    defaultProvider: b.defaultProvider ?? base.defaultProvider,
    mode: b.mode === "dev" || b.mode === "prod" ? b.mode : base.mode,
  };
}

export async function mergeKvAppConfig(env: Env, base: AppConfig): Promise<AppConfig> {
  if (!env.PORTFOLIO_KV) return base;
  try {
    const raw = await env.PORTFOLIO_KV.get("app_config");
    if (!raw) return base;
    return applyKvAppConfig(base, JSON.parse(raw) as KvAppConfig);
  } catch (e) {
    console.error("PORTFOLIO_KV app_config read failed (continuing with env/defaults):", String((e as Error).message));
    return base;
  }
}

export type { Consent } from "./agent/state";
