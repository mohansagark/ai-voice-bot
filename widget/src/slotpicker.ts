import "cally"; // registers the <calendar-date>/<calendar-month> custom elements

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

// Builds a fresh inline date/time picker — the agent triggers this via a tool call (no
// header button), so a new instance is created per occurrence rather than a fixed element.
export function buildInlineTimePicker(onConfirm: (formatted: string) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "inline-slotpicker";
  wrap.innerHTML = `
    <calendar-date class="slot-date" aria-label="Preferred date">
      <calendar-month></calendar-month>
    </calendar-date>
    <input type="time" class="slot-time" aria-label="Preferred time" />
    <button type="button" class="slot-confirm" disabled>Use this time</button>
  `;
  const dateEl = wrap.querySelector(".slot-date") as HTMLElement & { value: string };
  const timeEl = wrap.querySelector(".slot-time") as HTMLInputElement;
  const confirmBtn = wrap.querySelector(".slot-confirm") as HTMLButtonElement;

  const updateConfirmState = () => {
    confirmBtn.disabled = !(dateEl.value && timeEl.value);
  };
  dateEl.addEventListener("change", updateConfirmState);
  timeEl.addEventListener("change", updateConfirmState);
  confirmBtn.addEventListener("click", () => {
    if (!dateEl.value || !timeEl.value) return;
    onConfirm(formatPreferredTime(dateEl.value, timeEl.value));
  });

  return wrap;
}
