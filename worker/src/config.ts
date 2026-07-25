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

export interface Env {
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  WEBHOOK_URL?: string;
  ALLOWED_ORIGINS?: string;
  DEFAULT_PROVIDER?: string;
  MAX_MESSAGE_CHARS?: string;
  MAX_TURNS_PER_SESSION?: string;
  MODE?: string;
  TTS_VOICE?: string;
  MAX_TTS_CHARS?: string;
  PERSONA_JSON?: string;
  SESSION_DO: DurableObjectNamespace;
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

export function loadPersona(env: Env): Persona {
  if (!env.PERSONA_JSON) return defaultPersona;
  try {
    const parsed = JSON.parse(env.PERSONA_JSON) as Partial<Persona>;
    return {
      ...defaultPersona,
      ...parsed,
      owner: { ...defaultPersona.owner, ...(parsed.owner ?? {}) },
    };
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

export type { Consent } from "./agent/state";
