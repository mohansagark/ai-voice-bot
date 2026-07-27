// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { mountShell } from "../src/dom";
import { wireOrb } from "../src/orb";
import { DEFAULTS } from "../src/config";

const cfg = { workerUrl: "https://w.test", ...DEFAULTS } as any;

describe("wireOrb", () => {
  it("toggles the panel open on orb click and closed on header click", () => {
    const refs = mountShell(cfg);
    const orb = wireOrb(refs);
    expect(orb.isOpen()).toBe(false);
    refs.orb.click();
    expect(refs.panel.getAttribute("data-open")).toBe("true");
    expect(orb.isOpen()).toBe(true);
    refs.header.click();
    expect(refs.panel.getAttribute("data-open")).toBe("false");
  });

  it("does not close when the header click actually landed on the sound toggle", () => {
    const refs = mountShell(cfg);
    const orb = wireOrb(refs);
    refs.orb.click();
    expect(orb.isOpen()).toBe(true);
    (refs.panel.querySelector(".sound") as HTMLButtonElement).click();
    expect(orb.isOpen()).toBe(true); // still open — sound toggle isn't a close gesture
  });

  it("closes when a click lands outside the widget host entirely", () => {
    const refs = mountShell(cfg);
    const orb = wireOrb(refs);
    refs.orb.click();
    expect(orb.isOpen()).toBe(true);
    document.body.click();
    expect(orb.isOpen()).toBe(false);
  });

  it("does not close on outside clicks while already closed (no-op)", () => {
    const refs = mountShell(cfg);
    const orb = wireOrb(refs);
    expect(orb.isOpen()).toBe(false);
    document.body.click();
    expect(orb.isOpen()).toBe(false);
  });

  it("open({ focus: false }) opens the panel without focusing the input; open() with no args still focuses it", () => {
    const refs = mountShell(cfg);
    const orb = wireOrb(refs);
    const focusSpy = vi.fn();
    refs.input.focus = focusSpy;

    orb.open({ focus: false });
    expect(refs.panel.getAttribute("data-open")).toBe("true");
    expect(focusSpy).not.toHaveBeenCalled();

    orb.close();
    orb.open();
    expect(refs.panel.getAttribute("data-open")).toBe("true");
    expect(focusSpy).toHaveBeenCalledTimes(1);
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
