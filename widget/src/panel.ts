import type { Refs } from "./dom";
import type { WidgetConfig } from "./types";

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function wirePanel(refs: Refs) {
  const scroll = () => { refs.list.scrollTop = refs.list.scrollHeight; };
  const line = (cls: string, text = ""): HTMLElement => {
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
    if (cls === "user" || cls === "bot") {
      const ts = document.createElement("span");
      ts.className = "ts";
      ts.textContent = formatTime(new Date());
      d.appendChild(ts);
    }
    refs.list.appendChild(d); scroll();
    return d;
  };
  return {
    addUser: (text: string) => void line("user", text),
    startBot: (): HTMLElement => line("bot", ""),
    startBotText: (text: string) => void line("bot", text),
    appendBot: (el: HTMLElement, text: string) => {
      const body = el.querySelector(".msg-text")!;
      body.textContent = (body.textContent ?? "") + text;
      scroll();
    },
    endBot: (el: HTMLElement, finalText?: string) => {
      const body = el.querySelector(".msg-text")!;
      if (finalText) body.textContent = finalText;
      else if (!body.textContent) body.textContent = "…";
      scroll();
    },
    note: (text: string) => void line("note", text),
    showError: () => void line("bot", "Hmm, something hiccuped — mind trying that again?"),
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
      const box = document.createElement("div");
      box.className = "consent";
      const url = cfg.privacy.privacyPolicyUrl;
      const safeUrl = url && /^https?:\/\//i.test(url) ? url : null;
      const link = safeUrl
        ? ` <a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">Privacy</a>`
        : "";
      box.innerHTML = `<div>${escapeHtml(cfg.privacy.consentText)}${link}</div><button type="button">Got it</button>`;
      refs.list.appendChild(box); scroll();
      box.querySelector("button")!.addEventListener("click", () => { box.remove(); onAgree(); });
    },
    clearConsent: () => refs.list.querySelector(".consent")?.remove(),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
