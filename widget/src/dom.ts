import type { WidgetConfig } from "./types";
import { css } from "./styles";

export interface Refs {
  host: HTMLElement; shadow: ShadowRoot;
  orb: HTMLButtonElement; panel: HTMLElement; header: HTMLElement; avatar: HTMLElement;
  list: HTMLElement; form: HTMLFormElement; input: HTMLInputElement;
  mic: HTMLButtonElement; sound: HTMLButtonElement;
}

export function mountShell(cfg: WidgetConfig, parent: HTMLElement = document.body): Refs {
  const pos = cfg.branding.position === "bottom-left" ? "pos-left" : "pos-right";
  const host = document.createElement("div");
  host.setAttribute("data-ai-voice-bot", "");
  parent.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = css(cfg.branding.themeColor, cfg.branding.themeColorSecondary);
  shadow.appendChild(style);

  const orb = document.createElement("button");
  orb.className = `orb idle ${pos}`;
  orb.setAttribute("aria-label", `Open chat with ${cfg.branding.botName}`);
  orb.innerHTML = botGlyphSvg();
  shadow.appendChild(orb);

  const panel = document.createElement("div");
  panel.className = `panel ${pos}`;
  panel.setAttribute("data-open", "false");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `Chat with ${cfg.branding.botName}`);
  panel.innerHTML = `
    <div class="hd">
      <div class="hd-top">
        <div class="hd-identity">
          <div class="avatar">${botGlyphSvg()}</div>
          <span>${escapeHtml(cfg.branding.botName)}</span>
        </div>
        <div class="hd-actions">
          <button type="button" class="sound" aria-label="Mute ${escapeHtml(cfg.branding.botName)}'s voice" aria-pressed="false">🔊</button>
          <button class="close" aria-label="Close">×</button>
        </div>
      </div>
    </div>
    <div class="list"></div>
    <form>
      <input type="text" placeholder="Type a message…" autocomplete="off" aria-label="Message" />
      <button type="button" class="mic" aria-label="Speak your message">🎤</button>
      <button type="submit">Send</button>
    </form>
  `;
  shadow.appendChild(panel);

  return {
    host, shadow, orb, panel,
    header: panel.querySelector(".hd")!,
    avatar: panel.querySelector(".avatar")!,
    list: panel.querySelector(".list")!,
    form: panel.querySelector("form")!,
    input: panel.querySelector("input")!,
    mic: panel.querySelector(".mic")!,
    sound: panel.querySelector(".sound")!,
  };
}

function botGlyphSvg(): string {
  return `<svg class="orb-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="8" width="16" height="12" rx="4" fill="#fff"/>
    <circle cx="9" cy="14" r="1.6" fill="#241f30"/>
    <circle cx="15" cy="14" r="1.6" fill="#241f30"/>
    <rect x="10.5" y="3" width="3" height="4" rx="1.5" fill="#fff"/>
    <circle cx="12" cy="3" r="1.5" fill="#fff"/>
  </svg>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
