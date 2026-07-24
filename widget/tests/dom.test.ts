// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mountShell } from "../src/dom";
import { DEFAULTS } from "../src/config";

const cfg = { workerUrl: "https://w.test", ...DEFAULTS } as any;

describe("mountShell", () => {
  it("mounts an orb + hidden panel inside a shadow root", () => {
    const refs = mountShell(cfg);
    expect(refs.shadow).toBeTruthy();
    expect(refs.orb).toBeTruthy();
    expect(refs.panel).toBeTruthy();
    // panel hidden initially
    expect(refs.panel.getAttribute("data-open")).toBe("false");
    // orb + panel live under the shadow root, not the light DOM
    expect(refs.shadow.contains(refs.orb)).toBe(true);
    expect(document.body.contains(refs.host)).toBe(true);
  });

  it("does not leak styles to the document (styles live in the shadow root)", () => {
    mountShell(cfg);
    // No <style> was added to the document head by the widget.
    expect(document.head.querySelector("style[data-avb]")).toBeNull();
  });

  it("mounts a mic button and a sound toggle inside the shadow root", () => {
    const refs = mountShell(cfg);
    expect(refs.mic).toBeTruthy();
    expect(refs.sound).toBeTruthy();
    expect(refs.shadow.contains(refs.mic)).toBe(true);
    expect(refs.shadow.contains(refs.sound)).toBe(true);
    expect(refs.mic.getAttribute("type")).toBe("button");
    expect(refs.sound.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders a bot-glyph SVG icon in the orb instead of an emoji", () => {
    const refs = mountShell(cfg);
    expect(refs.orb.querySelector("svg.orb-icon")).toBeTruthy();
    expect(refs.orb.textContent?.trim()).toBe(""); // no emoji text content anymore
  });
});
