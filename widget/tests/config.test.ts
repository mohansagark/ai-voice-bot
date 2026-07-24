import { describe, it, expect, vi } from "vitest";
import { validateConfig, DEFAULTS } from "../src/config";

describe("validateConfig", () => {
  it("returns null and logs when workerUrl is missing", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(validateConfig({})).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("fills defaults around a provided workerUrl", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test" });
    expect(cfg).not.toBeNull();
    expect(cfg!.workerUrl).toBe("https://w.test");
    expect(cfg!.branding.botName).toBe(DEFAULTS.branding.botName);
    expect(cfg!.behavior.autoGreet).toBe(true);
  });

  it("merges user branding over defaults and ignores unknown keys", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test", branding: { botName: "Ari" }, voice: { x: 1 } } as any);
    expect(cfg!.branding.botName).toBe("Ari");
    expect(cfg!.branding.themeColor).toBe(DEFAULTS.branding.themeColor);
  });

  it("fills voice + language defaults", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test" });
    expect(cfg!.behavior.language).toBe("en-US");
    expect(cfg!.voice).toEqual({ enabled: true, ttsVoice: "troy", speakByDefault: false });
  });

  it("merges partial voice config over defaults", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test", voice: { ttsVoice: "hannah" } } as any);
    expect(cfg!.voice.ttsVoice).toBe("hannah");
    expect(cfg!.voice.enabled).toBe(true);
  });

  it("themeColorSecondary defaults to the default themeColor when neither is provided", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test" });
    expect(cfg!.branding.themeColorSecondary).toBe(DEFAULTS.branding.themeColor);
  });

  it("themeColorSecondary follows a custom themeColor when only themeColor is provided (stays a solid color)", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test", branding: { themeColor: "#ff0000" } } as any);
    expect(cfg!.branding.themeColor).toBe("#ff0000");
    expect(cfg!.branding.themeColorSecondary).toBe("#ff0000");
  });

  it("honors an explicit themeColorSecondary independent of themeColor", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test", branding: { themeColor: "#8750f7", themeColorSecondary: "#ff6fb0" } } as any);
    expect(cfg!.branding.themeColor).toBe("#8750f7");
    expect(cfg!.branding.themeColorSecondary).toBe("#ff6fb0");
  });
});
