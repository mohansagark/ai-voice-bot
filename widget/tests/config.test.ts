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
});
