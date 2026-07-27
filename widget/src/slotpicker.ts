import type { Refs } from "./dom";

// dateStr: Cally's <calendar-date> value, "YYYY-MM-DD". timeStr: native <input type="time"> value, "HH:MM" (24h).
export function formatPreferredTime(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, min] = timeStr.split(":").map(Number);
  const date = new Date(y, m - 1, d, h, min);
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `[Preferred time: ${weekday}, ${month} ${d} — ${time}]`;
}

export function wireSlotPicker(refs: Refs, onConfirm: (formatted: string) => void) {
  const updateConfirmState = () => {
    refs.slotConfirm.disabled = !(refs.slotDate.value && refs.slotTime.value);
  };

  const closePicker = () => {
    refs.slotPicker.setAttribute("hidden", "");
    refs.slotToggle.setAttribute("aria-pressed", "false");
  };

  refs.slotToggle.addEventListener("click", () => {
    const isOpen = !refs.slotPicker.hasAttribute("hidden");
    if (isOpen) { closePicker(); return; }
    refs.slotPicker.removeAttribute("hidden");
    refs.slotToggle.setAttribute("aria-pressed", "true");
  });

  refs.slotDate.addEventListener("change", updateConfirmState);
  refs.slotTime.addEventListener("change", updateConfirmState);

  refs.slotConfirm.addEventListener("click", () => {
    if (!refs.slotDate.value || !refs.slotTime.value) return;
    onConfirm(formatPreferredTime(refs.slotDate.value, refs.slotTime.value));
    closePicker();
  });
}
