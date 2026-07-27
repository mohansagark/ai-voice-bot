// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { mountShell } from "../src/dom";
import { formatPreferredTime, wireSlotPicker } from "../src/slotpicker";
import { DEFAULTS } from "../src/config";

const cfg = { workerUrl: "https://w.test", ...DEFAULTS } as any;

describe("formatPreferredTime", () => {
  it("formats a date + time into the bracketed marker", () => {
    // 2026-08-05 is a Wednesday.
    expect(formatPreferredTime("2026-08-05", "14:30")).toBe("[Preferred time: Wed, Aug 5 — 2:30 PM]");
  });

  it("formats midnight/noon boundaries in 12h form", () => {
    expect(formatPreferredTime("2026-08-05", "00:00")).toBe("[Preferred time: Wed, Aug 5 — 12:00 AM]");
    expect(formatPreferredTime("2026-08-05", "12:00")).toBe("[Preferred time: Wed, Aug 5 — 12:00 PM]");
  });
});

describe("wireSlotPicker", () => {
  it("toggles the picker open and closed via the toggle button", () => {
    const refs = mountShell(cfg);
    wireSlotPicker(refs, () => {});
    expect(refs.slotPicker.hasAttribute("hidden")).toBe(true);
    refs.slotToggle.click();
    expect(refs.slotPicker.hasAttribute("hidden")).toBe(false);
    expect(refs.slotToggle.getAttribute("aria-pressed")).toBe("true");
    refs.slotToggle.click();
    expect(refs.slotPicker.hasAttribute("hidden")).toBe(true);
    expect(refs.slotToggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps confirm disabled until both a date and a time are chosen", () => {
    const refs = mountShell(cfg);
    wireSlotPicker(refs, () => {});
    refs.slotToggle.click();
    expect(refs.slotConfirm.disabled).toBe(true);
    refs.slotTime.value = "09:00";
    refs.slotTime.dispatchEvent(new Event("change"));
    expect(refs.slotConfirm.disabled).toBe(true); // date still missing
    refs.slotDate.value = "2026-08-05";
    refs.slotDate.dispatchEvent(new Event("change"));
    expect(refs.slotConfirm.disabled).toBe(false);
  });

  it("calls onConfirm with the formatted marker and closes the picker", () => {
    const refs = mountShell(cfg);
    const onConfirm = vi.fn();
    wireSlotPicker(refs, onConfirm);
    refs.slotToggle.click();
    refs.slotDate.value = "2026-12-25";
    refs.slotDate.dispatchEvent(new Event("change"));
    refs.slotTime.value = "18:00";
    refs.slotTime.dispatchEvent(new Event("change"));
    refs.slotConfirm.click();
    expect(onConfirm).toHaveBeenCalledWith("[Preferred time: Fri, Dec 25 — 6:00 PM]");
    expect(refs.slotPicker.hasAttribute("hidden")).toBe(true);
  });

  it("does nothing if confirm is somehow triggered without a full selection", () => {
    const refs = mountShell(cfg);
    const onConfirm = vi.fn();
    wireSlotPicker(refs, onConfirm);
    refs.slotConfirm.disabled = false; // bypass the UI guard to test the handler's own guard
    refs.slotConfirm.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
