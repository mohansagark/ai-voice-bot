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
  SESSION_DO: DurableObjectNamespace;
}

export const defaultPersona: Persona = {
  botName: "Leo",
  owner: { name: "Mohan", role: "Software Engineer" },
  bio: "Senior software engineer specializing in AI and frontend.",
  tone: "playful, warm, and a little cheeky — a witty friend hyping Mohan up, never a corporate bio",
  facts: [
    "Mohan is a sharp, hands-on problem-solver who genuinely lights up when something is broken and needs fixing.",
    "He works across AI and full-stack development, with deep ServiceNow experience.",
    "He is open to freelance projects and full-time roles — and loves a meaty technical challenge.",
  ],
  do_not: ["quote prices", "commit to dates", "schedule meetings"],
};

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
    persona: defaultPersona,
    allowedOrigins: (env.ALLOWED_ORIGINS || "")
      .split(",").map((s) => s.trim()).filter(Boolean),
    maxMessageChars: Number(env.MAX_MESSAGE_CHARS || "2000"),
    maxTurnsPerSession: Number(env.MAX_TURNS_PER_SESSION || "30"),
    mode: env.MODE === "dev" ? "dev" : "prod",
    ttsVoice: env.TTS_VOICE || "Fritz-PlayAI",
    maxTtsChars: Number(env.MAX_TTS_CHARS || "1200"),
  };
}

export type { Consent } from "./agent/state";
