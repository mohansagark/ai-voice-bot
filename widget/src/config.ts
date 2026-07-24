import type { WidgetConfig, RawConfig } from "./types";

export const DEFAULTS: Omit<WidgetConfig, "workerUrl"> = {
  branding: { botName: "Leo", themeColor: "#6C5CE7", themeColorSecondary: "#6C5CE7", position: "bottom-right", greeting: "Hi, I'm Leo — how can I help?" },
  behavior: { autoGreet: true, rememberReturning: true, language: "en-US", proactiveGreet: true },
  privacy: { consentText: "I agree to share my info so I can be followed up with.", privacyPolicyUrl: null },
  advanced: { analyticsCallback: null },
  voice: { enabled: true, ttsVoice: "hannah", speakByDefault: false },
};

export function validateConfig(raw: unknown): WidgetConfig | null {
  const r = (raw ?? {}) as RawConfig;
  if (!r.workerUrl || typeof r.workerUrl !== "string") {
    console.error("[ai-voice-bot] window.AiVoiceBotConfig.workerUrl is required — widget not mounted.");
    return null;
  }
  return {
    workerUrl: r.workerUrl.replace(/\/+$/, ""),
    branding: {
      ...DEFAULTS.branding,
      ...(r.branding ?? {}),
      themeColorSecondary: r.branding?.themeColorSecondary ?? r.branding?.themeColor ?? DEFAULTS.branding.themeColorSecondary,
    },
    behavior: { ...DEFAULTS.behavior, ...(r.behavior ?? {}) },
    privacy: { ...DEFAULTS.privacy, ...(r.privacy ?? {}) },
    advanced: { ...DEFAULTS.advanced, ...(r.advanced ?? {}) },
    voice: { ...DEFAULTS.voice, ...(r.voice ?? {}) },
  };
}
