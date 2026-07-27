import type { Refs } from "./dom";
import type { WidgetConfig } from "./types";
import { buildInlineTimePicker } from "./slotpicker";

export function shouldPinToBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold = 32): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function wirePanel(refs: Refs) {
  const isPinned = () => shouldPinToBottom(refs.list.scrollHeight, refs.list.scrollTop, refs.list.clientHeight);
  const scrollToBottom = () => { refs.list.scrollTop = refs.list.scrollHeight; };

  const line = (cls: string, text = ""): HTMLElement => {
    const pin = cls === "user" || isPinned();
    const d = document.createElement("div");
    d.className = `msg ${cls} msg-enter`;
    const body = document.createElement("span");
    body.className = "msg-text";
    if (cls === "bot" && !text) {
      body.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
    } else {
      body.textContent = text;
    }
    d.appendChild(body);
    refs.list.appendChild(d);
    if (pin) scrollToBottom();
    return d;
  };
  return {
    addUser: (text: string) => void line("user", text),
    startBot: (): HTMLElement => line("bot", ""),
    startBotText: (text: string) => void line("bot", text),
    appendBot: (el: HTMLElement, text: string) => {
      const pin = isPinned();
      const body = el.querySelector(".msg-text")!;
      body.textContent = (body.textContent ?? "") + text;
      if (pin) scrollToBottom();
    },
    endBot: (el: HTMLElement, finalText?: string) => {
      const pin = isPinned();
      const body = el.querySelector(".msg-text")!;
      if (finalText) body.textContent = finalText;
      else if (!body.textContent) body.textContent = "…";
      if (pin) scrollToBottom();
    },
    note: (text: string) => void line("note", text),
    showError: () => void line("bot", "Hmm, something hiccuped — mind trying that again?"),
    showLimitReached: () => void line("bot", "We've covered a lot today — I need to recharge! Thanks so much for stopping by, and come back again soon."),
    showTimePicker: (onConfirm: (formatted: string) => void) => {
      const pin = isPinned();
      const wrap = document.createElement("div");
      wrap.className = "msg bot msg-enter";
      // Hide, don't remove: disconnecting a Cally custom element from the DOM has been
      // observed to hang under some test/runtime environments (its custom-element teardown
      // lifecycle) — hiding sidesteps that entirely and is visually equivalent.
      const picker = buildInlineTimePicker((formatted) => { wrap.hidden = true; onConfirm(formatted); });
      wrap.appendChild(picker);
      refs.list.appendChild(wrap);
      if (pin) scrollToBottom();
    },
    onSubmit: (handler: (text: string) => void) => {
      refs.form.addEventListener("submit", (e) => {
        e.preventDefault();
        const t = refs.input.value.trim();
        if (!t) return;
        refs.input.value = "";
        handler(t);
      });
    },
    showConsent: (cfg: WidgetConfig, onAgree: () => void) => {
      const pin = isPinned();
      const box = document.createElement("div");
      box.className = "consent";
      const url = cfg.privacy.privacyPolicyUrl;
      const safeUrl = url && /^https?:\/\//i.test(url) ? url : null;
      const link = safeUrl
        ? ` <a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">Privacy</a>`
        : "";
      box.innerHTML = `<div>${escapeHtml(cfg.privacy.consentText)}${link}</div><button type="button">Got it</button>`;
      refs.list.appendChild(box);
      if (pin) scrollToBottom();
      box.querySelector("button")!.addEventListener("click", () => { box.remove(); onAgree(); });
    },
    clearConsent: () => refs.list.querySelector(".consent")?.remove(),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
