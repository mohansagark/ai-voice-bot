// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mountShell } from "../src/dom";
import { wirePanel } from "../src/panel";
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
    expect(msgs[0].textContent).toBe("hello");
    expect(msgs[0].classList.contains("user")).toBe(true);
    expect(msgs[1].textContent).toBe("Hi there");
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
});
