// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { formatPreferredTime, buildInlineTimePicker } from "../src/slotpicker";

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

describe("buildInlineTimePicker", () => {
  it("renders a Cally calendar, a time input, and a disabled confirm button", () => {
    const el = buildInlineTimePicker(() => {});
    expect(el.className).toBe("inline-slotpicker");
    expect(el.querySelector(".slot-date")?.tagName.toLowerCase()).toBe("calendar-date");
    expect(el.querySelector(".slot-date calendar-month")).toBeTruthy();
    expect(el.querySelector(".slot-time")?.getAttribute("type")).toBe("time");
    expect((el.querySelector(".slot-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps confirm disabled until both a date and a time are chosen", () => {
    const el = buildInlineTimePicker(() => {});
    const dateEl = el.querySelector(".slot-date") as HTMLElement & { value: string };
    const timeEl = el.querySelector(".slot-time") as HTMLInputElement;
    const confirmBtn = el.querySelector(".slot-confirm") as HTMLButtonElement;

    timeEl.value = "09:00";
    timeEl.dispatchEvent(new Event("change"));
    expect(confirmBtn.disabled).toBe(true); // date still missing

    dateEl.value = "2026-08-05";
    dateEl.dispatchEvent(new Event("change"));
    expect(confirmBtn.disabled).toBe(false);
  });

  it("calls onConfirm with the formatted marker when both are set", () => {
    const onConfirm = vi.fn();
    const el = buildInlineTimePicker(onConfirm);
    const dateEl = el.querySelector(".slot-date") as HTMLElement & { value: string };
    const timeEl = el.querySelector(".slot-time") as HTMLInputElement;
    const confirmBtn = el.querySelector(".slot-confirm") as HTMLButtonElement;

    dateEl.value = "2026-12-25";
    dateEl.dispatchEvent(new Event("change"));
    timeEl.value = "18:00";
    timeEl.dispatchEvent(new Event("change"));
    confirmBtn.click();

    expect(onConfirm).toHaveBeenCalledWith("[Preferred time: Fri, Dec 25 — 6:00 PM]");
  });

  it("does nothing if confirm is somehow triggered without a full selection", () => {
    const onConfirm = vi.fn();
    const el = buildInlineTimePicker(onConfirm);
    const confirmBtn = el.querySelector(".slot-confirm") as HTMLButtonElement;
    confirmBtn.disabled = false; // bypass the UI guard to test the handler's own guard
    confirmBtn.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
