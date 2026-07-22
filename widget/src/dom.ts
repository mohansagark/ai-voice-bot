import type { WidgetConfig } from "./types";
import { css } from "./styles";

export interface Refs {
  host: HTMLElement; shadow: ShadowRoot;
  orb: HTMLButtonElement; panel: HTMLElement; header: HTMLElement;
  list: HTMLElement; form: HTMLFormElement; input: HTMLInputElement;
}

export function mountShell(cfg: WidgetConfig, parent: HTMLElement = document.body): Refs {
  const pos = cfg.branding.position === "bottom-left" ? "pos-left" : "pos-right";
  const host = document.createElement("div");
  host.setAttribute("data-ai-voice-bot", "");
  parent.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = css(cfg.branding.themeColor);
  shadow.appendChild(style);

  const orb = document.createElement("button");
  orb.className = `orb idle ${pos}`;
  orb.setAttribute("aria-label", `Open chat with ${cfg.branding.botName}`);
  orb.textContent = "💬";
  shadow.appendChild(orb);

  const panel = document.createElement("div");
  panel.className = `panel ${pos}`;
  panel.setAttribute("data-open", "false");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `Chat with ${cfg.branding.botName}`);
  panel.innerHTML = `
    <div class="hd"><span>${escapeHtml(cfg.branding.botName)}</span><button class="close" aria-label="Close">×</button></div>
    <div class="list"></div>
    <form><input type="text" placeholder="Type a message…" autocomplete="off" aria-label="Message" /><button type="submit">Send</button></form>
  `;
  shadow.appendChild(panel);

  return {
    host, shadow, orb, panel,
    header: panel.querySelector(".hd")!,
    list: panel.querySelector(".list")!,
    form: panel.querySelector("form")!,
    input: panel.querySelector("input")!,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
