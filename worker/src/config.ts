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
}

export interface Env {
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  WEBHOOK_URL?: string;
  ALLOWED_ORIGINS?: string;
  DEFAULT_PROVIDER?: string;
  MAX_MESSAGE_CHARS?: string;
  MAX_TURNS_PER_SESSION?: string;
}

export const defaultPersona: Persona = {
  botName: "Leo",
  owner: { name: "Mohan Sagar K", role: "Software Engineer" },
  bio: "Senior software engineer specializing in AI and frontend.",
  tone: "friendly, concise, professional",
  facts: [
    "Mohan specializes in ServiceNow and full-stack/AI development.",
    "Mohan is open to freelance and full-time opportunities.",
  ],
  do_not: ["quote prices", "commit to dates", "schedule meetings"],
};

export const providers: Record<string, ProviderConfig> = {
  groq: {
    model: "llama-3.3-70b-versatile",
    baseURL: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
  },
  gemini: { model: "gemini-2.0-flash", keyEnv: "GEMINI_API_KEY" },
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
  };
}

export type { Consent } from "./agent/state";
