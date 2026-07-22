# AI Voice Bot v0.2b — The Embeddable Widget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `ai-voice-bot.min.js` — a self-mounting, zero-dependency TypeScript widget that renders a floating orb + chat panel inside a Shadow DOM and streams Leo's replies over the existing `/chat` SSE endpoint. Text-first (voice is v0.2c). No backend changes.

**Architecture:** All widget code is TypeScript under `widget/src/`, bundled by esbuild into one minified IIFE. Pure logic (config validation, SSE client, session/consent) is unit-tested with Vitest and injected dependencies (`fetch`, `localStorage`). DOM code (shadow shell, orb, panel, integration) is tested with Vitest's `happy-dom` environment. Everything renders under a shadow root so host CSS can't leak in or out.

**Tech Stack:** TypeScript, esbuild, Vitest + happy-dom. Zero runtime dependencies.

## Global Constraints

- **Zero runtime dependencies.** The shipped bundle imports nothing at runtime. Bundle target **< ~45 KB gzipped**.
- **TypeScript → esbuild IIFE.** `esbuild src/index.ts --bundle --minify --format=iife --target=es2020 --outfile=dist/ai-voice-bot.min.js`.
- **Never throw into the host page.** Any failure (missing config, network, localStorage blocked) is caught; the widget logs a clear `console.error` and stays dormant or degrades. A host page must never break because of this widget.
- **Shadow DOM isolation.** All visible UI lives under `host.attachShadow({ mode: "open" })`. No styles applied to `document`/host elements; no reliance on host CSS inheritance.
- **Consumes the v0.2a `/chat` contract unchanged:** `POST { session_id, message, consent }` → SSE (`event: token|lead|done|error`); `429` with body `{ blocked: true }` = spam/rate block → go silent; other `429`/non-2xx → friendly error.
- **Config-driven** via `window.AiVoiceBotConfig`; unknown keys (incl. future voice keys) are ignored. Only `workerUrl` is required.
- **Accessibility:** keyboard-operable orb/input, ARIA labels, visible focus, `prefers-reduced-motion` respected.
- `worker/` is **not touched** by this plan.
- Discipline: TDD, `npx tsc --noEmit` clean before each commit, frequent commits.

## File Structure

```
widget/
  src/
    types.ts       # WidgetConfig + shared types
    config.ts      # DEFAULTS, validateConfig()
    analytics.ts   # emit() wrapper around advanced.analyticsCallback
    client.ts      # sendChat() + parseSSE() (pure, injectable fetch)
    session.ts     # session_id / stored name / consent (injectable storage)
    styles.ts      # css(themeColor) -> string (injected into shadow root)
    dom.ts         # mountShell(host, cfg) -> refs {shadow, orb, panel, list, input, ...}
    orb.ts         # wireOrb(refs) -> { open, close, toggle, setThinking }
    panel.ts       # wirePanel(refs, cfg, deps) -> { addUser, startBot, appendBot, endBot, showError, showConsentGate }
    index.ts       # entry: read+validate config, mount, wire everything, greeting/returning
  tests/
    config.test.ts
    client.test.ts
    session.test.ts
    dom.test.ts        # happy-dom
    orb.test.ts        # happy-dom
    panel.test.ts      # happy-dom
    index.test.ts      # happy-dom integration
  demo-embed.html
  build.mjs
  package.json
  tsconfig.json
  vitest.config.ts
  dist/                # build output (gitignored)
```

---

### Task 1: Widget scaffold + config validation

**Files:**
- Create: `widget/package.json`, `widget/tsconfig.json`, `widget/vitest.config.ts`, `widget/build.mjs`, `widget/src/types.ts`, `widget/src/config.ts`
- Test: `widget/tests/config.test.ts`

**Interfaces:**
- Produces: `WidgetConfig` (resolved, all fields present), `RawConfig` (partial user input), `DEFAULTS`, `validateConfig(raw: unknown): WidgetConfig | null` (returns `null` + `console.error` when `workerUrl` is missing/invalid).

- [ ] **Step 1: Create build/test config files**

`widget/package.json`:
```json
{
  "name": "ai-voice-bot-widget",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "esbuild": "^0.23.0",
    "happy-dom": "^15.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`widget/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "Bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true
  },
  "include": ["src", "tests"]
}
```

`widget/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```
(DOM tests opt into happy-dom per-file via a docblock; node is the default.)

`widget/build.mjs`:
```js
import { build } from "esbuild";
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "dist/ai-voice-bot.min.js",
});
console.log("built dist/ai-voice-bot.min.js");
```

- [ ] **Step 2: Write `types.ts`**

`widget/src/types.ts`:
```ts
export interface WidgetConfig {
  workerUrl: string;
  branding: { botName: string; themeColor: string; position: "bottom-right" | "bottom-left"; greeting: string };
  behavior: { autoGreet: boolean; rememberReturning: boolean };
  privacy: { consentText: string; privacyPolicyUrl: string | null };
  advanced: { analyticsCallback: ((event: string, payload?: unknown) => void) | null };
}
export type RawConfig = Partial<{
  workerUrl: string;
  branding: Partial<WidgetConfig["branding"]>;
  behavior: Partial<WidgetConfig["behavior"]>;
  privacy: Partial<WidgetConfig["privacy"]>;
  advanced: Partial<WidgetConfig["advanced"]>;
}>;
```

- [ ] **Step 3: Write the failing config test**

`widget/tests/config.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { validateConfig, DEFAULTS } from "../src/config";

describe("validateConfig", () => {
  it("returns null and logs when workerUrl is missing", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(validateConfig({})).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("fills defaults around a provided workerUrl", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test" });
    expect(cfg).not.toBeNull();
    expect(cfg!.workerUrl).toBe("https://w.test");
    expect(cfg!.branding.botName).toBe(DEFAULTS.branding.botName);
    expect(cfg!.behavior.autoGreet).toBe(true);
  });

  it("merges user branding over defaults and ignores unknown keys", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test", branding: { botName: "Ari" }, voice: { x: 1 } } as any);
    expect(cfg!.branding.botName).toBe("Ari");
    expect(cfg!.branding.themeColor).toBe(DEFAULTS.branding.themeColor);
  });
});
```

- [ ] **Step 4: Run test — expect FAIL**

Run: `cd widget && npm install && npm test -- tests/config.test.ts`
Expected: FAIL — cannot find module `../src/config`.

- [ ] **Step 5: Write `config.ts`**

`widget/src/config.ts`:
```ts
import type { WidgetConfig, RawConfig } from "./types";

export const DEFAULTS: Omit<WidgetConfig, "workerUrl"> = {
  branding: { botName: "Leo", themeColor: "#6C5CE7", position: "bottom-right", greeting: "Hi, I'm Leo — how can I help?" },
  behavior: { autoGreet: true, rememberReturning: true },
  privacy: { consentText: "I agree to share my info so I can be followed up with.", privacyPolicyUrl: null },
  advanced: { analyticsCallback: null },
};

export function validateConfig(raw: unknown): WidgetConfig | null {
  const r = (raw ?? {}) as RawConfig;
  if (!r.workerUrl || typeof r.workerUrl !== "string") {
    console.error("[ai-voice-bot] window.AiVoiceBotConfig.workerUrl is required — widget not mounted.");
    return null;
  }
  return {
    workerUrl: r.workerUrl.replace(/\/+$/, ""),
    branding: { ...DEFAULTS.branding, ...(r.branding ?? {}) },
    behavior: { ...DEFAULTS.behavior, ...(r.behavior ?? {}) },
    privacy: { ...DEFAULTS.privacy, ...(r.privacy ?? {}) },
    advanced: { ...DEFAULTS.advanced, ...(r.advanced ?? {}) },
  };
}
```

- [ ] **Step 6: Run test — expect PASS**

Run: `npm test -- tests/config.test.ts` → PASS (3 passed). Then `npx tsc --noEmit` → 0 errors.

- [ ] **Step 7: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/
git commit -m "feat(widget): scaffold + config validation (defaults, dormant on missing workerUrl)"
```

---

### Task 2: SSE chat client

**Files:**
- Create: `widget/src/client.ts`, `widget/src/analytics.ts`
- Test: `widget/tests/client.test.ts`

**Interfaces:**
- Produces:
  - `emit(cb, event, payload?)` in `analytics.ts` — safely calls the optional analytics callback.
  - `ChatEvents` — `{ onToken(t), onLead(l), onDone(reply, leadSaved), onError(msg), onBlocked() }`.
  - `sendChat(workerUrl, body: {session_id, message, consent}, events, fetchImpl?): Promise<void>`.
  - `parseSSE(buffer: string): { frames: {event:string; data:string}[]; rest: string }` — pure; splits complete frames, returns leftover.

- [ ] **Step 1: Write the failing test**

`widget/tests/client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseSSE, sendChat, type ChatEvents } from "../src/client";

function sse(event: string, data: unknown) { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } });
}
function collector() {
  const log: string[] = [];
  const events: ChatEvents = {
    onToken: (t) => log.push("token:" + t),
    onLead: () => log.push("lead"),
    onDone: (r, s) => log.push("done:" + r + ":" + s),
    onError: (m) => log.push("error:" + m),
    onBlocked: () => log.push("blocked"),
  };
  return { log, events };
}

describe("parseSSE", () => {
  it("splits complete frames and keeps the remainder", () => {
    const { frames, rest } = parseSSE(sse("token", { text: "hi" }) + "event: done\ndata: {");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ event: "token", data: '{"text":"hi"}' });
    expect(rest).toBe("event: done\ndata: {");
  });
});

describe("sendChat", () => {
  it("dispatches token then done from a streamed body", async () => {
    const body = streamOf([sse("token", { text: "He" }), sse("token", { text: "llo" }), sse("done", { reply: "Hello", lead_saved: false })]);
    const fake = (async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    const { log, events } = collector();
    await sendChat("https://w.test", { session_id: "s", message: "hi", consent: {} }, events, fake);
    expect(log).toEqual(["token:He", "token:llo", "done:Hello:false"]);
  });

  it("calls onBlocked for a 429 {blocked:true} without streaming", async () => {
    const fake = (async () => Response.json({ blocked: true }, { status: 429 })) as unknown as typeof fetch;
    const { log, events } = collector();
    await sendChat("https://w.test", { session_id: "s", message: "hi", consent: {} }, events, fake);
    expect(log).toEqual(["blocked"]);
  });

  it("calls onError on a network failure", async () => {
    const fake = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const { log, events } = collector();
    await sendChat("https://w.test", { session_id: "s", message: "hi", consent: {} }, events, fake);
    expect(log[0]).toMatch(/^error:/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/client.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write `analytics.ts`**

`widget/src/analytics.ts`:
```ts
export function emit(cb: ((e: string, p?: unknown) => void) | null, event: string, payload?: unknown): void {
  try { cb?.(event, payload); } catch { /* never let analytics break the widget */ }
}
```

- [ ] **Step 4: Write `client.ts`**

`widget/src/client.ts`:
```ts
export interface ChatEvents {
  onToken(text: string): void;
  onLead(lead: unknown): void;
  onDone(reply: string, leadSaved: boolean): void;
  onError(message: string): void;
  onBlocked(): void;
}

export function parseSSE(buffer: string): { frames: { event: string; data: string }[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const frames: { event: string; data: string }[] = [];
  for (const part of parts) {
    const event = /event: (.*)/.exec(part)?.[1];
    const data = /data: (.*)/.exec(part)?.[1];
    if (event && data !== undefined) frames.push({ event, data });
  }
  return { frames, rest };
}

export async function sendChat(
  workerUrl: string,
  body: { session_id: string; message: string; consent: unknown },
  events: ChatEvents,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(`${workerUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    events.onError(String((e as Error).message));
    return;
  }

  if (res.status === 429) {
    const info = (await res.json().catch(() => ({}))) as { blocked?: boolean };
    if (info?.blocked) events.onBlocked();
    else events.onError("rate limited");
    return;
  }
  if (!res.ok || !res.body) { events.onError(`error ${res.status}`); return; }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { frames, rest } = parseSSE(buf);
      buf = rest;
      for (const f of frames) {
        const payload = JSON.parse(f.data);
        if (f.event === "token") events.onToken(payload.text);
        else if (f.event === "lead") events.onLead(payload.lead);
        else if (f.event === "done") events.onDone(payload.reply, !!payload.lead_saved);
        else if (f.event === "error") events.onError(payload.message);
      }
    }
  } catch (e) {
    events.onError(String((e as Error).message));
  }
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npm test -- tests/client.test.ts` → PASS (4 passed). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add widget/src/client.ts widget/src/analytics.ts widget/tests/client.test.ts
git commit -m "feat(widget): SSE chat client (streaming, blocked, error) + analytics emit"
```

---

### Task 3: Session, name & consent persistence

**Files:**
- Create: `widget/src/session.ts`
- Test: `widget/tests/session.test.ts`

**Interfaces:**
- Produces: `Store` interface `{ get(k), set(k,v), remove(k) }`; `memoryStore()`; `safeStore()` (wraps `localStorage`, falls back to memory); and a `Session` factory `createSession(store): { id(): string; name(): string|null; setName(n): void; consent(): Consent|null; setConsent(text): Consent; forget(): void }` where `Consent = { agreed: true; timestamp: string; text: string }`.

- [ ] **Step 1: Write the failing test**

`widget/tests/session.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createSession, memoryStore } from "../src/session";

describe("session", () => {
  it("creates and reuses a stable session id", () => {
    const store = memoryStore();
    const a = createSession(store).id();
    const b = createSession(store).id();
    expect(a).toBe(b);
    expect(a).toMatch(/[0-9a-f-]{10,}/);
  });

  it("stores and reads the visitor name", () => {
    const store = memoryStore();
    const s = createSession(store);
    expect(s.name()).toBeNull();
    s.setName("Alex");
    expect(createSession(store).name()).toBe("Alex");
  });

  it("records consent with a timestamp and text", () => {
    const s = createSession(memoryStore());
    expect(s.consent()).toBeNull();
    const c = s.setConsent("I agree");
    expect(c.agreed).toBe(true);
    expect(c.text).toBe("I agree");
    expect(typeof c.timestamp).toBe("string");
    expect(s.consent()?.agreed).toBe(true);
  });

  it("forget() clears id, name and consent", () => {
    const store = memoryStore();
    const s = createSession(store);
    s.setName("Alex"); s.setConsent("ok"); const first = s.id();
    s.forget();
    expect(s.name()).toBeNull();
    expect(s.consent()).toBeNull();
    expect(s.id()).not.toBe(first);   // a fresh id after forget
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/session.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write `session.ts`**

`widget/src/session.ts`:
```ts
export interface Store { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void; }
export interface Consent { agreed: true; timestamp: string; text: string; }

const K_ID = "avb_session", K_NAME = "avb_name", K_CONSENT = "avb_consent";

export function memoryStore(): Store {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}

export function safeStore(): Store {
  try {
    const t = "__avb__"; localStorage.setItem(t, "1"); localStorage.removeItem(t);
    return { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
  } catch { return memoryStore(); }
}

function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function createSession(store: Store) {
  const id = () => {
    let v = store.get(K_ID);
    if (!v) { v = uuid(); store.set(K_ID, v); }
    return v;
  };
  return {
    id,
    name: () => store.get(K_NAME),
    setName: (n: string) => store.set(K_NAME, n),
    consent: (): Consent | null => { const raw = store.get(K_CONSENT); return raw ? (JSON.parse(raw) as Consent) : null; },
    setConsent: (text: string): Consent => {
      const c: Consent = { agreed: true, timestamp: new Date().toISOString(), text };
      store.set(K_CONSENT, JSON.stringify(c));
      return c;
    },
    forget: () => { store.remove(K_ID); store.remove(K_NAME); store.remove(K_CONSENT); },
  };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/session.test.ts` → PASS (4 passed). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add widget/src/session.ts widget/tests/session.test.ts
git commit -m "feat(widget): session id + name + consent persistence (localStorage w/ memory fallback)"
```

---

### Task 4: Shadow DOM shell + styles

**Files:**
- Create: `widget/src/styles.ts`, `widget/src/dom.ts`
- Test: `widget/tests/dom.test.ts` (happy-dom)

**Interfaces:**
- Consumes: `WidgetConfig`.
- Produces:
  - `css(themeColor: string): string`.
  - `Refs` — `{ host: HTMLElement; shadow: ShadowRoot; orb: HTMLButtonElement; panel: HTMLElement; header: HTMLElement; list: HTMLElement; form: HTMLFormElement; input: HTMLInputElement }`.
  - `mountShell(cfg: WidgetConfig, parent?: HTMLElement): Refs` — appends a host div to `parent` (default `document.body`), attaches an open shadow root, injects styles + orb + panel skeleton, returns refs. Panel starts hidden.

- [ ] **Step 1: Write the failing test**

`widget/tests/dom.test.ts`:
```ts
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mountShell } from "../src/dom";
import { DEFAULTS } from "../src/config";

const cfg = { workerUrl: "https://w.test", ...DEFAULTS } as any;

describe("mountShell", () => {
  it("mounts an orb + hidden panel inside a shadow root", () => {
    const refs = mountShell(cfg);
    expect(refs.shadow).toBeTruthy();
    expect(refs.orb).toBeTruthy();
    expect(refs.panel).toBeTruthy();
    // panel hidden initially
    expect(refs.panel.getAttribute("data-open")).toBe("false");
    // orb + panel live under the shadow root, not the light DOM
    expect(refs.shadow.contains(refs.orb)).toBe(true);
    expect(document.body.contains(refs.host)).toBe(true);
  });

  it("does not leak styles to the document (styles live in the shadow root)", () => {
    mountShell(cfg);
    // No <style> was added to the document head by the widget.
    expect(document.head.querySelector("style[data-avb]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/dom.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write `styles.ts`**

`widget/src/styles.ts`:
```ts
export function css(theme: string): string {
  return `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .orb {
    position: fixed; bottom: 20px; z-index: 2147483000;
    width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
    background: ${theme}; color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.28);
    display: grid; place-items: center; font-size: 24px; transition: transform .15s ease;
  }
  .orb:hover { transform: scale(1.05); }
  .orb:focus-visible { outline: 3px solid ${theme}; outline-offset: 3px; }
  .orb.pos-right { right: 20px; } .orb.pos-left { left: 20px; }
  @keyframes avb-pulse { 0%,100% { box-shadow: 0 6px 24px rgba(0,0,0,.28); } 50% { box-shadow: 0 6px 30px ${theme}66; } }
  .orb.idle { animation: avb-pulse 2.4s ease-in-out infinite; }
  @keyframes avb-spin { to { transform: rotate(360deg); } }
  .orb.thinking::after { content:""; width:22px; height:22px; border:3px solid #ffffff55; border-top-color:#fff; border-radius:50%; animation: avb-spin .8s linear infinite; }
  .orb.thinking { font-size: 0; }

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
  @media (prefers-reduced-motion: reduce) { .orb.idle { animation: none; } .orb.thinking::after { animation-duration: 1.6s; } }
  `;
}
```

- [ ] **Step 4: Write `dom.ts`**

`widget/src/dom.ts`:
```ts
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
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npm test -- tests/dom.test.ts` → PASS (2 passed). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add widget/src/styles.ts widget/src/dom.ts widget/tests/dom.test.ts
git commit -m "feat(widget): Shadow DOM shell + themed styles (orb + chat panel skeleton)"
```

---

### Task 5: Orb + panel behavior

**Files:**
- Create: `widget/src/orb.ts`, `widget/src/panel.ts`
- Test: `widget/tests/orb.test.ts`, `widget/tests/panel.test.ts` (happy-dom)

**Interfaces:**
- Consumes: `Refs` (dom.ts).
- Produces:
  - `wireOrb(refs, onToggle?): { open(): void; close(): void; toggle(): void; setThinking(on: boolean): void; isOpen(): boolean }` — click/close-button toggle the panel `data-open`; `setThinking` swaps orb class idle↔thinking.
  - `wirePanel(refs): { addUser(text): void; startBot(): HTMLElement; appendBot(el, text): void; endBot(el): void; note(text): void; showError(): void; onSubmit(handler: (text: string) => void): void; showConsent(cfg, onAgree): void; clearConsent(): void }` — DOM rendering helpers; `startBot` returns the growing bot line, `appendBot` accumulates streamed text into it.

- [ ] **Step 1: Write failing tests**

`widget/tests/orb.test.ts`:
```ts
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mountShell } from "../src/dom";
import { wireOrb } from "../src/orb";
import { DEFAULTS } from "../src/config";

const cfg = { workerUrl: "https://w.test", ...DEFAULTS } as any;

describe("wireOrb", () => {
  it("toggles the panel open on orb click and closed on close button", () => {
    const refs = mountShell(cfg);
    const orb = wireOrb(refs);
    expect(orb.isOpen()).toBe(false);
    refs.orb.click();
    expect(refs.panel.getAttribute("data-open")).toBe("true");
    expect(orb.isOpen()).toBe(true);
    (refs.panel.querySelector(".close") as HTMLButtonElement).click();
    expect(refs.panel.getAttribute("data-open")).toBe("false");
  });

  it("setThinking swaps the orb state class", () => {
    const refs = mountShell(cfg);
    const orb = wireOrb(refs);
    orb.setThinking(true);
    expect(refs.orb.classList.contains("thinking")).toBe(true);
    expect(refs.orb.classList.contains("idle")).toBe(false);
    orb.setThinking(false);
    expect(refs.orb.classList.contains("idle")).toBe(true);
  });
});
```

`widget/tests/panel.test.ts`:
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
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- tests/orb.test.ts tests/panel.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Write `orb.ts`**

`widget/src/orb.ts`:
```ts
import type { Refs } from "./dom";

export function wireOrb(refs: Refs, onToggle?: (open: boolean) => void) {
  const setOpen = (open: boolean) => {
    refs.panel.setAttribute("data-open", String(open));
    if (open) refs.input.focus();
    onToggle?.(open);
  };
  const isOpen = () => refs.panel.getAttribute("data-open") === "true";
  refs.orb.addEventListener("click", () => setOpen(!isOpen()));
  refs.panel.querySelector(".close")!.addEventListener("click", () => setOpen(false));
  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen()),
    isOpen,
    setThinking: (on: boolean) => {
      refs.orb.classList.toggle("thinking", on);
      refs.orb.classList.toggle("idle", !on);
    },
  };
}
```

- [ ] **Step 4: Write `panel.ts`**

`widget/src/panel.ts`:
```ts
import type { Refs } from "./dom";
import type { WidgetConfig } from "./types";

export function wirePanel(refs: Refs) {
  const scroll = () => { refs.list.scrollTop = refs.list.scrollHeight; };
  const line = (cls: string, text = ""): HTMLElement => {
    const d = document.createElement("div");
    d.className = `msg ${cls}`;
    d.textContent = text;
    refs.list.appendChild(d); scroll();
    return d;
  };
  return {
    addUser: (text: string) => void line("user", text),
    startBot: (): HTMLElement => line("bot", ""),
    appendBot: (el: HTMLElement, text: string) => { el.textContent = (el.textContent ?? "") + text; scroll(); },
    endBot: (el: HTMLElement) => { if (!el.textContent) el.textContent = "…"; scroll(); },
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
      const link = cfg.privacy.privacyPolicyUrl
        ? ` <a href="${cfg.privacy.privacyPolicyUrl}" target="_blank" rel="noopener">Privacy</a>`
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

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm test -- tests/orb.test.ts tests/panel.test.ts` → PASS (2 + 3). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add widget/src/orb.ts widget/src/panel.ts widget/tests/orb.test.ts widget/tests/panel.test.ts
git commit -m "feat(widget): orb toggle/thinking + panel rendering, streaming, consent gate, submit"
```

---

### Task 6: Integration — mount, wire, greet, converse

**Files:**
- Create: `widget/src/index.ts`
- Test: `widget/tests/index.test.ts` (happy-dom)

**Interfaces:**
- Consumes: everything above (`validateConfig`, `mountShell`, `wireOrb`, `wirePanel`, `createSession`/`safeStore`, `sendChat`, `emit`).
- Produces: `mount(rawConfig, deps?)` — the testable core (deps inject `fetch` and a `Store`); default export runs `mount(window.AiVoiceBotConfig)` on load. On a turn: gate consent (first message) → `addUser` → `setThinking(true)` → `sendChat` streaming into a bot line → on `lead` store name + `note("✓ sent to <owner>")` → on `done`/`error`/`blocked` settle + `setThinking(false)`. Returning visitor (stored name) → "Welcome back, {name}!" greeting.

- [ ] **Step 1: Write the failing test**

`widget/tests/index.test.ts`:
```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { mount } from "../src/index";
import { memoryStore } from "../src/session";

function sse(event: string, data: unknown) { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
function streamRes(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const baseCfg = { workerUrl: "https://w.test", branding: { greeting: "Hi there!" } };

describe("mount", () => {
  it("stays dormant (no host element) when workerUrl is missing", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mount({}, { store: memoryStore(), fetchImpl: fetch });
    expect(app).toBeNull();
    expect(document.querySelector("[data-ai-voice-bot]")).toBeNull();
    err.mockRestore();
  });

  it("greets on open, then streams a reply after a consented send", async () => {
    const fetchImpl = (async () => streamRes([sse("token", { text: "He" }), sse("token", { text: "y" }), sse("done", { reply: "Hey", lead_saved: false })])) as unknown as typeof fetch;
    const app = mount(baseCfg, { store: memoryStore(), fetchImpl })!;
    app.refs.orb.click(); // open
    expect(app.refs.list.textContent).toContain("Hi there!"); // greeting
    // First send shows the consent gate; agree, then the message goes.
    app.refs.input.value = "hello";
    app.refs.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    const consentBtn = app.refs.list.querySelector(".consent button") as HTMLButtonElement;
    expect(consentBtn).toBeTruthy();
    consentBtn.click();
    // the user message is rendered immediately; wait a tick for the stream
    await new Promise((r) => setTimeout(r, 0));
    expect(app.refs.list.textContent).toContain("hello");
    expect(app.refs.list.textContent).toContain("Hey");
  });

  it("greets a returning visitor by stored name", () => {
    const store = memoryStore(); store.set("avb_name", "Alex");
    const app = mount(baseCfg, { store, fetchImpl: fetch })!;
    app.refs.orb.click();
    expect(app.refs.list.textContent).toContain("Welcome back, Alex");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/index.test.ts` → FAIL (module not found / `mount` not exported).

- [ ] **Step 3: Write `index.ts`**

`widget/src/index.ts`:
```ts
import { validateConfig } from "./config";
import type { WidgetConfig } from "./types";
import { mountShell, type Refs } from "./dom";
import { wireOrb } from "./orb";
import { wirePanel } from "./panel";
import { createSession, safeStore, type Store } from "./session";
import { sendChat } from "./client";
import { emit } from "./analytics";

export interface MountDeps { store?: Store; fetchImpl?: typeof fetch; }

export function mount(rawConfig: unknown, deps: MountDeps = {}): { refs: Refs } | null {
  const cfg: WidgetConfig | null = validateConfig(rawConfig);
  if (!cfg) return null;

  const store = deps.store ?? safeStore();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const session = createSession(store);
  const analytics = cfg.advanced.analyticsCallback;

  const refs = mountShell(cfg);
  const panel = wirePanel(refs);
  let greeted = false;

  const orb = wireOrb(refs, (open) => {
    if (open) {
      emit(analytics, "open");
      if (!greeted && cfg.behavior.autoGreet) {
        const name = cfg.behavior.rememberReturning ? session.name() : null;
        panel.startBotText(name ? `Welcome back, ${name}! What can I help with?` : cfg.branding.greeting);
        greeted = true;
      }
    }
  });

  const send = (text: string) => {
    emit(analytics, "message", { text });
    panel.addUser(text);
    orb.setThinking(true);
    const line = panel.startBot();
    sendChat(
      cfg.workerUrl,
      { session_id: session.id(), message: text, consent: session.consent() ?? { agreed: false } },
      {
        onToken: (t) => panel.appendBot(line, t),
        onLead: (lead) => {
          const nm = (lead as { name?: string })?.name;
          if (nm && cfg.behavior.rememberReturning) session.setName(nm.split(" ")[0]);
          panel.note("✓ sent to Mohan");
          emit(analytics, "lead", lead);
        },
        onDone: (reply) => { panel.endBot(line, reply); orb.setThinking(false); },
        onError: () => { line.remove(); panel.showError(); orb.setThinking(false); emit(analytics, "error"); },
        onBlocked: () => { line.remove(); orb.setThinking(false); emit(analytics, "blocked"); },
      },
      fetchImpl,
    );
  };

  panel.onSubmit((text: string) => {
    if (session.consent()) { send(text); return; }
    // First message: gate on consent, then send.
    panel.showConsent(cfg, () => { session.setConsent(cfg.privacy.consentText); send(text); });
  });

  return { refs };
}

// Auto-mount on load (skipped under test, which imports `mount` directly).
declare global { interface Window { AiVoiceBotConfig?: unknown; } }
if (typeof window !== "undefined" && window.AiVoiceBotConfig) mount(window.AiVoiceBotConfig);
```

> Note: `panel.ts` must expose two helpers `index.ts` uses — `startBotText(text)` (a one-shot bot line) and `endBot(el, finalText?)` (settle, optionally replacing with the final reply). Update `panel.ts`:
> - add `startBotText: (text: string) => void line("bot", text),`
> - change `endBot` to `endBot: (el: HTMLElement, finalText?: string) => { if (finalText) el.textContent = finalText; else if (!el.textContent) el.textContent = "…"; scroll(); },`
> Make these edits to `panel.ts` as part of this task and extend `tests/panel.test.ts` with a one-line assertion that `startBotText("Hi")` renders a `.msg.bot` reading "Hi".

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test` (full suite) → all pass. `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Build check**

Run: `npm run build` → produces `dist/ai-voice-bot.min.js`. Note the size: `gzip -c dist/ai-voice-bot.min.js | wc -c` should be well under 45 KB.

- [ ] **Step 6: Commit**

```bash
git add widget/src/index.ts widget/src/panel.ts widget/tests/index.test.ts widget/tests/panel.test.ts
git commit -m "feat(widget): integration — mount, greet, consent-gated streaming conversation"
```

---

### Task 7: Embed demo + README + smoke

**Files:**
- Create: `widget/demo-embed.html`, `widget/README.md`
- Modify: root `.gitignore` (add `widget/dist/`)
- Delete: `widget/demo.html` (the old raw-fetch tester, superseded)
- Test: manual (`wrangler dev` worker + open the embed demo).

- [ ] **Step 1: Gitignore the build output**

Append to root `.gitignore`: `widget/dist/`.

- [ ] **Step 2: Write `widget/demo-embed.html`**

`widget/demo-embed.html`:
```html
<!doctype html>
<meta charset="utf-8" />
<title>AI Voice Bot — embed demo</title>
<style>
  /* Deliberately aggressive host CSS to prove Shadow DOM isolation. */
  * { color: crimson !important; font-family: "Comic Sans MS", cursive !important; }
  body { max-width: 620px; margin: 40px auto; }
</style>
<h1>Embed demo</h1>
<p>The floating orb (bottom-right) is the widget. This page's loud CSS must NOT affect it.</p>
<script>
  window.AiVoiceBotConfig = {
    workerUrl: "http://localhost:8787",
    branding: { botName: "Leo", themeColor: "#6C5CE7", greeting: "Hi, I'm Leo — how can I help?" },
    privacy: { consentText: "I agree to share my info so Mohan can follow up.", privacyPolicyUrl: "https://devmohan.in/privacy" },
    advanced: { analyticsCallback: (e, p) => console.log("[analytics]", e, p || "") },
  };
</script>
<script src="./dist/ai-voice-bot.min.js" defer></script>
```

- [ ] **Step 3: Write `widget/README.md`**

`widget/README.md`:
```md
# ai-voice-bot-widget

Embeddable chat widget (text-first) for the AI Voice Bot. Self-mounting, zero-dep, Shadow-DOM isolated.

## Build & test
```bash
cd widget
npm install
npm test           # unit tests (config, SSE client, session, DOM via happy-dom)
npm run build      # -> dist/ai-voice-bot.min.js
```

## Local smoke
1. In another terminal, run the Worker: `cd ../worker && npm run dev` (http://localhost:8787). Add `MODE=dev` to `worker/.dev.vars` to bypass guards while testing.
2. `cd widget && npm run build`
3. Open `widget/demo-embed.html` in a browser.

## Embed on a site
```html
<script>window.AiVoiceBotConfig = { workerUrl: "https://voicebot.devmohan.in", /* branding, privacy, ... */ };</script>
<script src="https://cdn.jsdelivr.net/npm/ai-voice-bot-widget/dist/ai-voice-bot.min.js" defer></script>
```
(npm/CDN publish lands in v0.3; until then use the locally-built `dist/ai-voice-bot.min.js`.)
```

- [ ] **Step 4: Delete the old demo + build**

```bash
cd ~/Documents/ai-voice-bot
git rm widget/demo.html
cd widget && npm run build
```

- [ ] **Step 5: Manual smoke test (human runs this)**

Run the Worker (`cd worker && npm run dev`, with `MODE=dev`), then open `widget/demo-embed.html`. Verify:
1. The orb appears bottom-right and is **unaffected** by the page's crimson/Comic-Sans CSS (Shadow DOM works).
2. Click it → panel opens, greeting shows.
3. Type a message → **first send shows the consent gate**; agree → the message sends and Leo's reply **streams in**.
4. Give name + email + ask → a "✓ sent to Mohan" note; lead hits the webhook.
5. Reload the page → returning-visitor greeting ("Welcome back, …") if a name was captured.
6. `console.log` shows `[analytics]` open/message/lead events.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/demo-embed.html widget/README.md .gitignore
git commit -m "feat(widget): embed demo (proves Shadow DOM isolation) + README; drop old demo.html"
```

---

## Self-Review

**Spec coverage (v0.2b):**
- Self-mounting TS→esbuild IIFE, zero deps — Task 1 (build) + Task 6 (auto-mount). ✅
- Shadow DOM isolation — Task 4 + Task 7 demo proves it. ✅
- SSE streaming client (token/lead/done/error/blocked, partial frames) — Task 2. ✅
- Orb (idle/thinking) + chat panel + streaming render — Tasks 4–5. ✅
- Consent gate before first message; timestamped, sent in body — Tasks 3, 5, 6. ✅
- session_id persistence + returning-visitor name greeting — Tasks 3, 6. ✅
- Config surface + defaults + dormant on missing workerUrl + ignore unknown/voice keys — Task 1. ✅
- Analytics callback (open/message/lead/error/blocked) — Tasks 2, 6. ✅
- Never throws into host (config/network/localStorage guarded) — Tasks 1–3, 6. ✅
- Bundle < 45 KB gz — verified in Task 6/7 build. ✅
- *Deferred (correctly out of scope):* mic/STT, TTS/neural voice, orb listening/speaking (v0.2c); npm/CDN publish + deploy (v0.3).

**Placeholder scan:** No TBD/TODO. Every code step is complete. The one cross-task edit (Task 6 adds `startBotText` + extends `endBot` in `panel.ts`, created in Task 5) is spelled out explicitly with the exact code and a test addition.

**Type consistency:** `Refs` shape identical across dom.ts, orb.ts, panel.ts, index.ts. `ChatEvents` identical across client.ts and index.ts. `WidgetConfig`/`RawConfig`/`DEFAULTS` consistent across config.ts, types.ts, dom.ts, index.ts. `Store`/`Consent` consistent across session.ts and index.ts. The `/chat` body `{ session_id, message, consent }` and SSE event names (`token`/`lead`/`done`/`error`) match the merged v0.2a backend and the demo.

---

*End of v0.2b plan. Next: v0.2c (voice) and v0.3 (publish + deploy).*
