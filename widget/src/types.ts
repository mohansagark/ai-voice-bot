export interface WidgetConfig {
  workerUrl: string;
  branding: { botName: string; themeColor: string; position: "bottom-right" | "bottom-left"; greeting: string };
  behavior: { autoGreet: boolean; rememberReturning: boolean };
  privacy: { consentText: string; privacyPolicyUrl: string | null };
  advanced: { analyticsCallback: ((event: string, payload?: unknown) => void) | null };
}
export type RawConfig = Partial<{
  workerUrl: string;
  branding: Partial<WidgetConfig["branding"]>;
  behavior: Partial<WidgetConfig["behavior"]>;
  privacy: Partial<WidgetConfig["privacy"]>;
  advanced: Partial<WidgetConfig["advanced"]>;
}>;
