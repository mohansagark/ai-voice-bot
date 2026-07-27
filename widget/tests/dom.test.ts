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

  it("mounts an avatar badge with the bot-glyph icon in the header", () => {
    const refs = mountShell(cfg);
    expect(refs.avatar).toBeTruthy();
    expect(refs.shadow.contains(refs.avatar)).toBe(true);
    expect(refs.avatar.querySelector("svg.orb-icon")).toBeTruthy();
  });

  it("mounts mic visual elements (halo + 3 bars) and a 24-bar input waveform, inside the shadow root", () => {
    const refs = mountShell(cfg);
    expect(refs.micHalo).toBeTruthy();
    expect(refs.micBars).toBeTruthy();
    expect(refs.waveform).toBeTruthy();
    expect(refs.shadow.contains(refs.micHalo)).toBe(true);
    expect(refs.shadow.contains(refs.waveform)).toBe(true);
    expect(refs.micBars.querySelectorAll("span").length).toBe(3);
    expect(refs.waveform.querySelectorAll("span").length).toBe(24);
  });

  it("renders the Send button as an icon only, no text label", () => {
    const refs = mountShell(cfg);
    const send = refs.form.querySelector("button[type=submit]")!;
    expect(send.querySelector("svg")).toBeTruthy();
    expect(send.textContent?.trim()).toBe("");
  });

  it("mounts a slot-time picker (toggle, Cally calendar, time input, confirm), hidden by default", () => {
    const refs = mountShell(cfg);
    expect(refs.shadow.contains(refs.slotToggle)).toBe(true);
    expect(refs.shadow.contains(refs.slotPicker)).toBe(true);
    expect(refs.slotPicker.hasAttribute("hidden")).toBe(true);
    expect(refs.slotDate.tagName.toLowerCase()).toBe("calendar-date");
    expect(refs.slotDate.querySelector("calendar-month")).toBeTruthy();
    expect(refs.slotTime.getAttribute("type")).toBe("time");
    expect(refs.slotConfirm.disabled).toBe(true);
  });
});
