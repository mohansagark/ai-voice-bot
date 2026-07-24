// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mountShell } from "../src/dom";
import { wirePanel, shouldPinToBottom } from "../src/panel";
import { DEFAULTS } from "../src/config";

const cfg = { workerUrl: "https://w.test", ...DEFAULTS } as any;

describe("wirePanel", () => {
  it("renders a user message and a streamed bot message", () => {
    const refs = mountShell(cfg);
    const p = wirePanel(refs);
    p.addUser("hello");
    const bot = p.startBot();
    p.appendBot(bot, "Hi ");
    p.appendBot(bot, "there");
    p.endBot(bot);
    const msgs = refs.list.querySelectorAll(".msg");
    expect(msgs[0].querySelector(".msg-text")!.textContent).toBe("hello");
    expect(msgs[0].classList.contains("user")).toBe(true);
    expect(msgs[1].querySelector(".msg-text")!.textContent).toBe("Hi there");
    expect(msgs[1].classList.contains("bot")).toBe(true);
  });

  it("fires the submit handler with the typed text and clears the input", () => {
    const refs = mountShell(cfg);
    const p = wirePanel(refs);
    let got = "";
    p.onSubmit((t) => { got = t; });
    refs.input.value = "  ping  ";
    refs.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(got).toBe("ping");
    expect(refs.input.value).toBe("");
  });

  it("shows a consent gate and calls onAgree", () => {
    const refs = mountShell(cfg);
    const p = wirePanel(refs);
    let agreed = false;
    p.showConsent(cfg, () => { agreed = true; });
    const btn = refs.list.querySelector(".consent button") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(agreed).toBe(true);
    expect(refs.list.querySelector(".consent")).toBeNull(); // gate removed after agree
  });

  it("escapes consent text and drops a non-http(s) policy url", () => {
    const refs = mountShell(cfg);
    const p = wirePanel(refs);
    const evil = { ...cfg, privacy: { consentText: "<img src=x onerror=alert(1)>", privacyPolicyUrl: "javascript:alert(1)" } };
    p.showConsent(evil as any, () => {});
    const box = refs.list.querySelector(".consent")!;
    expect(box.querySelector("img")).toBeNull();          // hostile consent text did NOT become an element
    expect(box.querySelector("a")).toBeNull();            // javascript: url was dropped (no anchor)
    expect(box.textContent).toContain("<img");            // rendered as literal text
  });

  it("startBotText renders a one-shot bot line", () => {
    const refs = mountShell(cfg);
    const p = wirePanel(refs);
    p.startBotText("Hi");
    const bot = refs.list.querySelector(".msg.bot")!;
    expect(bot.querySelector(".msg-text")!.textContent).toBe("Hi");
  });

  it("shows a typing indicator on startBot() until the first token arrives", () => {
    const refs = mountShell(cfg);
    const p = wirePanel(refs);
    const bot = p.startBot();
    expect(bot.querySelector(".typing")).toBeTruthy();
    p.appendBot(bot, "Hi");
    expect(bot.querySelector(".typing")).toBeNull();
    expect(bot.querySelector(".msg-text")!.textContent).toBe("Hi");
  });

  it("startBotText (greeting) never shows a typing indicator", () => {
    const refs = mountShell(cfg);
    const p = wirePanel(refs);
    p.startBotText("Hello!");
    const bot = refs.list.querySelector(".msg.bot")!;
    expect(bot.querySelector(".typing")).toBeNull();
  });

  it("applies an entrance-animation class to new messages", () => {
    const refs = mountShell(cfg);
    const p = wirePanel(refs);
    p.addUser("hi");
    const msg = refs.list.querySelector(".msg.user")!;
    expect(msg.classList.contains("msg-enter")).toBe(true);
  });

  it("renders a timestamp on user and bot messages, but not on notes", () => {
    const refs = mountShell(cfg);
    const p = wirePanel(refs);
    p.addUser("hi");
    p.note("✓ sent to Mohan");
    const userMsg = refs.list.querySelector(".msg.user")!;
    const noteMsg = refs.list.querySelector(".msg.note")!;
    expect(userMsg.querySelector(".ts")).toBeTruthy();
    expect(noteMsg.querySelector(".ts")).toBeNull();
  });
});

describe("shouldPinToBottom", () => {
  it("is true when the scroll position is within the threshold of the bottom", () => {
    expect(shouldPinToBottom(500, 195, 300)).toBe(true);  // distance = 5
    expect(shouldPinToBottom(500, 168, 300)).toBe(true);  // distance = 32 (exactly at threshold)
  });
  it("is false when scrolled further up than the threshold", () => {
    expect(shouldPinToBottom(500, 0, 300)).toBe(false);   // distance = 200
    expect(shouldPinToBottom(500, 167, 300)).toBe(false); // distance = 33
  });
});

function stubScroll(list: HTMLElement, vals: { scrollHeight: number; scrollTop: number; clientHeight: number }) {
  Object.defineProperty(list, "scrollHeight", { value: vals.scrollHeight, configurable: true });
  Object.defineProperty(list, "scrollTop", { value: vals.scrollTop, configurable: true, writable: true });
  Object.defineProperty(list, "clientHeight", { value: vals.clientHeight, configurable: true });
}

describe("wirePanel — scroll pinning", () => {
  it("auto-scrolls to bottom when near-bottom before a new bot token arrives", () => {
    const refs = mountShell(cfg);
    const p = wirePanel(refs);
    const bot = p.startBot();
    stubScroll(refs.list, { scrollHeight: 500, scrollTop: 195, clientHeight: 300 }); // near bottom
    p.appendBot(bot, "hi");
    expect(refs.list.scrollTop).toBe(refs.list.scrollHeight);
  });

  it("does not force-scroll when the visitor has scrolled up to read history", () => {
    const refs = mountShell(cfg);
    const p = wirePanel(refs);
    const bot = p.startBot();
    stubScroll(refs.list, { scrollHeight: 500, scrollTop: 0, clientHeight: 300 }); // scrolled to top
    p.appendBot(bot, "hi");
    expect(refs.list.scrollTop).toBe(0); // untouched
  });

  it("always scrolls to bottom when the visitor sends their own message, even if scrolled up", () => {
    const refs = mountShell(cfg);
    const p = wirePanel(refs);
    stubScroll(refs.list, { scrollHeight: 500, scrollTop: 0, clientHeight: 300 });
    p.addUser("hello");
    expect(refs.list.scrollTop).toBe(refs.list.scrollHeight);
  });
});
