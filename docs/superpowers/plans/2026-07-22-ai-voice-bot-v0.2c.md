# AI Voice Bot v0.2c — Voice (STT + TTS) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add voice to the v0.2b widget — a tap-to-talk mic (browser `SpeechRecognition`, text always available) and a spoken reply (Groq neural TTS via a new `/tts` endpoint, browser `speechSynthesis` fallback, silent last resort). Voice is opt-in and calm: Leo speaks only when spoken to, or when a mute/unmute toggle is on; all mic/audio starts on a user gesture.

**Architecture:** One new backend endpoint (`worker/src/tts.ts` + a route in `worker/src/index.ts`), guarded exactly like `/chat` (origin + dev/prod `enforce`, injectable `fetchImpl`). Two new widget modules under `widget/src/voice/` (`stt.ts`, `tts.ts`) with injectable browser APIs so they're unit-testable without a real mic/speaker. The orb gains `listening`/`speaking` states; the DOM shell gains a mic button and a sound toggle; `index.ts` wires it all into the existing consent-gated send flow.

**Tech Stack:** TypeScript, Vitest (+happy-dom for DOM), esbuild. No new runtime dependencies (browser `SpeechRecognition`/`speechSynthesis`/`Audio` are platform APIs, not npm packages).

## Global Constraints

- **Never throw into the host page.** Mic/TTS setup failures are caught locally; the mic disables with a hint, TTS falls back to browser voice or silence. The rest of the widget keeps working.
- **All mic capture and first audio playback are triggered by a user gesture** (mic tap or the sound toggle) — no autoplay, per iOS Safari rules.
- **Text-first, voice opt-in.** Text input and the existing send flow are never blocked or altered by voice failing to initialize.
- **Zero new runtime dependencies**; bundle stays well under 45 KB gz (verified in Task 10).
- **`voice.enabled: false` is a master off-switch** — no mic, no speaking, no `/tts` calls.
- **Backend `/tts` reuses the `/chat` guard pattern exactly**: origin check + text-length cap, both bypassed in `MODE=dev`, enforced in prod.
- **Accessibility:** mic button and sound toggle are real `<button>` elements (keyboard-operable), have `aria-label`/`aria-pressed`; new orb animations respect `prefers-reduced-motion` (existing media-query block is extended, not replaced).
- Discipline: TDD, `npx tsc --noEmit` clean before each commit (run in `worker/` for backend tasks, `widget/` for widget tasks), frequent commits.

---

### Task 1: Backend — `synthesizeSpeech()` (pure Groq TTS call)

**Files:**
- Create: `worker/src/tts.ts`
- Test: `worker/tests/tts.test.ts`

**Interfaces:**
- Produces: `TtsResult = { ok: true; body: ArrayBuffer; contentType: string } | { ok: false; status: number; error: string }`; `synthesizeSpeech(text: string, voice: string, apiKey: string, fetchImpl: typeof fetch): Promise<TtsResult>`.

- [ ] **Step 1: Write the failing test**

`worker/tests/tts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { synthesizeSpeech } from "../src/tts";

describe("synthesizeSpeech", () => {
  it("returns audio bytes + content-type on a successful Groq response", async () => {
    const fake = (async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.groq.com/openai/v1/audio/speech");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ model: "playai-tts", voice: "Fritz-PlayAI", input: "hi", response_format: "wav" });
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer key");
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/wav" } });
    }) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "Fritz-PlayAI", "key", fake);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("audio/wav");
      expect(new Uint8Array(result.body)).toEqual(new Uint8Array([1, 2, 3]));
    }
  });

  it("returns a 502 failure when Groq responds non-OK", async () => {
    const fake = (async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "v", "key", fake);
    expect(result).toEqual({ ok: false, status: 502, error: "groq tts error 500" });
  });

  it("returns a 502 failure on a network error", async () => {
    const fake = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "v", "key", fake);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("offline");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd worker && npx vitest run tests/tts.test.ts` → FAIL (module `../src/tts` not found).

- [ ] **Step 3: Write `worker/src/tts.ts`**

```ts
export interface TtsSuccess { ok: true; body: ArrayBuffer; contentType: string; }
export interface TtsFailure { ok: false; status: number; error: string; }
export type TtsResult = TtsSuccess | TtsFailure;

export async function synthesizeSpeech(
  text: string,
  voice: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<TtsResult> {
  try {
    const res = await fetchImpl("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "playai-tts", voice, input: text, response_format: "wav" }),
    });
    if (!res.ok) return { ok: false, status: 502, error: `groq tts error ${res.status}` };
    const body = await res.arrayBuffer();
    return { ok: true, body, contentType: res.headers.get("content-type") || "audio/wav" };
  } catch (e) {
    return { ok: false, status: 502, error: String((e as Error).message) };
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run tests/tts.test.ts` → PASS (3 passed). Then `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add worker/src/tts.ts worker/tests/tts.test.ts
git commit -m "feat(worker): synthesizeSpeech() — injectable Groq neural TTS call"
```

---

### Task 2: Backend — wire `POST /tts` (config, route, `/health`)

**Files:**
- Modify: `worker/src/config.ts`, `worker/src/index.ts`, `worker/wrangler.toml`
- Test: `worker/tests/tts-route.test.ts`

**Interfaces:**
- Consumes: `synthesizeSpeech` (Task 1).
- Produces: `AppConfig.ttsVoice: string`, `AppConfig.maxTtsChars: number`; `Deps.fetchImpl?: typeof fetch` (new **optional** field, used only by `/tts`, resolved as `deps.fetchImpl ?? fetch` — optional so every existing `createApp({...})` call in `chat.test.ts` that omits it keeps type-checking); `POST /tts` route; `/health` now reports `tts: "groq" | "browser"` based on `GROQ_API_KEY` presence (was hardcoded `"browser"`).

- [ ] **Step 1: Add `ttsVoice`/`maxTtsChars` to `worker/src/config.ts`**

In `AppConfig`, add after `mode: "dev" | "prod";`:
```ts
  ttsVoice: string;
  maxTtsChars: number;
```

In `Env`, add after `MODE?: string;`:
```ts
  TTS_VOICE?: string;
  MAX_TTS_CHARS?: string;
```

In `loadConfig`, add after `mode: env.MODE === "dev" ? "dev" : "prod",`:
```ts
    ttsVoice: env.TTS_VOICE || "Fritz-PlayAI",
    maxTtsChars: Number(env.MAX_TTS_CHARS || "1200"),
```

- [ ] **Step 2: Write the failing endpoint test**

`worker/tests/tts-route.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createApp } from "../src/index";
import type { Env } from "../src/config";
import type { SessionState } from "../src/session-store";

// /tts never touches buildModel/getSession/makeRunner; these stubs just satisfy the Deps type.
const stubDeps = {
  buildModel: (() => ({ bindTools: () => ({ invoke: async () => ({}) }) })) as any,
  getSession: () => ({ load: async () => ({ messages: [], lead: {}, leadSaved: false, turns: 0 } as SessionState), save: async () => {} }),
  makeRunner: () => (() => ({ tokens: (async function* () {})(), final: Promise.resolve({ messages: [], leadSaved: false, lead: {} }) })) as any,
};

const env = { GROQ_API_KEY: "x", ALLOWED_ORIGINS: "https://devmohan.in" } as unknown as Env;
const ttsReq = (body: unknown, origin = "https://devmohan.in") =>
  new Request("https://w/tts", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("/tts", () => {
  it("returns audio bytes on a mocked Groq response", async () => {
    const fetchImpl = (async () => new Response(new Uint8Array([9, 9]), { status: 200, headers: { "content-type": "audio/wav" } })) as unknown as typeof fetch;
    const app = createApp({ ...stubDeps, fetchImpl });
    const res = await app.fetch(ttsReq({ text: "hi" }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
  });

  it("rejects a disallowed origin with 403 (prod)", async () => {
    const app = createApp({ ...stubDeps, fetchImpl: fetch });
    const res = await app.fetch(ttsReq({ text: "hi" }, "https://evil.example"), env);
    expect(res.status).toBe(403);
  });

  it("rejects empty text with 400", async () => {
    const app = createApp({ ...stubDeps, fetchImpl: fetch });
    const res = await app.fetch(ttsReq({ text: "" }), env);
    expect(res.status).toBe(400);
  });

  it("rejects over-cap text with 413", async () => {
    const app = createApp({ ...stubDeps, fetchImpl: fetch });
    const res = await app.fetch(ttsReq({ text: "a".repeat(1300) }), env);
    expect(res.status).toBe(413);
  });

  it("returns 502 when Groq fails", async () => {
    const fetchImpl = (async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    const app = createApp({ ...stubDeps, fetchImpl });
    const res = await app.fetch(ttsReq({ text: "hi" }), env);
    expect(res.status).toBe(502);
  });

  it("bypasses origin + length guards in dev mode", async () => {
    const devEnv = { ...env, MODE: "dev" } as unknown as Env;
    const fetchImpl = (async () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "audio/wav" } })) as unknown as typeof fetch;
    const app = createApp({ ...stubDeps, fetchImpl });
    const res = await app.fetch(ttsReq({ text: "a".repeat(1300) }, "https://evil.example"), devEnv);
    expect(res.status).toBe(200);
  });

  it("/health reports the tts provider from GROQ_API_KEY presence", async () => {
    const app = createApp({ ...stubDeps, fetchImpl: fetch });
    const withKey = await app.fetch(new Request("https://w/health"), env);
    expect((await withKey.json() as any).tts).toBe("groq");
    const noKeyEnv = { ...env, GROQ_API_KEY: undefined } as unknown as Env;
    const withoutKey = await app.fetch(new Request("https://w/health"), noKeyEnv);
    expect((await withoutKey.json() as any).tts).toBe("browser");
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `npx vitest run tests/tts-route.test.ts` → FAIL (no `/tts` route yet: 404s; `Deps` type error on missing `fetchImpl`).

- [ ] **Step 4: Wire the route in `worker/src/index.ts`**

Add the import at the top (alongside the existing `stream` import):
```ts
import { synthesizeSpeech } from "./tts";
```

Change the `Deps` interface to add an **optional** `fetchImpl` (optional so every existing `createApp({...})` call in `chat.test.ts` — which never passes it — keeps compiling unchanged):
```ts
export interface Deps {
  buildModel: typeof buildModel;
  getSession: (env: Env, sessionId: string) => SessionHandle;
  makeRunner: (graph: ReturnType<typeof buildGraph>) => GraphRunner;
  fetchImpl?: typeof fetch;
}
```

The default-deps object in the `createApp` signature is unchanged (no default needed for an optional field):
```ts
export function createApp(
  deps: Deps = { buildModel, getSession: doGetSession, makeRunner: makeGraphRunner },
) {
```

In the `/health` handler, change the hardcoded `tts: "browser"` to:
```ts
          { ok: true, provider: config.defaultProvider, model: p?.model, tts: env.GROQ_API_KEY ? "groq" : "browser", leads: env.WEBHOOK_URL ? "webhook" : "none", mode: config.mode },
```

Add the new route immediately after the closing `}` of the `/chat` block (before `return new Response("Not found", ...)`):
```ts
      if (url.pathname === "/tts" && request.method === "POST") {
        if (enforce && config.allowedOrigins.length && !config.allowedOrigins.includes(origin)) {
          return Response.json({ error: "origin not allowed" }, { status: 403, headers: cors });
        }
        const body = (await request.json().catch(() => null)) as { text?: string; voice?: string } | null;
        if (!body?.text || !body.text.trim()) {
          return Response.json({ error: "text is required" }, { status: 400, headers: cors });
        }
        if (enforce && body.text.length > config.maxTtsChars) {
          return Response.json({ error: "text too long" }, { status: 413, headers: cors });
        }
        if (!env.GROQ_API_KEY) {
          return Response.json({ error: "tts not configured" }, { status: 502, headers: cors });
        }
        const voice = body.voice || config.ttsVoice;
        const result = await synthesizeSpeech(body.text, voice, env.GROQ_API_KEY, deps.fetchImpl ?? fetch);
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status, headers: cors });
        return new Response(result.body, { status: 200, headers: { ...cors, "content-type": result.contentType } });
      }
```

- [ ] **Step 5: Add the new vars to `worker/wrangler.toml`**

In the `[vars]` block, add:
```toml
TTS_VOICE = "Fritz-PlayAI"
MAX_TTS_CHARS = "1200"
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `npx vitest run` (full worker suite — the existing `chat.test.ts` still constructs `Deps` fully, so this also confirms nothing else broke) → all PASS. Then `npx tsc --noEmit` → 0 errors.

- [ ] **Step 7: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add worker/src/config.ts worker/src/index.ts worker/wrangler.toml worker/tests/tts-route.test.ts
git commit -m "feat(worker): POST /tts route (origin+length guards, dev bypass) + /health tts field"
```

---

### Task 3: Widget — `voice`/`language` config surface

**Files:**
- Modify: `widget/src/types.ts`, `widget/src/config.ts`
- Test: `widget/tests/config.test.ts`

**Interfaces:**
- Produces: `WidgetConfig.behavior.language: string`; `WidgetConfig.voice: { enabled: boolean; ttsVoice: string; speakByDefault: boolean }`. Merged over `DEFAULTS` the same way every other section is; unknown keys still ignored (already true — this just adds a recognized section).

- [ ] **Step 1: Write the failing test additions**

Append to `widget/tests/config.test.ts` (inside the existing `describe("validateConfig", ...)` block):
```ts
  it("fills voice + language defaults", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test" });
    expect(cfg!.behavior.language).toBe("en-US");
    expect(cfg!.voice).toEqual({ enabled: true, ttsVoice: "Fritz-PlayAI", speakByDefault: false });
  });

  it("merges partial voice config over defaults", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test", voice: { ttsVoice: "Arista-PlayAI" } } as any);
    expect(cfg!.voice.ttsVoice).toBe("Arista-PlayAI");
    expect(cfg!.voice.enabled).toBe(true);
  });
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/config.test.ts` → FAIL (`cfg!.voice` is `undefined`).

- [ ] **Step 3: Update `widget/src/types.ts`**

Change `WidgetConfig.behavior` to add `language`:
```ts
  behavior: { autoGreet: boolean; rememberReturning: boolean; language: string };
```

Add a `voice` field to `WidgetConfig` (after `advanced`):
```ts
  voice: { enabled: boolean; ttsVoice: string; speakByDefault: boolean };
```

Add `voice` to `RawConfig`'s `Partial<{...}>` (after `advanced`):
```ts
  voice: Partial<WidgetConfig["voice"]>;
```

- [ ] **Step 4: Update `widget/src/config.ts`**

Change the `behavior` default to add `language`:
```ts
  behavior: { autoGreet: true, rememberReturning: true, language: "en-US" },
```

Add a `voice` default (after `advanced`):
```ts
  advanced: { analyticsCallback: null },
  voice: { enabled: true, ttsVoice: "Fritz-PlayAI", speakByDefault: false },
```

Add the merge line in `validateConfig`'s return object (after the `advanced` line):
```ts
    voice: { ...DEFAULTS.voice, ...(r.voice ?? {}) },
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npx vitest run tests/config.test.ts` → PASS (all cases). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/types.ts widget/src/config.ts widget/tests/config.test.ts
git commit -m "feat(widget): voice + behavior.language config surface (voice.enabled off-switch)"
```

---

### Task 4: Widget — sound-toggle persistence in `session.ts`

**Files:**
- Modify: `widget/src/session.ts`
- Test: `widget/tests/session.test.ts`

**Interfaces:**
- Consumes: `Store` (existing).
- Produces: `Session.soundOn(defaultValue: boolean): boolean`, `Session.setSoundOn(v: boolean): void`. `forget()` also clears the stored sound preference.

- [ ] **Step 1: Write the failing test additions**

Append to `widget/tests/session.test.ts`:
```ts
  it("persists the sound-toggle preference, defaulting when unset", () => {
    const store = memoryStore();
    const s = createSession(store);
    expect(s.soundOn(false)).toBe(false);
    expect(s.soundOn(true)).toBe(true);
    s.setSoundOn(true);
    expect(createSession(store).soundOn(false)).toBe(true);
  });

  it("forget() also clears the sound preference", () => {
    const store = memoryStore();
    const s = createSession(store);
    s.setSoundOn(true);
    s.forget();
    expect(s.soundOn(false)).toBe(false);
  });
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/session.test.ts` → FAIL (`s.soundOn` is not a function).

- [ ] **Step 3: Update `widget/src/session.ts`**

Add a new key constant (alongside `K_ID`, `K_NAME`, `K_CONSENT`):
```ts
const K_ID = "avb_session", K_NAME = "avb_name", K_CONSENT = "avb_consent", K_SOUND = "avb_sound";
```

Add `soundOn`/`setSoundOn` to the object `createSession` returns (after `setConsent`):
```ts
    soundOn: (defaultValue: boolean): boolean => {
      const raw = store.get(K_SOUND);
      return raw === null ? defaultValue : raw === "1";
    },
    setSoundOn: (v: boolean) => store.set(K_SOUND, v ? "1" : "0"),
```

Update `forget()` to also remove the sound key:
```ts
    forget: () => { store.remove(K_ID); store.remove(K_NAME); store.remove(K_CONSENT); store.remove(K_SOUND); },
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run tests/session.test.ts` → PASS (6 passed). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/session.ts widget/tests/session.test.ts
git commit -m "feat(widget): persist the sound-toggle preference in session storage"
```

---

### Task 5: Widget — STT (`voice/stt.ts`)

**Files:**
- Create: `widget/src/voice/stt.ts`
- Test: `widget/tests/voice/stt.test.ts`

**Interfaces:**
- Produces: `sttSupported(w?: unknown): boolean`; `RecognitionHandlers = { onResult(text: string): void; onEnd(): void; onError(message: string): void }`; `createRecognizer(lang: string, handlers: RecognitionHandlers, w?: unknown): { start(): void; stop(): void } | null` — `null` when unsupported.

- [ ] **Step 1: Write the failing test**

A plain object literal can't stand in for `new SpeechRecognition()` (we need to reach the constructed instance to fire `.onresult`/`.onend`/`.onerror` on it), so the fake is a real, minimal constructor function that stashes the last instance it created:

`widget/tests/voice/stt.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sttSupported, createRecognizer } from "../../src/voice/stt";

interface Instance {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
}

function fakeCtor() {
  let last: Instance | null = null;
  function Ctor(this: Instance) {
    this.lang = ""; this.continuous = true; this.interimResults = true;
    this.onresult = null; this.onerror = null; this.onend = null;
    this.start = () => {}; this.stop = () => {};
    last = this;
  }
  return { Ctor: Ctor as unknown as new () => Instance, last: () => last! };
}

describe("sttSupported", () => {
  it("is false when neither SpeechRecognition constructor exists", () => {
    expect(sttSupported({})).toBe(false);
  });
  it("is true when webkitSpeechRecognition exists", () => {
    expect(sttSupported({ webkitSpeechRecognition: function () {} })).toBe(true);
  });
  it("is true when SpeechRecognition exists", () => {
    expect(sttSupported({ SpeechRecognition: function () {} })).toBe(true);
  });
});

describe("createRecognizer", () => {
  it("returns null when unsupported", () => {
    expect(createRecognizer("en-US", { onResult() {}, onEnd() {}, onError() {} }, {})).toBeNull();
  });

  it("sets single-utterance mode and the requested language", () => {
    const { Ctor, last } = fakeCtor();
    createRecognizer("fr-FR", { onResult() {}, onEnd() {}, onError() {} }, { SpeechRecognition: Ctor });
    expect(last().lang).toBe("fr-FR");
    expect(last().continuous).toBe(false);
  });

  it("forwards a recognition result's transcript", () => {
    const { Ctor, last } = fakeCtor();
    const results: string[] = [];
    createRecognizer("en-US", { onResult: (t) => results.push(t), onEnd() {}, onError() {} }, { SpeechRecognition: Ctor });
    last().onresult!({ results: [[{ transcript: "hello there" }]] });
    expect(results).toEqual(["hello there"]);
  });

  it("forwards onend and onerror", () => {
    const { Ctor, last } = fakeCtor();
    let ended = false, errMsg = "";
    createRecognizer("en-US", { onResult() {}, onEnd: () => { ended = true; }, onError: (m) => { errMsg = m; } }, { SpeechRecognition: Ctor });
    last().onend!();
    last().onerror!({ error: "not-allowed" });
    expect(ended).toBe(true);
    expect(errMsg).toBe("not-allowed");
  });

  it("start()/stop() delegate to the underlying instance", () => {
    const { Ctor, last } = fakeCtor();
    let started = false, stopped = false;
    const wrapper = createRecognizer("en-US", { onResult() {}, onEnd() {}, onError() {} }, { SpeechRecognition: Ctor })!;
    last().start = () => { started = true; };
    last().stop = () => { stopped = true; };
    wrapper.start();
    wrapper.stop();
    expect(started).toBe(true);
    expect(stopped).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run tests/voice/stt.test.ts` → FAIL (module `../../src/voice/stt` not found).

- [ ] **Step 3: Write `widget/src/voice/stt.ts`**

```ts
export interface RecognitionHandlers {
  onResult(text: string): void;
  onEnd(): void;
  onError(message: string): void;
}

interface MinimalRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => MinimalRecognition;

function getCtor(w: unknown): RecognitionCtor | undefined {
  const obj = (w ?? {}) as Record<string, unknown>;
  return (obj.SpeechRecognition as RecognitionCtor | undefined) ?? (obj.webkitSpeechRecognition as RecognitionCtor | undefined);
}

export function sttSupported(w: unknown = typeof window !== "undefined" ? window : {}): boolean {
  return !!getCtor(w);
}

export function createRecognizer(
  lang: string,
  handlers: RecognitionHandlers,
  w: unknown = typeof window !== "undefined" ? window : {},
): { start(): void; stop(): void } | null {
  const Ctor = getCtor(w);
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = false;
  rec.onresult = (e) => handlers.onResult(e.results[0]?.[0]?.transcript ?? "");
  rec.onerror = (e) => handlers.onError(e.error ?? "recognition error");
  rec.onend = () => handlers.onEnd();
  return { start: () => rec.start(), stop: () => rec.stop() };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run tests/voice/stt.test.ts` → PASS (8 passed). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/voice/stt.ts widget/tests/voice/stt.test.ts
git commit -m "feat(widget): STT — sttSupported() + single-utterance createRecognizer()"
```

---

### Task 6: Widget — TTS fallback chain (`voice/tts.ts`)

**Files:**
- Create: `widget/src/voice/tts.ts`
- Test: `widget/tests/voice/tts.test.ts`

**Interfaces:**
- Produces: `shouldSpeak(voiceInitiated: boolean, soundOn: boolean): boolean`; `SpeakerConfig = { workerUrl: string; voice: string; lang: string }`; `SpeakState = "idle" | "speaking"`; `AudioLike = { play(): Promise<void> | void; pause(): void; onended: (() => void) | null; onerror: ((e?: unknown) => void) | null }`; `SynthLike = { speak(u: { lang: string; onend: (() => void) | null }): void; cancel(): void }`; `createSpeaker(cfg: SpeakerConfig, deps?: { fetchImpl?: typeof fetch; synth?: SynthLike | null; makeUtterance?(text: string, lang: string): { lang: string; onend: (() => void) | null }; makeAudio?(res: Response): AudioLike | Promise<AudioLike> }): { speak(text: string): Promise<void>; stop(): void; onState(cb: (s: SpeakState) => void): void }`.

- [ ] **Step 1: Write the failing test**

`widget/tests/voice/tts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createSpeaker, shouldSpeak } from "../../src/voice/tts";

function fakeAudio() {
  const a = { played: false, paused: false, onended: null as (() => void) | null, onerror: null as (() => void) | null,
    play: async () => { a.played = true; }, pause: () => { a.paused = true; } };
  return a;
}

describe("shouldSpeak", () => {
  it("speaks when voice-initiated OR sound is on", () => {
    expect(shouldSpeak(true, false)).toBe(true);
    expect(shouldSpeak(false, true)).toBe(true);
    expect(shouldSpeak(true, true)).toBe(true);
    expect(shouldSpeak(false, false)).toBe(false);
  });
});

describe("createSpeaker", () => {
  const cfg = { workerUrl: "https://w.test", voice: "Fritz-PlayAI", lang: "en-US" };

  it("plays the neural audio and reports speaking then idle", async () => {
    const audio = fakeAudio();
    const states: string[] = [];
    const fetchImpl = (async () => new Response("bytes", { status: 200 })) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, { fetchImpl, makeAudio: () => audio });
    speaker.onState((s) => states.push(s));
    await speaker.speak("Hi there");
    expect(audio.played).toBe(true);
    expect(states).toEqual(["speaking"]);
    audio.onended!();
    expect(states).toEqual(["speaking", "idle"]);
  });

  it("falls back to browser synth when /tts responds non-OK", async () => {
    const states: string[] = [];
    const spoken: string[] = [];
    const utterances: { lang: string; onend: (() => void) | null }[] = [];
    const synth = { speak: (u: { lang: string; onend: (() => void) | null }) => { spoken.push(u.lang); utterances.push(u); }, cancel: () => {} };
    const fetchImpl = (async () => new Response("bad", { status: 502 })) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, { fetchImpl, synth, makeUtterance: (text, lang) => ({ text, lang, onend: null } as any) });
    speaker.onState((s) => states.push(s));
    await speaker.speak("Hi there");
    expect(spoken).toEqual(["en-US"]);
    expect(states).toEqual(["speaking"]);
    utterances[0].onend!();
    expect(states).toEqual(["speaking", "idle"]);
  });

  it("stays silent (never 'speaking') when neither neural nor synth is available", async () => {
    const states: string[] = [];
    const fetchImpl = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, { fetchImpl });
    speaker.onState((s) => states.push(s));
    await speaker.speak("Hi there");
    expect(states).toEqual([]);
  });

  it("stop() pauses current audio and cancels synth", async () => {
    const audio = fakeAudio();
    const cancelled: boolean[] = [];
    const synth = { speak: () => {}, cancel: () => cancelled.push(true) };
    const fetchImpl = (async () => new Response("bytes", { status: 200 })) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, { fetchImpl, synth, makeAudio: () => audio });
    await speaker.speak("Hi there");
    speaker.stop();
    expect(audio.paused).toBe(true);
    expect(cancelled).toEqual([true]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/voice/tts.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write `widget/src/voice/tts.ts`**

```ts
export interface SpeakerConfig { workerUrl: string; voice: string; lang: string; }
export type SpeakState = "idle" | "speaking";

export interface UtteranceLike { lang: string; onend: (() => void) | null; }
export interface SynthLike { speak(u: UtteranceLike): void; cancel(): void; }
export interface AudioLike { play(): Promise<void> | void; pause(): void; onended: (() => void) | null; onerror: ((e?: unknown) => void) | null; }

export interface SpeakerDeps {
  fetchImpl?: typeof fetch;
  synth?: SynthLike | null;
  makeUtterance?(text: string, lang: string): UtteranceLike;
  makeAudio?(res: Response): AudioLike | Promise<AudioLike>;
}

export interface Speaker {
  speak(text: string): Promise<void>;
  stop(): void;
  onState(cb: (s: SpeakState) => void): void;
}

export function shouldSpeak(voiceInitiated: boolean, soundOn: boolean): boolean {
  return voiceInitiated || soundOn;
}

export function createSpeaker(cfg: SpeakerConfig, deps: SpeakerDeps = {}): Speaker {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let stateCb: ((s: SpeakState) => void) | null = null;
  let currentAudio: AudioLike | null = null;
  const setState = (s: SpeakState) => stateCb?.(s);

  const speakBrowser = (text: string) => {
    if (!deps.synth) return;
    const utter = deps.makeUtterance
      ? deps.makeUtterance(text, cfg.lang)
      : Object.assign(new SpeechSynthesisUtterance(text), { lang: cfg.lang });
    utter.onend = () => setState("idle");
    setState("speaking");
    deps.synth.speak(utter);
  };

  return {
    async speak(text: string): Promise<void> {
      try {
        const res = await fetchImpl(`${cfg.workerUrl}/tts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, voice: cfg.voice }),
        });
        if (!res.ok) { speakBrowser(text); return; }
        const audio = deps.makeAudio
          ? await deps.makeAudio(res)
          : (new Audio(URL.createObjectURL(await res.blob())) as unknown as AudioLike);
        currentAudio = audio;
        audio.onended = () => setState("idle");
        audio.onerror = () => { setState("idle"); speakBrowser(text); };
        setState("speaking");
        await audio.play();
      } catch {
        speakBrowser(text);
      }
    },
    stop(): void {
      currentAudio?.pause();
      deps.synth?.cancel();
    },
    onState(cb: (s: SpeakState) => void): void { stateCb = cb; },
  };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run tests/voice/tts.test.ts` → PASS (7 passed). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/voice/tts.ts widget/tests/voice/tts.test.ts
git commit -m "feat(widget): TTS fallback chain — neural /tts -> browser synth -> silent"
```

---

### Task 7: Widget — orb `listening`/`speaking` states

**Files:**
- Modify: `widget/src/orb.ts`, `widget/src/styles.ts`
- Test: `widget/tests/orb.test.ts`

**Interfaces:**
- Consumes: `Refs` (existing).
- Produces: `wireOrb(...)` now also returns `setListening(on: boolean): void` and `setSpeaking(on: boolean): void`, alongside the existing `setThinking`. Exactly one of `idle|thinking|listening|speaking` is active on the orb at a time.

- [ ] **Step 1: Write the failing test additions**

Append to `widget/tests/orb.test.ts` (inside `describe("wireOrb", ...)`):
```ts
  it("setListening and setSpeaking toggle the right classes, mutually exclusive with each other and thinking", () => {
    const refs = mountShell(cfg);
    const orb = wireOrb(refs);
    orb.setListening(true);
    expect(refs.orb.classList.contains("listening")).toBe(true);
    expect(refs.orb.classList.contains("idle")).toBe(false);
    orb.setSpeaking(true);
    expect(refs.orb.classList.contains("speaking")).toBe(true);
    expect(refs.orb.classList.contains("listening")).toBe(false);
    orb.setThinking(true);
    expect(refs.orb.classList.contains("thinking")).toBe(true);
    expect(refs.orb.classList.contains("speaking")).toBe(false);
    orb.setSpeaking(false);
    expect(refs.orb.classList.contains("idle")).toBe(false); // thinking is still active
    expect(refs.orb.classList.contains("thinking")).toBe(true);
  });
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/orb.test.ts` → FAIL (`orb.setListening is not a function`).

- [ ] **Step 3: Update `widget/src/orb.ts`**

Replace the whole file with a state-machine version that keeps the same public shape plus the two new methods:

```ts
import type { Refs } from "./dom";

type OrbState = "idle" | "thinking" | "listening" | "speaking";
const STATES: OrbState[] = ["idle", "thinking", "listening", "speaking"];

export function wireOrb(refs: Refs, onToggle?: (open: boolean) => void) {
  const setOpen = (open: boolean) => {
    refs.panel.setAttribute("data-open", String(open));
    if (open) refs.input.focus();
    onToggle?.(open);
  };
  const isOpen = () => refs.panel.getAttribute("data-open") === "true";
  refs.orb.addEventListener("click", () => setOpen(!isOpen()));
  refs.panel.querySelector(".close")!.addEventListener("click", () => setOpen(false));

  const setState = (state: OrbState) => {
    for (const s of STATES) refs.orb.classList.toggle(s, s === state);
  };

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen()),
    isOpen,
    setThinking: (on: boolean) => setState(on ? "thinking" : "idle"),
    setListening: (on: boolean) => setState(on ? "listening" : "idle"),
    setSpeaking: (on: boolean) => setState(on ? "speaking" : "idle"),
  };
}
```

> Note: this collapses the old two-class toggle (`thinking`/`idle`) into a shared 4-state machine, so calling `setThinking(false)` (or `setListening(false)`/`setSpeaking(false)`) always lands back on `idle` — matching the existing test "setThinking swaps the orb state class" (still passes unchanged) plus the new exclusivity test above.

- [ ] **Step 4: Add `listening`/`speaking` orb styles to `widget/src/styles.ts`**

Add after the existing `.orb.thinking { font-size: 0; }` line:
```ts
  @keyframes avb-listen { 0%,100% { box-shadow: 0 6px 24px rgba(0,0,0,.28); } 50% { box-shadow: 0 0 0 8px ${theme}33; } }
  .orb.listening { animation: avb-listen 1.2s ease-in-out infinite; }
  @keyframes avb-speak { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
  .orb.speaking { animation: avb-speak .6s ease-in-out infinite; }
```

Extend the existing reduced-motion media query (currently `@media (prefers-reduced-motion: reduce) { .orb.idle { animation: none; } .orb.thinking::after { animation-duration: 1.6s; } }`) to also calm the two new states:
```ts
  @media (prefers-reduced-motion: reduce) { .orb.idle { animation: none; } .orb.thinking::after { animation-duration: 1.6s; } .orb.listening, .orb.speaking { animation: none; } }
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npx vitest run tests/orb.test.ts` → PASS (3 passed). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/orb.ts widget/src/styles.ts widget/tests/orb.test.ts
git commit -m "feat(widget): orb listening/speaking states (mutually exclusive, reduced-motion safe)"
```

---

### Task 8: Widget — DOM shell: mic button + sound toggle

**Files:**
- Modify: `widget/src/dom.ts`, `widget/src/styles.ts`
- Test: `widget/tests/dom.test.ts`

**Interfaces:**
- Produces: `Refs` gains `mic: HTMLButtonElement` and `sound: HTMLButtonElement`.

- [ ] **Step 1: Write the failing test addition**

Append to `widget/tests/dom.test.ts` (inside `describe("mountShell", ...)`):
```ts
  it("mounts a mic button and a sound toggle inside the shadow root", () => {
    const refs = mountShell(cfg);
    expect(refs.mic).toBeTruthy();
    expect(refs.sound).toBeTruthy();
    expect(refs.shadow.contains(refs.mic)).toBe(true);
    expect(refs.shadow.contains(refs.sound)).toBe(true);
    expect(refs.mic.getAttribute("type")).toBe("button");
    expect(refs.sound.getAttribute("aria-pressed")).toBe("false");
  });
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/dom.test.ts` → FAIL (`refs.mic` is `undefined`).

- [ ] **Step 3: Update `Refs` and the markup in `widget/src/dom.ts`**

Change the `Refs` interface:
```ts
export interface Refs {
  host: HTMLElement; shadow: ShadowRoot;
  orb: HTMLButtonElement; panel: HTMLElement; header: HTMLElement;
  list: HTMLElement; form: HTMLFormElement; input: HTMLInputElement;
  mic: HTMLButtonElement; sound: HTMLButtonElement;
}
```

Replace the `panel.innerHTML` template with one that adds the sound toggle to the header and the mic button to the form:
```ts
  panel.innerHTML = `
    <div class="hd">
      <span>${escapeHtml(cfg.branding.botName)}</span>
      <div class="hd-actions">
        <button type="button" class="sound" aria-label="Mute ${escapeHtml(cfg.branding.botName)}'s voice" aria-pressed="false">🔊</button>
        <button class="close" aria-label="Close">×</button>
      </div>
    </div>
    <div class="list"></div>
    <form>
      <input type="text" placeholder="Type a message…" autocomplete="off" aria-label="Message" />
      <button type="button" class="mic" aria-label="Speak your message">🎤</button>
      <button type="submit">Send</button>
    </form>
  `;
```

Add the two new refs to the returned object:
```ts
  return {
    host, shadow, orb, panel,
    header: panel.querySelector(".hd")!,
    list: panel.querySelector(".list")!,
    form: panel.querySelector("form")!,
    input: panel.querySelector("input")!,
    mic: panel.querySelector(".mic")!,
    sound: panel.querySelector(".sound")!,
  };
```

- [ ] **Step 4: Add styling for the new controls in `widget/src/styles.ts`**

Add after the `.hd button { ... }` line:
```ts
  .hd-actions { display: flex; align-items: center; gap: 2px; }
  form .mic { background: transparent; border: 1px solid #ddd; border-radius: 10px; padding: 8px 10px; cursor: pointer; font-size: 16px; }
  form .mic:disabled { opacity: .4; cursor: not-allowed; }
  form .mic.listening { border-color: ${theme}; }
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npx vitest run tests/dom.test.ts` → PASS (3 passed). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/dom.ts widget/src/styles.ts widget/tests/dom.test.ts
git commit -m "feat(widget): mic button + sound toggle in the Shadow DOM shell"
```

---

### Task 9: Widget — integration: tap-to-talk, speak decision, mute toggle

**Files:**
- Modify: `widget/src/index.ts`
- Test: `widget/tests/index.test.ts`

**Interfaces:**
- Consumes: `sttSupported`, `createRecognizer` (Task 5); `createSpeaker`, `shouldSpeak` (Task 6); `wireOrb`'s `setListening`/`setSpeaking` (Task 7); `refs.mic`/`refs.sound` (Task 8); `session.soundOn`/`setSoundOn` (Task 4); `cfg.behavior.language`, `cfg.voice` (Task 3).
- Produces: `MountDeps` gains an optional `synth?: SynthLike | null` (for tests to inject a fake `speechSynthesis`); mic tap fills the input and sends through the existing consent-gated flow, flagged as voice-initiated; on `done`, speaks the reply when `shouldSpeak(voiceInitiated, soundOn)`; sound toggle flips + persists `soundOn` and is reflected in its icon/`aria-pressed`.

- [ ] **Step 1: Write the failing test additions**

Append to `widget/tests/index.test.ts` (new imports at the top, then new `it` blocks inside `describe("mount", ...)`):
```ts
import { sttSupported } from "../src/voice/stt";
```

```ts
  it("disables the mic when SpeechRecognition is unsupported (default test env)", () => {
    const app = mount(baseCfg, { store: memoryStore(), fetchImpl: fetch })!;
    expect(sttSupported()).toBe(false); // sanity: no SpeechRecognition in this test env
    expect(app.refs.mic.disabled).toBe(true);
  });

  it("tap-to-talk: mic result fills + sends, and the reply is spoken (voice-initiated)", async () => {
    class FakeRecognition {
      static last: FakeRecognition | null = null;
      lang = ""; continuous = true; interimResults = true;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { FakeRecognition.last = this; }
      start() {}
      stop() {}
    }
    (window as any).SpeechRecognition = FakeRecognition;
    try {
      const ttsCalls: string[] = [];
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/tts")) { ttsCalls.push(String(url)); return new Response("audio", { status: 200 }); }
        return streamRes([sse("done", { reply: "Hey there", lead_saved: false })]);
      }) as unknown as typeof fetch;
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const app = mount(baseCfg, { store: memoryStore(), fetchImpl, makeAudio: () => audio })!;
      expect(app.refs.mic.disabled).toBe(false);
      app.refs.orb.click(); // open panel so the input/consent flow is visible
      app.refs.mic.click(); // start listening — createRecognizer() constructed FakeRecognition.last at mount time
      expect(app.refs.orb.classList.contains("listening")).toBe(true);
      // Simulate the browser delivering a transcript on the actual recognizer instance index.ts is holding.
      FakeRecognition.last!.onresult!({ results: [[{ transcript: "what do you do" }]] });
      expect(app.refs.input.value).toBe(""); // panel's submit handler already cleared it
      const consentBtn = app.refs.list.querySelector(".consent button") as HTMLButtonElement;
      expect(consentBtn).toBeTruthy(); // first message still gates on consent, even from voice
      consentBtn.click();
      await new Promise((r) => setTimeout(r, 0));
      expect(app.refs.list.textContent).toContain("what do you do");
      expect(app.refs.list.textContent).toContain("Hey there");
      expect(ttsCalls.length).toBeGreaterThan(0);
      expect(audio.played).toBe(true);
    } finally {
      delete (window as any).SpeechRecognition;
    }
  });

  it("sound toggle flips aria-pressed and persists across remounts", () => {
    const store = memoryStore();
    const app1 = mount(baseCfg, { store, fetchImpl: fetch })!;
    expect(app1.refs.sound.getAttribute("aria-pressed")).toBe("false");
    app1.refs.sound.click();
    expect(app1.refs.sound.getAttribute("aria-pressed")).toBe("true");
    const app2 = mount(baseCfg, { store, fetchImpl: fetch })!;
    expect(app2.refs.sound.getAttribute("aria-pressed")).toBe("true");
  });
```

> Note on the second test: `createRecognizer` (Task 5) is called once at `mount()` time, so the `FakeRecognition` instance it constructs is captured via `FakeRecognition.last` (same instance-capture trick as Task 5's `stt.test.ts`) and driven directly with `.onresult(...)` to simulate the browser delivering a transcript — this exercises the real `onResult` wiring in `index.ts` end-to-end (fill input → submit → consent gate → send, flagged voice-initiated). `makeAudio` is passed through `MountDeps` (added in Step 3 below) so the neural-TTS playback is fully fake, per the never-really-play-audio-in-unit-tests approach used in Task 6.

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/index.test.ts` → FAIL (`app.refs.mic` wiring doesn't exist yet; `disabled` stays `false`; no `/tts` calls happen).

- [ ] **Step 3: Update `widget/src/index.ts`**

Replace the file with the full integrated version:
```ts
import { validateConfig } from "./config";
import type { WidgetConfig } from "./types";
import { mountShell, type Refs } from "./dom";
import { wireOrb } from "./orb";
import { wirePanel } from "./panel";
import { createSession, safeStore, type Store } from "./session";
import { sendChat } from "./client";
import { emit } from "./analytics";
import { sttSupported, createRecognizer } from "./voice/stt";
import { createSpeaker, shouldSpeak, type SynthLike, type AudioLike } from "./voice/tts";

export interface MountDeps {
  store?: Store;
  fetchImpl?: typeof fetch;
  synth?: SynthLike | null;
  makeAudio?: (res: Response) => AudioLike | Promise<AudioLike>;
}

export function mount(rawConfig: unknown, deps: MountDeps = {}): { refs: Refs } | null {
  const cfg: WidgetConfig | null = validateConfig(rawConfig);
  if (!cfg) return null;

  try {
    const store = deps.store ?? safeStore();
    const fetchImpl = deps.fetchImpl ?? fetch;
    const session = createSession(store);
    const analytics = cfg.advanced.analyticsCallback;

    const refs = mountShell(cfg);
    const panel = wirePanel(refs);
    let greeted = false;
    let consentPending = false;
    let pendingVoice = false;
    let soundOn = session.soundOn(cfg.voice.speakByDefault);

    const speaker = cfg.voice.enabled
      ? createSpeaker(
          { workerUrl: cfg.workerUrl, voice: cfg.voice.ttsVoice, lang: cfg.behavior.language },
          {
            fetchImpl,
            synth: "synth" in deps ? deps.synth : (typeof window !== "undefined" && "speechSynthesis" in window ? (window.speechSynthesis as unknown as SynthLike) : null),
            makeAudio: deps.makeAudio,
          },
        )
      : null;

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
    speaker?.onState((s) => orb.setSpeaking(s === "speaking"));

    const renderSound = () => {
      refs.sound.textContent = soundOn ? "🔊" : "🔇";
      refs.sound.setAttribute("aria-pressed", String(soundOn));
    };
    renderSound();
    if (!cfg.voice.enabled) refs.sound.style.display = "none";
    refs.sound.addEventListener("click", () => {
      soundOn = !soundOn;
      session.setSoundOn(soundOn);
      renderSound();
      if (!soundOn) speaker?.stop();
    });

    const send = (text: string, voiceInitiated = false) => {
      emit(analytics, "message", { text, voiceInitiated });
      speaker?.stop();
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
            if (nm && typeof nm === "string" && cfg.behavior.rememberReturning) session.setName(nm.split(" ")[0]);
            panel.note("✓ sent to Mohan");
            emit(analytics, "lead", lead);
          },
          onDone: (reply) => {
            panel.endBot(line, reply);
            orb.setThinking(false);
            if (shouldSpeak(voiceInitiated, soundOn)) speaker?.speak(reply);
          },
          onError: () => { line.remove(); panel.showError(); orb.setThinking(false); emit(analytics, "error"); },
          onBlocked: () => { line.remove(); orb.setThinking(false); emit(analytics, "blocked"); },
        },
        fetchImpl,
      );
    };

    panel.onSubmit((text: string) => {
      const voiceInitiated = pendingVoice;
      pendingVoice = false;
      if (session.consent()) { send(text, voiceInitiated); return; }
      if (consentPending) return;
      consentPending = true;
      panel.showConsent(cfg, () => { consentPending = false; session.setConsent(cfg.privacy.consentText); send(text, voiceInitiated); });
    });

    let recognizer: { start(): void; stop(): void } | null = null;
    const canUseMic = cfg.voice.enabled && sttSupported();
    if (canUseMic) {
      try {
        recognizer = createRecognizer(cfg.behavior.language, {
          onResult: (text) => {
            const t = text.trim();
            orb.setListening(false);
            if (!t) return;
            refs.input.value = t;
            pendingVoice = true;
            refs.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
          },
          onEnd: () => orb.setListening(false),
          onError: () => orb.setListening(false),
        });
      } catch {
        recognizer = null;
      }
    }
    if (!recognizer) {
      refs.mic.disabled = true;
      refs.mic.title = "voice input isn't available in this browser — type instead";
    } else {
      refs.mic.addEventListener("click", () => {
        orb.setListening(true);
        recognizer!.start();
      });
    }

    return { refs };
  } catch (e) {
    console.error("[ai-voice-bot]", e);
    return null;
  }
}

// Auto-mount on load (skipped under test, which imports `mount` directly).
declare global { interface Window { AiVoiceBotConfig?: unknown; } }
if (typeof window !== "undefined" && window.AiVoiceBotConfig) mount(window.AiVoiceBotConfig);
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run` (full widget suite) → all pass. `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Build check**

Run: `npm run build && gzip -c dist/ai-voice-bot.min.js | wc -c` → confirm the number printed is well under 45,000 (45 KB gz budget).

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/index.ts widget/tests/index.test.ts
git commit -m "feat(widget): wire tap-to-talk mic + mute toggle + voice-initiated speak decision"
```

---

### Task 10: Demo, README, deploy notes, manual smoke

**Files:**
- Modify: `widget/demo-embed.html`, `widget/README.md`

**Steps:**

- [ ] **Step 1: Update `widget/demo-embed.html`'s config to show the voice keys**

Replace the `window.AiVoiceBotConfig` block with:
```html
<script>
  window.AiVoiceBotConfig = {
    workerUrl: "http://localhost:8787",
    branding: { botName: "Leo", themeColor: "#6C5CE7", greeting: "Hi, I'm Leo — how can I help?" },
    behavior: { language: "en-US" },
    privacy: { consentText: "I agree to share my info so Mohan can follow up.", privacyPolicyUrl: "https://devmohan.in/privacy" },
    voice: { enabled: true, ttsVoice: "Fritz-PlayAI", speakByDefault: false },
    advanced: { analyticsCallback: (e, p) => console.log("[analytics]", e, p || "") },
  };
</script>
```

- [ ] **Step 2: Update `widget/README.md`**

Add a new section after "## Local smoke" (before "## Embed on a site"):
```md
## Voice (v0.2c)

- **Tap-to-talk mic**: appears next to Send; disabled with a hint in browsers without `SpeechRecognition` (Safari/Firefox) — text still works.
- **Leo speaks back**: neural voice via the Worker's `/tts` (Groq `playai-tts`), falling back to the browser's `speechSynthesis`, falling back to silent (the transcript is always there).
- Leo speaks automatically when you used the mic; the 🔊/🔇 toggle in the header forces sound on/off for typed messages too.
- **One-time setup**: the Groq `playai-tts` model requires accepting its terms once in the [Groq console](https://console.groq.com) under that model. Until accepted (or without a `GROQ_API_KEY`), `/tts` returns an error and the widget automatically falls back to browser TTS — voice still works.
- Set `MAX_TTS_CHARS`/`TTS_VOICE` in `worker/wrangler.toml` `[vars]` to tune the text cap / default voice.
```

- [ ] **Step 3: Manual smoke test (human runs this)**

Run the Worker (`cd worker && npm run dev`, with `MODE=dev` and a real `GROQ_API_KEY` in `.dev.vars`), rebuild the widget (`cd widget && npm run build`), open `widget/demo-embed.html`, and verify:
1. Chrome desktop: tap the mic, speak a question — it transcribes into the input and sends; the orb pulses "listening" while the mic is open.
2. Leo's reply is spoken in the Groq neural voice after a voice-initiated message; the orb animates "speaking" during playback; the transcript is still shown (caption).
3. Toggle 🔊/🔇 in the header — typed messages now speak (sound on) or stay silent (sound off); the preference survives a page reload.
4. Safari or Firefox (or Chrome with mic permission denied): the mic button is disabled with a hint tooltip; typing still works; TTS still plays (neural or browser fallback).
5. Turn on `prefers-reduced-motion` (OS setting or DevTools rendering emulation) — the orb's listening/speaking pulses stop animating.
6. Temporarily unset `GROQ_API_KEY` (or don't accept the `playai-tts` terms) — `/tts` fails and the widget falls back to browser `speechSynthesis` without any console errors bubbling into the host page.

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/demo-embed.html widget/README.md
git commit -m "docs(widget): voice section in README + demo config; Groq playai-tts setup note"
```

---

## Self-Review

**Spec coverage (v0.2c):**
- C1 tap-to-talk mic, text always available — Tasks 5, 8, 9. ✅
- C2 speak-when-spoken-to + mute/unmute toggle, state persisted — Tasks 4, 6, 9. ✅
- C3 browser `SpeechRecognition` only, graceful disable+hint when unsupported — Tasks 5, 9. ✅ (Cloud STT explicitly deferred, per spec.)
- C4 Groq neural TTS → browser TTS → silent — Task 6. ✅
- C5 `POST /tts` behind the same origin/dev-prod guards as `/chat`; `/health` reports the TTS provider — Tasks 1, 2. ✅
- C6 orb `listening`/`speaking` states, mutually exclusive with idle/thinking — Task 7. ✅
- C7 mic/audio triggered only by a tap (never autoplay) — Task 9 (`refs.mic` click handler starts recognition; `speak()` only ever called from the `onDone` callback of a send that itself started from a tap or submit). ✅
- C8 `behavior.language`, `voice.ttsVoice`, `voice.enabled` config, forward-compatible defaults — Task 3. ✅
- C9 keyboard-operable mic/mute with ARIA, `prefers-reduced-motion`, transcript remains source of truth — Tasks 7, 8, 9 (mic/sound are real `<button>`s; captions already come from the existing streamed transcript, untouched). ✅
- Testing table: backend `/tts` Vitest — Tasks 1–2; widget TTS chain — Task 6; widget STT — Task 5; orb states — Task 7; manual/browser smoke — Task 10. ✅
- Out of scope (correctly not built): cloud STT/Whisper `/stt`, sentence-chunked TTS, other neural TTS providers, npm/CDN publish + deploy (v0.3).

**Placeholder scan:** No TBD/TODO/"add appropriate handling" phrasing. Every step shows complete code, including the instance-capture pattern Tasks 5 and 9 both rely on (`fakeCtor()`/`FakeRecognition.last`) to reach a constructed `SpeechRecognition` stand-in from the test.

**Type consistency:** `Refs` (dom.ts: `mic`, `sound` added in Task 8) matches its use in orb.ts (unchanged shape, Task 7) and index.ts (Task 9). `SpeakerConfig`/`SynthLike`/`AudioLike`/`Speaker` (tts.ts, Task 6) match `MountDeps` and the `createSpeaker` call in index.ts (Task 9) exactly. `RecognitionHandlers` (stt.ts, Task 5) matches the handlers object passed from index.ts (Task 9). `WidgetConfig.voice`/`behavior.language` (types.ts/config.ts, Task 3) match every read site (`cfg.voice.enabled`, `cfg.voice.ttsVoice`, `cfg.voice.speakByDefault`, `cfg.behavior.language`) in Tasks 6 and 9. Backend `Deps.fetchImpl` (Task 2) is **optional** specifically so the existing `worker/tests/chat.test.ts` calls (`createApp({ buildModel, getSession, makeRunner })`, no `fetchImpl`) keep type-checking unchanged; Task 2 Step 6 explicitly re-runs the full worker suite to confirm nothing broke.

---

*End of v0.2c plan. Next: v0.3 (npm/CDN publish + deploy to voicebot.devmohan.in + embed on devmohan.in).*
