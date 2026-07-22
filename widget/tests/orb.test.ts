// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mountShell } from "../src/dom";
import { wireOrb } from "../src/orb";
import { DEFAULTS } from "../src/config";

const cfg = { workerUrl: "https://w.test", ...DEFAULTS } as any;

describe("wireOrb", () => {
  it("toggles the panel open on orb click and closed on close button", () => {
    const refs = mountShell(cfg);
    const orb = wireOrb(refs);
    expect(orb.isOpen()).toBe(false);
    refs.orb.click();
    expect(refs.panel.getAttribute("data-open")).toBe("true");
    expect(orb.isOpen()).toBe(true);
    (refs.panel.querySelector(".close") as HTMLButtonElement).click();
    expect(refs.panel.getAttribute("data-open")).toBe("false");
  });

  it("setThinking swaps the orb state class", () => {
    const refs = mountShell(cfg);
    const orb = wireOrb(refs);
    orb.setThinking(true);
    expect(refs.orb.classList.contains("thinking")).toBe(true);
    expect(refs.orb.classList.contains("idle")).toBe(false);
    orb.setThinking(false);
    expect(refs.orb.classList.contains("idle")).toBe(true);
  });

  it("setListening and setSpeaking toggle the right classes, mutually exclusive with each other and thinking", () => {
    const refs = mountShell(cfg);
    const orb = wireOrb(refs);
    orb.setListening(true);
    expect(refs.orb.classList.contains("listening")).toBe(true);
    expect(refs.orb.classList.contains("idle")).toBe(false);
    orb.setSpeaking(true);
    expect(refs.orb.classList.contains("speaking")).toBe(true);
    expect(refs.orb.classList.contains("listening")).toBe(false);
    orb.setThinking(true);
    expect(refs.orb.classList.contains("thinking")).toBe(true);
    expect(refs.orb.classList.contains("speaking")).toBe(false);
    orb.setSpeaking(false);
    expect(refs.orb.classList.contains("idle")).toBe(false); // thinking is still active
    expect(refs.orb.classList.contains("thinking")).toBe(true);
  });
});
