export interface WidgetConfig {
  workerUrl: string;
  branding: { botName: string; themeColor: string; themeColorSecondary: string; position: "bottom-right" | "bottom-left"; greeting: string };
  behavior: { autoGreet: boolean; rememberReturning: boolean; language: string };
  privacy: { consentText: string; privacyPolicyUrl: string | null };
  advanced: { analyticsCallback: ((event: string, payload?: unknown) => void) | null };
  voice: { enabled: boolean; ttsVoice: string; speakByDefault: boolean };
}
export type RawConfig = Partial<{
  workerUrl: string;
  branding: Partial<WidgetConfig["branding"]>;
  behavior: Partial<WidgetConfig["behavior"]>;
  privacy: Partial<WidgetConfig["privacy"]>;
  advanced: Partial<WidgetConfig["advanced"]>;
  voice: Partial<WidgetConfig["voice"]>;
}>;
