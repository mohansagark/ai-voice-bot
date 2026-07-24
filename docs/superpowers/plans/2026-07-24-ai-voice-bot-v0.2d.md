# AI Voice Bot v0.2d — Widget Visual Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the widget's look and feel — Card & Avatar direction (dark panel, gradient header, bot-glyph orb/avatar), plus typing indicator, message entrance animation, timestamps, and scroll-pinned smooth auto-scroll. No backend, agent, or breaking-config changes.

**Architecture:** Purely a `widget/` frontend change. One additive, backwards-compatible config field (`branding.themeColorSecondary`) threads a second color into `styles.ts`'s gradients. `dom.ts` gains a shared inline-SVG bot-glyph helper (reused by the orb and a new header avatar badge). `panel.ts` is restructured so each message has an inner `.msg-text` span (so streaming/timestamp updates don't collide) plus a pin-aware scroll helper. `orb.ts` is untouched (its state-machine API doesn't change).

**Tech Stack:** TypeScript, Vitest (+happy-dom for DOM), esbuild. No new runtime dependencies.

## Global Constraints

- **No backend changes.** This slice touches only `widget/src/*.ts`, `widget/tests/*`, `widget/demo-embed.html`, `widget/README.md`, and the root `README.md`.
- **`branding.themeColorSecondary` is optional and backwards compatible**: any existing embed that sets only `themeColor` must render an identical solid color (no forced gradient toward a default). Verified in Task 1.
- **All new/changed animations** (orb-thinking icon hide, message entrance, typing dots) must be covered by the existing `@media (prefers-reduced-motion: reduce)` block — extended, not replaced or duplicated.
- **No new runtime dependencies.** Bundle stays under **8 KB gz** (current baseline is 5.5 KB gz; verified in Task 6).
- **No public API removals/renames.** `mount()`, `MountDeps`, and existing `Refs` fields keep their names and types; `Refs` only gains one new field (`avatar`).
- **No mobile-specific redesign** — only a non-regression check (existing `max-width`/`max-height` clamping on `.panel` still holds) via manual smoke in Task 6.
- Discipline: TDD, `npx tsc --noEmit` clean before each commit (run in `widget/`), frequent commits.

---

### Task 1: Theming config — `branding.themeColorSecondary`

**Files:**
- Modify: `widget/src/types.ts`, `widget/src/config.ts`
- Test: `widget/tests/config.test.ts`

**Interfaces:**
- Produces: `WidgetConfig["branding"]` gains `themeColorSecondary: string`. Resolution: explicit `themeColorSecondary` wins; else falls back to the caller's own `themeColor` (not the module default) when only `themeColor` was given; else falls back to the default (`"#6C5CE7"`, equal to the default `themeColor`) when neither was given.

- [ ] **Step 1: Write the failing test additions**

Append to `widget/tests/config.test.ts` (inside the existing `describe("validateConfig", ...)` block):
```ts
  it("themeColorSecondary defaults to the default themeColor when neither is provided", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test" });
    expect(cfg!.branding.themeColorSecondary).toBe(DEFAULTS.branding.themeColor);
  });

  it("themeColorSecondary follows a custom themeColor when only themeColor is provided (stays a solid color)", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test", branding: { themeColor: "#ff0000" } } as any);
    expect(cfg!.branding.themeColor).toBe("#ff0000");
    expect(cfg!.branding.themeColorSecondary).toBe("#ff0000");
  });

  it("honors an explicit themeColorSecondary independent of themeColor", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test", branding: { themeColor: "#8750f7", themeColorSecondary: "#ff6fb0" } } as any);
    expect(cfg!.branding.themeColor).toBe("#8750f7");
    expect(cfg!.branding.themeColorSecondary).toBe("#ff6fb0");
  });
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/config.test.ts` → FAIL (`cfg!.branding.themeColorSecondary` is `undefined`).

- [ ] **Step 3: Update `widget/src/types.ts`**

Change the `branding` field on `WidgetConfig`:
```ts
  branding: { botName: string; themeColor: string; themeColorSecondary: string; position: "bottom-right" | "bottom-left"; greeting: string };
```
(`RawConfig`'s `branding: Partial<WidgetConfig["branding"]>` automatically covers the new field — no separate change needed there.)

- [ ] **Step 4: Update `widget/src/config.ts`**

Change the `DEFAULTS.branding` line:
```ts
  branding: { botName: "Leo", themeColor: "#6C5CE7", themeColorSecondary: "#6C5CE7", position: "bottom-right", greeting: "Hi, I'm Leo — how can I help?" },
```

Change `validateConfig`'s `branding` line (currently `branding: { ...DEFAULTS.branding, ...(r.branding ?? {}) },`) to:
```ts
    branding: {
      ...DEFAULTS.branding,
      ...(r.branding ?? {}),
      themeColorSecondary: r.branding?.themeColorSecondary ?? r.branding?.themeColor ?? DEFAULTS.branding.themeColorSecondary,
    },
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npx vitest run tests/config.test.ts` → PASS (all cases). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/types.ts widget/src/config.ts widget/tests/config.test.ts
git commit -m "feat(widget): branding.themeColorSecondary — optional gradient color, backwards compatible"
```

---

### Task 2: Orb — bot-glyph SVG icon, rounded-square shape, gradient background

**Files:**
- Modify: `widget/src/dom.ts`, `widget/src/styles.ts`
- Test: `widget/tests/dom.test.ts`

**Interfaces:**
- Consumes: `cfg.branding.themeColorSecondary` (Task 1).
- Produces: a `botGlyphSvg(): string` helper in `dom.ts` (used again by Task 3); `css(theme: string, theme2: string): string` (was single-arg).

- [ ] **Step 1: Write the failing test addition**

Append to `widget/tests/dom.test.ts` (inside `describe("mountShell", ...)`):
```ts
  it("renders a bot-glyph SVG icon in the orb instead of an emoji", () => {
    const refs = mountShell(cfg);
    expect(refs.orb.querySelector("svg.orb-icon")).toBeTruthy();
    expect(refs.orb.textContent?.trim()).toBe(""); // no emoji text content anymore
  });
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/dom.test.ts` → FAIL (`refs.orb.querySelector("svg.orb-icon")` is `null`, `orb.textContent` is `"💬"`).

- [ ] **Step 3: Add the shared glyph helper and use it for the orb in `widget/src/dom.ts`**

Add near the bottom of the file, alongside `escapeHtml`:
```ts
function botGlyphSvg(): string {
  return `<svg class="orb-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="8" width="16" height="12" rx="4" fill="#fff"/>
    <circle cx="9" cy="14" r="1.6" fill="#241f30"/>
    <circle cx="15" cy="14" r="1.6" fill="#241f30"/>
    <rect x="10.5" y="3" width="3" height="4" rx="1.5" fill="#fff"/>
    <circle cx="12" cy="3" r="1.5" fill="#fff"/>
  </svg>`;
}
```

Change the orb creation block (currently `orb.textContent = "💬";`):
```ts
  const orb = document.createElement("button");
  orb.className = `orb idle ${pos}`;
  orb.setAttribute("aria-label", `Open chat with ${cfg.branding.botName}`);
  orb.innerHTML = botGlyphSvg();
  shadow.appendChild(orb);
```

Change the stylesheet call site (currently `style.textContent = css(cfg.branding.themeColor);`):
```ts
  style.textContent = css(cfg.branding.themeColor, cfg.branding.themeColorSecondary);
```

- [ ] **Step 4: Update `widget/src/styles.ts`**

Change the function signature (currently `export function css(theme: string): string {`):
```ts
export function css(theme: string, theme2: string): string {
```

Replace the `.orb { ... }` rule (drop the now-unused `font-size: 24px` and change `border-radius: 50%` to a rounded-square, and the background to a gradient):
```ts
  .orb {
    position: fixed; bottom: 20px; z-index: 2147483000;
    width: 56px; height: 56px; border-radius: 22px; border: none; cursor: pointer;
    background: linear-gradient(120deg, ${theme}, ${theme2}); color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.28);
    display: grid; place-items: center; transition: transform .15s ease;
  }
```

Replace `.orb.thinking { font-size: 0; }` (the old trick to hide text content — there's no text content anymore, so hide the SVG instead):
```ts
  .orb.thinking svg { display: none; }
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npx vitest run tests/dom.test.ts` → PASS. `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/dom.ts widget/src/styles.ts widget/tests/dom.test.ts
git commit -m "feat(widget): orb — bot-glyph SVG icon, rounded-square shape, gradient background"
```

---

### Task 3: Panel — dark card, gradient header, avatar badge, bubble restyle

**Files:**
- Modify: `widget/src/dom.ts`, `widget/src/styles.ts`
- Test: `widget/tests/dom.test.ts`

**Interfaces:**
- Consumes: `botGlyphSvg()` (Task 2).
- Produces: `Refs` gains `avatar: HTMLElement`.

- [ ] **Step 1: Write the failing test addition**

Append to `widget/tests/dom.test.ts` (inside `describe("mountShell", ...)`):
```ts
  it("mounts an avatar badge with the bot-glyph icon in the header", () => {
    const refs = mountShell(cfg);
    expect(refs.avatar).toBeTruthy();
    expect(refs.shadow.contains(refs.avatar)).toBe(true);
    expect(refs.avatar.querySelector("svg.orb-icon")).toBeTruthy();
  });
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/dom.test.ts` → FAIL (`refs.avatar` is `undefined`).

- [ ] **Step 3: Update `Refs` and the panel markup in `widget/src/dom.ts`**

Change the `Refs` interface:
```ts
export interface Refs {
  host: HTMLElement; shadow: ShadowRoot;
  orb: HTMLButtonElement; panel: HTMLElement; header: HTMLElement; avatar: HTMLElement;
  list: HTMLElement; form: HTMLFormElement; input: HTMLInputElement;
  mic: HTMLButtonElement; sound: HTMLButtonElement;
}
```

Replace the `panel.innerHTML` template (nests the name/actions row under a new `.hd-top`, adds the `.avatar` badge):
```ts
  panel.innerHTML = `
    <div class="hd">
      <div class="hd-top">
        <span>${escapeHtml(cfg.branding.botName)}</span>
        <div class="hd-actions">
          <button type="button" class="sound" aria-label="Mute ${escapeHtml(cfg.branding.botName)}'s voice" aria-pressed="false">🔊</button>
          <button class="close" aria-label="Close">×</button>
        </div>
      </div>
      <div class="avatar">${botGlyphSvg()}</div>
    </div>
    <div class="list"></div>
    <form>
      <input type="text" placeholder="Type a message…" autocomplete="off" aria-label="Message" />
      <button type="button" class="mic" aria-label="Speak your message">🎤</button>
      <button type="submit">Send</button>
    </form>
  `;
```

Add `avatar` to the returned refs object:
```ts
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
```

- [ ] **Step 4: Replace the panel/header/message CSS block in `widget/src/styles.ts`**

Replace this entire block (from `.panel {` through `form button { ... }`):
```ts
  .panel {
    position: fixed; bottom: 88px; width: 360px; max-width: calc(100vw - 32px);
    height: 520px; max-height: calc(100vh - 120px); z-index: 2147483000;
    background: #fff; color: #17151f; border-radius: 16px; overflow: hidden;
    box-shadow: 0 12px 48px rgba(0,0,0,.24); display: none; flex-direction: column;
  }
  .panel.pos-right { right: 20px; } .panel.pos-left { left: 20px; }
  .panel[data-open="true"] { display: flex; }
  .hd { background: ${theme}; color: #fff; padding: 14px 16px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }
  .hd button { background: transparent; border: none; color: #fff; font-size: 20px; cursor: pointer; line-height: 1; }
  .hd-actions { display: flex; align-items: center; gap: 2px; }
  form .mic { background: transparent; border: 1px solid #ddd; border-radius: 10px; padding: 8px 10px; cursor: pointer; font-size: 16px; }
  form .mic:disabled { opacity: .4; cursor: not-allowed; }
  form .mic.listening { border-color: ${theme}; }
  .list { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: 82%; padding: 9px 12px; border-radius: 14px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
  .msg.bot { background: #f0eef7; align-self: flex-start; border-bottom-left-radius: 4px; }
  .msg.user { background: ${theme}; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
  .msg.note { align-self: center; background: transparent; color: #8a85a0; font-size: 12px; padding: 2px; }
  .consent { align-self: stretch; background: #f7f6fb; border: 1px solid #e2dff0; border-radius: 12px; padding: 12px; font-size: 13px; color: #4a4560; }
  .consent a { color: ${theme}; }
  .consent button { margin-top: 8px; background: ${theme}; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
  form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #eee; }
  input { flex: 1; padding: 10px 12px; border: 1px solid #ddd; border-radius: 10px; font-size: 14px; }
  input:focus-visible { outline: 2px solid ${theme}; outline-offset: 1px; }
  form button { background: ${theme}; color: #fff; border: none; border-radius: 10px; padding: 10px 14px; cursor: pointer; }
```

with:
```ts
  .panel {
    position: fixed; bottom: 88px; width: 360px; max-width: calc(100vw - 32px);
    height: 520px; max-height: calc(100vh - 120px); z-index: 2147483000;
    background: #17151f; color: #eae7f2; border-radius: 16px; overflow: hidden;
    box-shadow: 0 12px 48px rgba(0,0,0,.24); display: none; flex-direction: column;
  }
  .panel.pos-right { right: 20px; } .panel.pos-left { left: 20px; }
  .panel[data-open="true"] { display: flex; }
  .hd { position: relative; background: linear-gradient(120deg, ${theme}, ${theme2}); padding: 14px 16px 26px; }
  .hd-top { display: flex; align-items: center; justify-content: space-between; }
  .hd-top span { color: #fff; font-weight: 600; }
  .hd button { background: transparent; border: none; color: #fff; font-size: 20px; cursor: pointer; line-height: 1; }
  .hd-actions { display: flex; align-items: center; gap: 2px; }
  .avatar { position: absolute; left: 16px; bottom: -16px; width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(120deg, ${theme}, ${theme2}); box-shadow: 0 4px 10px rgba(0,0,0,.35); display: grid; place-items: center; }
  .avatar svg { width: 20px; height: 20px; }
  form .mic { background: transparent; border: 1px solid #332d42; color: #eae7f2; border-radius: 10px; padding: 8px 10px; cursor: pointer; font-size: 16px; }
  form .mic:disabled { opacity: .4; cursor: not-allowed; }
  form .mic.listening { border-color: ${theme}; }
  .list { flex: 1; overflow-y: auto; padding: 26px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: 82%; padding: 9px 12px; border-radius: 14px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
  .msg.bot { background: #241f30; align-self: flex-start; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
  .msg.user { background: linear-gradient(120deg, ${theme}, ${theme2}); color: #fff; align-self: flex-end; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
  .msg.note { align-self: center; background: transparent; color: #8a85a0; font-size: 12px; padding: 2px; }
  .consent { align-self: stretch; background: #f7f6fb; border: 1px solid #e2dff0; border-radius: 12px; padding: 12px; font-size: 13px; color: #4a4560; }
  .consent a { color: ${theme}; }
  .consent button { margin-top: 8px; background: ${theme}; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
  form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #2a2638; }
  input { flex: 1; padding: 10px 12px; border: 1px solid #332d42; background: #241f30; color: #eae7f2; border-radius: 10px; font-size: 14px; }
  input::placeholder { color: #756e8a; }
  input:focus-visible { outline: 2px solid ${theme}; outline-offset: 1px; }
  form button { background: linear-gradient(120deg, ${theme}, ${theme2}); color: #fff; border: none; border-radius: 10px; padding: 10px 14px; cursor: pointer; }
```

> Note: `.consent` and `input:focus-visible`/`.consent a`/`.consent button`/`form .mic.listening` keep referencing `${theme}` only (not the gradient) — these are small accents (link color, focus ring, one button), not full backgrounds, so a flat theme color reads fine and keeps the diff minimal.

- [ ] **Step 5: Run test — expect PASS**

Run: `npx vitest run tests/dom.test.ts` → PASS. `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/dom.ts widget/src/styles.ts widget/tests/dom.test.ts
git commit -m "feat(widget): panel — dark card, gradient header, avatar badge, bubble restyle"
```

---

### Task 4: Message rendering — typing indicator, entrance animation, timestamps

**Files:**
- Modify: `widget/src/panel.ts`, `widget/src/styles.ts`
- Test: `widget/tests/panel.test.ts` (rewritten — see Step 1)

**Interfaces:**
- Consumes: `Refs` (existing).
- Produces: every message now wraps its text in an inner `<span class="msg-text">` (so `appendBot`/`endBot` mutate that inner span, not the whole `.msg` div — this is what keeps the new `.ts` timestamp span from being clobbered by streaming token updates). `startBot()`/`appendBot()`/`endBot()` keep their existing signatures and return types — only their *internal* target changed. New CSS classes: `.msg-enter` (entrance animation), `.typing` (3-dot indicator, present until the first `appendBot` call replaces it), `.ts` (timestamp).

> This task changes `.msg`'s internal DOM shape, which breaks 2 of the *existing* `panel.test.ts` assertions that read `msg.textContent` directly (they'd now also pick up the timestamp text). Step 1 below is the **full replacement** of `panel.test.ts`, including those 2 fixed assertions plus the new tests.

- [ ] **Step 1: Replace `widget/tests/panel.test.ts` in full**

```ts
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
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/panel.test.ts` → FAIL (`.msg-text` doesn't exist yet; the two updated assertions and the three new tests all fail).

- [ ] **Step 3: Replace `widget/src/panel.ts` in full**

```ts
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
```

> `index.ts` never reads `.textContent` off the element `startBot()` returns (it only passes it back into `appendBot`/`endBot`/`.remove()`), so no changes are needed there — confirmed by reading the current `widget/src/index.ts`.

- [ ] **Step 4: Add typing/entrance/timestamp CSS to `widget/src/styles.ts`**

Add immediately after `.msg.note { ... }`:
```ts
  .msg-text { display: block; }
  .ts { display: block; margin-top: 4px; font-size: 11px; color: #756e8a; }
  .msg.user .ts { text-align: right; color: rgba(255,255,255,.75); }
  .typing { display: inline-flex; gap: 4px; padding: 2px 0; }
  .typing span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .5; animation: avb-bounce 1s infinite ease-in-out; }
  .typing span:nth-child(2) { animation-delay: .15s; }
  .typing span:nth-child(3) { animation-delay: .3s; }
  @keyframes avb-bounce { 0%,60%,100% { transform: translateY(0); opacity:.5; } 30% { transform: translateY(-4px); opacity:1; } }
  @keyframes avb-msg-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .msg-enter { animation: avb-msg-in .2s ease-out; }
```

Extend the existing reduced-motion media query (currently ends `... .orb.listening, .orb.speaking { animation: none; } }`):
```ts
  @media (prefers-reduced-motion: reduce) { .orb.idle { animation: none; } .orb.thinking::after { animation-duration: 1.6s; } .orb.listening, .orb.speaking { animation: none; } .msg-enter { animation: none; } .typing span { animation: none; } }
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npx vitest run tests/panel.test.ts` → PASS (10 passed). Then `npx vitest run` (full widget suite, since `dom.test.ts`/`orb.test.ts`/`index.test.ts` all use `mountShell`/`wirePanel` too) → all PASS. `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/panel.ts widget/src/styles.ts widget/tests/panel.test.ts
git commit -m "feat(widget): typing indicator, message entrance animation, timestamps"
```

---

### Task 5: Smooth, scroll-pinned auto-scroll

**Files:**
- Modify: `widget/src/panel.ts`, `widget/src/styles.ts`
- Test: `widget/tests/panel.test.ts`

**Interfaces:**
- Produces: `shouldPinToBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold?: number): boolean` (exported, pure — default `threshold = 32`). `line()`/`appendBot()`/`endBot()`/`showConsent()` now only force-scroll when pinned (near bottom) — except a user's own new message (`line("user", ...)`), which always scrolls.

- [ ] **Step 1: Write the failing test additions**

Append to `widget/tests/panel.test.ts` — first, add the import at the top:
```ts
import { wirePanel, shouldPinToBottom } from "../src/panel";
```
(replacing the existing `import { wirePanel } from "../src/panel";` line)

Then add these `describe`/`it` blocks after the existing `describe("wirePanel", ...)` block:
```ts
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
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/panel.test.ts` → FAIL (`shouldPinToBottom` doesn't exist; the pin-behavior tests see unconditional scrolling, so the "does not force-scroll" test fails).

- [ ] **Step 3: Update `widget/src/panel.ts`**

Add the exported pure function near the top (after `formatTime`):
```ts
export function shouldPinToBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold = 32): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
```

Replace the `scroll`/`line` setup and the `appendBot`/`endBot`/`showConsent` bodies to check pin state before mutating and only scroll after if pinned. Full replacement of the relevant parts of `wirePanel`:
```ts
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
    if (cls === "user" || cls === "bot") {
      const ts = document.createElement("span");
      ts.className = "ts";
      ts.textContent = formatTime(new Date());
      d.appendChild(ts);
    }
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
```
(`formatTime` and `escapeHtml` at the top/bottom of the file are unchanged from Task 4.)

- [ ] **Step 4: Add smooth scrolling to `widget/src/styles.ts`**

Change the `.list { ... }` rule to add `scroll-behavior: smooth;`:
```ts
  .list { flex: 1; overflow-y: auto; scroll-behavior: smooth; padding: 26px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npx vitest run tests/panel.test.ts` → PASS (16 passed). Then `npx vitest run` (full widget suite) → all PASS. `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/panel.ts widget/src/styles.ts widget/tests/panel.test.ts
git commit -m "feat(widget): scroll-pinned smooth auto-scroll (pause when scrolled up to read history)"
```

---

### Task 6: Demo config, docs, bundle-size check, manual smoke

**Files:**
- Modify: `widget/demo-embed.html`, `widget/README.md`, root `README.md`

**Steps:**

- [ ] **Step 1: Show the gradient in `widget/demo-embed.html`**

Change the `branding` line in the `window.AiVoiceBotConfig` block (currently `branding: { botName: "Leo", themeColor: "#6C5CE7", greeting: "Hi, I'm Leo — how can I help?" },`):
```html
    branding: { botName: "Leo", themeColor: "#6C5CE7", themeColorSecondary: "#B36CF7", greeting: "Hi, I'm Leo — how can I help?" },
```

- [ ] **Step 2: Update the config reference in `widget/README.md`**

In the `## Configuration reference` code block, change:
```js
    themeColor: "#6C5CE7",                            // default: "#6C5CE7"
```
to:
```js
    themeColor: "#6C5CE7",                            // default: "#6C5CE7"
    themeColorSecondary: "#6C5CE7",                   // default: same as themeColor (solid color) — set a second hex for a gradient
```

- [ ] **Step 3: Add a v0.2d row to the root `README.md` roadmap table**

Insert a new row after the existing `v0.2c` row and before the `v0.3` row:
```md
| v0.2d | **Widget redesign**: dark Card & Avatar UI, bot-glyph orb/avatar, gradient theming (`themeColorSecondary`), typing indicator, message entrance animation, timestamps, scroll-pinned smooth auto-scroll. |
```

- [ ] **Step 4: Bundle size check**

Run: `cd widget && npm run build && gzip -c dist/ai-voice-bot.min.js | wc -c` → confirm the number printed is under 8,000 (8 KB gz budget; baseline before this slice was ~5,500).

- [ ] **Step 5: Manual smoke test (human runs this)**

Run the Worker (`cd worker && npm run dev`, `MODE=dev` in `.dev.vars`), rebuild the widget (`cd widget && npm run build`), open `widget/demo-embed.html`, and verify:
1. Orb is a rounded-square with the bot-glyph icon on a purple→violet gradient (not the old circle/emoji).
2. Opening the panel shows a dark card, gradient banner header, and the avatar badge overlapping the header's bottom edge with the same bot-glyph icon.
3. Send a message: a 3-dot typing indicator appears in a bot bubble, then is replaced by the streamed reply as tokens arrive.
4. New messages fade/slide in; a small timestamp appears under each user/bot bubble (not under the "✓ sent to Mohan" note).
5. Scroll up mid-conversation, then send another message from a different scroll position — confirm the view does **not** force-jump while you're reading history, but a new user-sent message always scrolls to the bottom.
6. Resize the browser to a mobile width (~375px) — confirm the panel still fits within the viewport and scrolls internally (no broken/overflowing layout) with all the new header/avatar/timestamp content.
7. Enable `prefers-reduced-motion` (OS setting or DevTools rendering emulation) — confirm the message entrance animation and typing-dot bounce stop animating (orb animations already respected this before).
8. Temporarily remove `themeColorSecondary` from the demo config (Step 1) and reload — confirm the orb/header/user-bubble render as a **flat solid color** (the old look), proving the backwards-compatible default from Task 1.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/demo-embed.html widget/README.md README.md
git commit -m "docs(widget): v0.2d redesign — demo gradient config, README config reference, roadmap"
```

---

## Self-Review

**Spec coverage (v0.2d):**
- D1 Card & Avatar direction (dark panel, gradient header, avatar badge, rounded-square orb) — Tasks 2, 3. ✅
- D2 bot-glyph SVG orb icon (not site logo, not initial letter) — Task 2 (and reused in Task 3 for the avatar). ✅
- D3 `themeColorSecondary`, backwards-compatible default — Task 1. ✅
- D4 avatar in header only, no per-message avatar — Task 3 (no per-message avatar markup added anywhere). ✅
- D5 typing indicator — Task 4. ✅
- D6 message entrance animation, `prefers-reduced-motion` respected — Task 4. ✅
- D7 timestamps, always visible — Task 4. ✅
- D8 scroll-pinned smooth auto-scroll — Task 5. ✅
- D9 no mobile-specific redesign, but non-regression checked — Task 6 Step 5.6. ✅
- D10 out of scope correctly not built: no light/dark adaptive theming, no per-message avatars, no "online" status text. ✅
- Testing table (spec §8): config resolution — Task 1; auto-scroll pin logic — Task 5; typing indicator — Task 4; orb icon/shape structural test — Task 2; manual/browser smoke (including mobile viewport + reduced-motion + backwards-compat) — Task 6. ✅

**Placeholder scan:** No TBD/TODO/"add appropriate handling" phrasing. Every step shows complete code, including the two full-file replacements (`panel.ts` in Tasks 4 and 5, `panel.test.ts` in Tasks 4 and 5) needed because the internal message DOM shape and scroll behavior both change more than once.

**Type consistency:** `WidgetConfig["branding"].themeColorSecondary` (Task 1) is read identically in `dom.ts`'s `css(cfg.branding.themeColor, cfg.branding.themeColorSecondary)` call (Task 2) and nowhere else needs it. `Refs.avatar` (Task 3) matches its one call site (the new `dom.test.ts` assertion) — nothing else in `index.ts`/`orb.ts` references it, so no other file needed updating. `botGlyphSvg()` (Task 2, used again in Task 3) takes no arguments in both call sites — consistent. `shouldPinToBottom` (Task 5) has the identical signature at its definition and at every call site inside `wirePanel`. `panel.ts`'s public shape (`addUser`, `startBot`, `startBotText`, `appendBot`, `endBot`, `note`, `showError`, `onSubmit`, `showConsent`, `clearConsent`) is unchanged across Tasks 4 and 5 — confirmed against `index.ts`'s usage, which is not modified by this plan.

**Scope check:** Single cohesive slice (widget visual/interaction redesign only); no backend or agent changes; appropriately sized for one implementation pass.

---

*End of v0.2d plan. After this ships, resume v0.3: embed the widget on `devmohan.in` for real.*
