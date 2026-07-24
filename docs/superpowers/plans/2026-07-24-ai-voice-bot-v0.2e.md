# AI Voice Bot v0.2e — Continuous Conversation Mode + Live Audio Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn tap-to-talk (one utterance per tap) into a hands-free conversation loop (tap once, keep talking back and forth until tapped off), and give the mic a real mic-volume-reactive "Siri-like" animation (glowing halo + bars on the mic button, a live waveform replacing the text input) while listening.

**Architecture:** One new standalone, dependency-injected audio-capture module (`voice/visualizer.ts`, mirrors the existing `voice/stt.ts`/`voice/tts.ts` pattern) that emits a single amplitude `level` per animation frame — it has no DOM knowledge. A new small pure-function-plus-DOM-writer module (`voice/level-render.ts`) maps that level onto specific elements. `dom.ts`/`styles.ts` gain the new mic/waveform/send markup and CSS. `index.ts` gains a `conversationMode`/`awaitingReply`/`awaitingSpeechEnd` state machine that ties the mic toggle, the recognizer's callbacks, and the speaker's existing single `onState` callback together.

**Tech Stack:** TypeScript, Vitest (+happy-dom), esbuild. No new runtime dependencies (`getUserMedia`/`AudioContext`/`requestAnimationFrame` are platform APIs).

## Global Constraints

- **No backend changes.** This slice touches only `widget/src/*.ts`, `widget/tests/*`, `widget/README.md`, `widget/demo-embed.html`.
- **Never throw into the host.** `visualizer.start()` never rejects/throws — any failure (denied permission, unsupported browser, mic busy) is caught internally and the widget falls back to no animation, with speech capture (`SpeechRecognition`) completely unaffected.
- **One `onState` callback slot.** `Speaker.onState(cb)` only holds a single callback (`stateCb = cb`) — this slice extends the existing subscription in `index.ts`, it does not add a second one.
- **`speaker.speak()`'s promise resolves at playback *start*, not *end*.** The "reply finished speaking" signal is the `onState("idle")` transition (fired from `audio.onended`), never `await speaker.speak(...)`.
- **No public API removals.** `MountDeps` gains four new optional fields; `Refs` gains three new fields (`micHalo`, `micBars`, `waveform`). No existing field is renamed or removed.
- **Deliberate breaking behavior change (call this out, don't silently "fix" it back):** a second mic tap while listening used to be a no-op (v0.2c); it now stops conversation mode. The existing test asserting the old no-op behavior must be replaced, not preserved.
- Discipline: TDD, `npx tsc --noEmit` clean before each commit (run in `widget/`), frequent commits.

---

### Task 1: `voice/visualizer.ts` — injectable mic-level analysis

**Files:**
- Create: `widget/src/voice/visualizer.ts`
- Test: `widget/tests/voice/visualizer.test.ts`

**Interfaces:**
- Produces: `VisualizerDeps = { getUserMedia?, AudioContextCtor?, requestFrame?, cancelFrame? }`; `AnalyserLike`, `AudioContextLike`; `Visualizer = { start(): Promise<void>; stop(): void }`; `createVisualizer(onLevel: (level: number) => void, deps?: VisualizerDeps): Visualizer`.

- [ ] **Step 1: Write the failing test**

`widget/tests/voice/visualizer.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createVisualizer } from "../../src/voice/visualizer";

function fakeAnalyser(byteValue: number) {
  return {
    fftSize: 64,
    frequencyBinCount: 32,
    getByteFrequencyData(arr: Uint8Array) { arr.fill(byteValue); },
  };
}
function fakeCtx(byteValue: number) {
  const analyser = fakeAnalyser(byteValue);
  return {
    createMediaStreamSource: () => ({ connect: () => {} }),
    createAnalyser: () => analyser,
    close: () => {},
  };
}

describe("createVisualizer", () => {
  it("invokes onLevel with a normalized level derived from analyser data, once per frame", async () => {
    const levels: number[] = [];
    let frameCb: ((t: number) => void) | null = null;
    const requestFrame = (cb: (t: number) => void) => { frameCb = cb; return 1; };
    const cancelFrame = vi.fn();
    const getUserMedia = async () => ({ getTracks: () => [] }) as unknown as MediaStream;
    const AudioContextCtor = vi.fn(() => fakeCtx(255)) as unknown as new () => any;

    const v = createVisualizer((l) => levels.push(l), { getUserMedia, AudioContextCtor, requestFrame, cancelFrame });
    await v.start();
    expect(levels).toEqual([1]); // byte value 255 -> normalized level 1
    frameCb!(0); // simulate the next animation frame firing
    expect(levels).toEqual([1, 1]);
    v.stop();
    expect(cancelFrame).toHaveBeenCalled();
  });

  it("never rejects/throws when getUserMedia rejects — fails silently", async () => {
    const getUserMedia = async () => { throw new Error("denied"); };
    const v = createVisualizer(() => {}, { getUserMedia });
    await expect(v.start()).resolves.toBeUndefined();
  });

  it("stop() is a safe no-op when called before start() ever ran", () => {
    const v = createVisualizer(() => {});
    expect(() => v.stop()).not.toThrow();
  });

  it("stop() releases every track on the acquired media stream", async () => {
    const stopCalls: boolean[] = [];
    const getUserMedia = async () => ({ getTracks: () => [{ stop: () => stopCalls.push(true) }, { stop: () => stopCalls.push(true) }] }) as unknown as MediaStream;
    const AudioContextCtor = vi.fn(() => fakeCtx(0)) as unknown as new () => any;
    const v = createVisualizer(() => {}, { getUserMedia, AudioContextCtor, requestFrame: () => 1, cancelFrame: () => {} });
    await v.start();
    v.stop();
    expect(stopCalls).toEqual([true, true]);
  });

  it("start() is idempotent — a second call while already running does not re-acquire the mic", async () => {
    let calls = 0;
    const getUserMedia = async () => { calls++; return { getTracks: () => [] } as unknown as MediaStream; };
    const AudioContextCtor = vi.fn(() => fakeCtx(0)) as unknown as new () => any;
    const v = createVisualizer(() => {}, { getUserMedia, AudioContextCtor, requestFrame: () => 1, cancelFrame: () => {} });
    await v.start();
    await v.start();
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/voice/visualizer.test.ts` → FAIL (module `../../src/voice/visualizer` not found).

- [ ] **Step 3: Write `widget/src/voice/visualizer.ts`**

```ts
export interface AnalyserLike {
  fftSize: number;
  frequencyBinCount: number;
  getByteFrequencyData(arr: Uint8Array): void;
}
export interface AudioContextLike {
  createMediaStreamSource(stream: MediaStream): { connect(node: AnalyserLike): void };
  createAnalyser(): AnalyserLike;
  close(): Promise<void> | void;
}
export interface VisualizerDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  AudioContextCtor?: new () => AudioContextLike;
  requestFrame?: (cb: (t: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}
export interface Visualizer {
  start(): Promise<void>;
  stop(): void;
}

export function createVisualizer(onLevel: (level: number) => void, deps: VisualizerDeps = {}): Visualizer {
  let stream: MediaStream | null = null;
  let ctx: AudioContextLike | null = null;
  let frameHandle: number | null = null;
  let running = false;

  const requestFrame = deps.requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const cancelFrame = deps.cancelFrame ?? ((h) => cancelAnimationFrame(h));

  return {
    async start(): Promise<void> {
      if (running) return;
      running = true;
      try {
        const getUserMedia = deps.getUserMedia ?? ((c) => navigator.mediaDevices.getUserMedia(c));
        stream = await getUserMedia({ audio: true });
        const AudioContextCtor = deps.AudioContextCtor
          ?? (window as unknown as { AudioContext: new () => AudioContextLike }).AudioContext;
        ctx = new AudioContextCtor();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          onLevel(data.length ? sum / data.length / 255 : 0);
          frameHandle = requestFrame(tick);
        };
        tick();
      } catch {
        running = false; // fail silently (never throw into host); a later start() may retry
      }
    },
    stop(): void {
      running = false;
      if (frameHandle !== null) { cancelFrame(frameHandle); frameHandle = null; }
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (ctx) { try { ctx.close(); } catch { /* ignore */ } ctx = null; }
    },
  };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run tests/voice/visualizer.test.ts` → PASS (5 passed). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/voice/visualizer.ts widget/tests/voice/visualizer.test.ts
git commit -m "feat(widget): voice/visualizer.ts — injectable mic-level analysis via getUserMedia+AnalyserNode"
```

---

### Task 2: DOM shell — mic visual elements, input waveform, icon-only Send

**Files:**
- Modify: `widget/src/dom.ts`, `widget/src/styles.ts`
- Test: `widget/tests/dom.test.ts`

**Interfaces:**
- Produces: `Refs` gains `micHalo: HTMLElement; micBars: HTMLElement; waveform: HTMLElement;`.

- [ ] **Step 1: Write the failing test additions**

Append to `widget/tests/dom.test.ts` (inside `describe("mountShell", ...)`):
```ts
  it("mounts mic visual elements (halo + 3 bars) and a 24-bar input waveform, inside the shadow root", () => {
    const refs = mountShell(cfg);
    expect(refs.micHalo).toBeTruthy();
    expect(refs.micBars).toBeTruthy();
    expect(refs.waveform).toBeTruthy();
    expect(refs.shadow.contains(refs.micHalo)).toBe(true);
    expect(refs.shadow.contains(refs.waveform)).toBe(true);
    expect(refs.micBars.querySelectorAll("span").length).toBe(3);
    expect(refs.waveform.querySelectorAll("span").length).toBe(24);
  });

  it("renders the Send button as an icon only, no text label", () => {
    const refs = mountShell(cfg);
    const send = refs.form.querySelector("button[type=submit]")!;
    expect(send.querySelector("svg")).toBeTruthy();
    expect(send.textContent?.trim()).toBe("");
  });
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/dom.test.ts` → FAIL (`refs.micHalo` is `undefined`; Send button still has the text "Send").

- [ ] **Step 3: Update `Refs` and the form markup in `widget/src/dom.ts`**

Change the `Refs` interface:
```ts
export interface Refs {
  host: HTMLElement; shadow: ShadowRoot;
  orb: HTMLButtonElement; panel: HTMLElement; header: HTMLElement; avatar: HTMLElement;
  list: HTMLElement; form: HTMLFormElement; input: HTMLInputElement;
  mic: HTMLButtonElement; micHalo: HTMLElement; micBars: HTMLElement; waveform: HTMLElement;
  sound: HTMLButtonElement;
}
```

Add a waveform-bar generator near the top of `mountShell` (before `panel.innerHTML = ...`):
```ts
  const waveformBars = Array.from({ length: 24 }, () => "<span></span>").join("");
```

Replace the `<form>...</form>` block inside `panel.innerHTML`:
```ts
    <form>
      <button type="button" class="mic" aria-label="Speak your message">
        <span class="mic-icon">🎤</span>
        <span class="mic-halo"></span>
        <span class="mic-bars"><span></span><span></span><span></span></span>
      </button>
      <div class="input-wrap">
        <input type="text" placeholder="Type a message…" autocomplete="off" aria-label="Message" />
        <div class="waveform" aria-hidden="true">${waveformBars}</div>
      </div>
      <button type="submit" class="send" aria-label="Send message">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 11.5L20 4L12.5 21L10.5 13.5L3 11.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/></svg>
      </button>
    </form>
```

Add the three new refs to the returned object:
```ts
  return {
    host, shadow, orb, panel,
    header: panel.querySelector(".hd")!,
    avatar: panel.querySelector(".avatar")!,
    list: panel.querySelector(".list")!,
    form: panel.querySelector("form")!,
    input: panel.querySelector("input")!,
    mic: panel.querySelector(".mic")!,
    micHalo: panel.querySelector(".mic-halo")!,
    micBars: panel.querySelector(".mic-bars")!,
    waveform: panel.querySelector(".waveform")!,
    sound: panel.querySelector(".sound")!,
  };
```

- [ ] **Step 4: Update `widget/src/styles.ts`**

Replace this block (from `form .mic { ... }` through `.list { ... }`):
```ts
  form .mic { background: transparent; border: 1px solid #332d42; color: #eae7f2; border-radius: 10px; padding: 8px 10px; cursor: pointer; font-size: 16px; }
  form .mic:disabled { opacity: .4; cursor: not-allowed; }
  form .mic.listening { border-color: ${theme}; }
  .list { flex: 1; overflow-y: auto; scroll-behavior: smooth; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
```
with (the `.list` rule at the end is unchanged — carried along verbatim since it's adjacent to the edited lines):
```ts
  form .mic { position: relative; display: grid; place-items: center; background: transparent; border: 1px solid #332d42; color: #eae7f2; border-radius: 10px; padding: 8px 10px; cursor: pointer; font-size: 16px; }
  form .mic:disabled { opacity: .4; cursor: not-allowed; }
  form .mic.listening { border-color: ${theme}; }
  .mic-halo { display: none; position: absolute; inset: -8px; border-radius: 50%; background: radial-gradient(circle, ${theme}88 0%, ${theme}00 70%); pointer-events: none; }
  .mic-bars { display: none; align-items: center; gap: 2.5px; height: 14px; }
  .mic-bars span { width: 2.5px; border-radius: 2px; background: linear-gradient(180deg, ${theme2}, ${theme}); }
  .mic.listening .mic-icon { display: none; }
  .mic.listening .mic-halo { display: block; }
  .mic.listening .mic-bars { display: flex; }
  .input-wrap { position: relative; flex: 1; }
  .waveform { display: none; align-items: center; gap: 2px; height: 38px; padding: 0 4px; overflow: hidden; }
  .waveform span { width: 2px; border-radius: 1px; background: ${theme}; flex-shrink: 0; }
  form.listening .input-wrap input { display: none; }
  form.listening .input-wrap .waveform { display: flex; }
  .send { background: linear-gradient(120deg, ${theme}, ${theme2}); border: none; border-radius: 10px; width: 42px; height: 38px; flex-shrink: 0; display: grid; place-items: center; cursor: pointer; }
  .send svg { width: 18px; height: 18px; color: #fff; }
  .list { flex: 1; overflow-y: auto; scroll-behavior: smooth; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
```

Then, further down, change the `input { ... }` rule (drop `flex: 1`, since `.input-wrap` now carries that; add `width: 100%` so the input still fills its wrapper) — currently:
```ts
  input { flex: 1; padding: 10px 12px; border: 1px solid #332d42; background: #241f30; color: #eae7f2; border-radius: 10px; font-size: 14px; }
```
becomes:
```ts
  input { width: 100%; padding: 10px 12px; border: 1px solid #332d42; background: #241f30; color: #eae7f2; border-radius: 10px; font-size: 14px; }
```

Finally, remove the now-unused generic `form button { ... }` rule (superseded by the `.send` rule added above — the `.mic` button already has its own specific rule and never relied on this one):
```ts
  form button { background: linear-gradient(120deg, ${theme}, ${theme2}); color: #fff; border: none; border-radius: 10px; padding: 10px 14px; cursor: pointer; }
```
Delete this line entirely.

- [ ] **Step 5: Run test — expect PASS**

Run: `npx vitest run tests/dom.test.ts` → PASS. Then `npx vitest run` (full widget suite — `panel.test.ts`/`orb.test.ts`/`index.test.ts` all call `mountShell` too) → all PASS (no other test reads `.mic`'s old plain-emoji `textContent` or the Send button's old text). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/dom.ts widget/src/styles.ts widget/tests/dom.test.ts
git commit -m "feat(widget): mic halo/bars + input waveform markup, icon-only Send button"
```

---

### Task 3: `voice/level-render.ts` — level → visual mapping

**Files:**
- Create: `widget/src/voice/level-render.ts`
- Test: `widget/tests/voice/level-render.test.ts`

**Interfaces:**
- Consumes: `Refs.micHalo`/`micBars`/`waveform` (Task 2) — via a narrower `LevelRefs` type (structural subset).
- Produces: `barHeight(level: number, index: number, now: number, min?: number, max?: number): number` (pure); `applyLevel(refs: LevelRefs, level: number, now?: number): void`.

- [ ] **Step 1: Write the failing test**

`widget/tests/voice/level-render.test.ts`:
```ts
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { barHeight, applyLevel } from "../../src/voice/level-render";

describe("barHeight", () => {
  it("stays within [min, max] across levels, indices, and time", () => {
    for (let level = 0; level <= 1; level += 0.25) {
      for (let i = 0; i < 5; i++) {
        const h = barHeight(level, i, 12345, 4, 20);
        expect(h).toBeGreaterThanOrEqual(4);
        expect(h).toBeLessThanOrEqual(20);
      }
    }
  });

  it("is taller for a higher level at a fixed index/time (phase term cancels at index 0, time 0)", () => {
    const low = barHeight(0, 0, 0, 4, 20);
    const high = barHeight(1, 0, 0, 4, 20);
    expect(high).toBeGreaterThan(low);
    expect(low).toBe(4);
    expect(high).toBe(20);
  });
});

describe("applyLevel", () => {
  function makeRefs() {
    const micHalo = document.createElement("span");
    const micBars = document.createElement("span");
    micBars.innerHTML = "<span></span><span></span><span></span>";
    const waveform = document.createElement("div");
    waveform.innerHTML = "<span></span><span></span>";
    return { micHalo, micBars, waveform };
  }

  it("sets the halo's opacity and scale from the level", () => {
    const refs = makeRefs();
    applyLevel(refs, 1, 0);
    expect(refs.micHalo.style.opacity).toBe("1");
    expect(refs.micHalo.style.transform).toBe("scale(1.5)");
  });

  it("sets a pixel height on every mic-bar and waveform span", () => {
    const refs = makeRefs();
    applyLevel(refs, 0.5, 100);
    refs.micBars.querySelectorAll("span").forEach((el) => {
      expect((el as HTMLElement).style.height).toMatch(/px$/);
    });
    refs.waveform.querySelectorAll("span").forEach((el) => {
      expect((el as HTMLElement).style.height).toMatch(/px$/);
    });
  });

  it("clamps out-of-range levels to [0, 1]", () => {
    const refs = makeRefs();
    applyLevel(refs, 5, 0);
    expect(refs.micHalo.style.opacity).toBe("1"); // same as level=1, not >1
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/voice/level-render.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write `widget/src/voice/level-render.ts`**

```ts
export interface LevelRefs {
  micHalo: HTMLElement;
  micBars: HTMLElement;
  waveform: HTMLElement;
}

export function barHeight(level: number, index: number, now: number, min = 4, max = 20): number {
  const phase = Math.sin(index * 0.6 + now / 200);
  const v = Math.max(0, Math.min(1, level + phase * 0.15));
  return min + v * (max - min);
}

export function applyLevel(refs: LevelRefs, level: number, now: number = performance.now()): void {
  const clamped = Math.max(0, Math.min(1, level));

  refs.micHalo.style.opacity = String(0.4 + clamped * 0.6);
  refs.micHalo.style.transform = `scale(${0.8 + clamped * 0.7})`;

  refs.micBars.querySelectorAll("span").forEach((el, i) => {
    (el as HTMLElement).style.height = `${barHeight(clamped, i, now, 4, 14)}px`;
  });

  refs.waveform.querySelectorAll("span").forEach((el, i) => {
    (el as HTMLElement).style.height = `${barHeight(clamped, i, now, 4, 30)}px`;
  });
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run tests/voice/level-render.test.ts` → PASS (5 passed). `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/voice/level-render.ts widget/tests/voice/level-render.test.ts
git commit -m "feat(widget): voice/level-render.ts — pure level->bar-height mapping + DOM application"
```

---

### Task 4: `index.ts` — conversation-mode state machine + visualizer wiring

**Files:**
- Modify: `widget/src/index.ts`
- Test: `widget/tests/index.test.ts`

**Interfaces:**
- Consumes: `createVisualizer` (Task 1), `applyLevel` (Task 3), `refs.micHalo`/`micBars`/`waveform` (Task 2).
- Produces: `MountDeps` gains `getUserMedia?`, `AudioContextCtor?`, `requestFrame?`, `cancelFrame?` (all optional, passed straight through to `createVisualizer`). Mic tap becomes a **toggle** for `conversationMode` (breaking change from v0.2c's guard-only behavior — see Global Constraints). After a reply is generated and (if applicable) fully spoken, listening restarts automatically iff still in conversation mode.

> **This task replaces one existing test.** `index.test.ts`'s v0.2c test *"tap-to-talk: a second mic tap while still listening does not call start() again"* asserted the *old* no-op-on-double-tap behavior. Under the new toggle semantics, a second tap while listening now **stops** conversation mode (calling `recognizer.stop()`), which is the deliberate, spec-mandated behavior change (E1). Step 1 replaces that test with one asserting the new behavior — this is not a regression to be preserved.

- [ ] **Step 1: Write the failing test changes**

In `widget/tests/index.test.ts`, **replace** the existing test named `"tap-to-talk: a second mic tap while still listening does not call start() again"` with:
```ts
  it("tap-to-talk: a second mic tap while listening turns conversation mode off (stops the recognizer)", () => {
    class FakeRecognition {
      static last: FakeRecognition | null = null;
      lang = ""; continuous = true; interimResults = true;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      startCalls = 0; stopCalls = 0;
      constructor() { FakeRecognition.last = this; }
      start() { this.startCalls++; }
      stop() { this.stopCalls++; }
    }
    (window as any).SpeechRecognition = FakeRecognition;
    try {
      const app = mount(baseCfg, { store: memoryStore(), fetchImpl: fetch })!;
      app.refs.mic.click(); // first tap — conversation mode on, starts listening
      expect(FakeRecognition.last!.startCalls).toBe(1);
      expect(app.refs.orb.classList.contains("listening")).toBe(true);
      app.refs.mic.click(); // second tap — turns conversation mode off
      expect(FakeRecognition.last!.stopCalls).toBe(1);
      expect(FakeRecognition.last!.startCalls).toBe(1); // still just the one start
    } finally {
      delete (window as any).SpeechRecognition;
    }
  });
```

Then **append** these new tests to the same `describe("mount", ...)` block:
```ts
  it("conversation mode: after Leo's reply is generated and spoken, listening restarts automatically (no new tap)", async () => {
    class FakeRecognition {
      static last: FakeRecognition | null = null;
      lang = ""; continuous = true; interimResults = true;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      startCalls = 0;
      constructor() { FakeRecognition.last = this; }
      start() { this.startCalls++; }
      stop() {}
    }
    (window as any).SpeechRecognition = FakeRecognition;
    try {
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/tts")) return new Response("audio", { status: 200 });
        return streamRes([sse("done", { reply: "Hey there", lead_saved: false })]);
      }) as unknown as typeof fetch;
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const app = mount(baseCfg, { store: memoryStore(), fetchImpl, makeAudio: () => audio })!;
      app.refs.orb.click();
      app.refs.mic.click(); // conversation mode on — tap 1
      const rec = FakeRecognition.last!;
      expect(rec.startCalls).toBe(1);
      rec.onresult!({ results: [[{ transcript: "what do you do" }]] });
      (app.refs.list.querySelector(".consent button") as HTMLButtonElement).click(); // first message still gates on consent
      await new Promise((r) => setTimeout(r, 0));
      expect(audio.played).toBe(true); // Leo is "speaking" the reply
      expect(rec.startCalls).toBe(1); // not yet restarted — still waiting for speech to finish
      audio.onended!(); // playback finishes -> speaker's onState fires "idle"
      expect(rec.startCalls).toBe(2); // listening restarted automatically, no new tap
    } finally {
      delete (window as any).SpeechRecognition;
    }
  });

  it("conversation mode: tapping the mic off before the reply finishes speaking prevents the auto-restart", async () => {
    class FakeRecognition {
      static last: FakeRecognition | null = null;
      lang = ""; continuous = true; interimResults = true;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      startCalls = 0; stopCalls = 0;
      constructor() { FakeRecognition.last = this; }
      start() { this.startCalls++; }
      stop() { this.stopCalls++; }
    }
    (window as any).SpeechRecognition = FakeRecognition;
    try {
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/tts")) return new Response("audio", { status: 200 });
        return streamRes([sse("done", { reply: "Hey there", lead_saved: false })]);
      }) as unknown as typeof fetch;
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const app = mount(baseCfg, { store: memoryStore(), fetchImpl, makeAudio: () => audio })!;
      app.refs.orb.click();
      app.refs.mic.click(); // conversation mode on
      const rec = FakeRecognition.last!;
      rec.onresult!({ results: [[{ transcript: "what do you do" }]] });
      (app.refs.list.querySelector(".consent button") as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
      app.refs.mic.click(); // taps off while Leo is still "speaking"
      audio.onended!(); // playback finishes after the tap-off
      expect(rec.startCalls).toBe(1); // no auto-restart — conversation mode was already off
    } finally {
      delete (window as any).SpeechRecognition;
    }
  });

  it("conversation mode: an empty/no-speech result keeps listening without going through send()", () => {
    class FakeRecognition {
      static last: FakeRecognition | null = null;
      lang = ""; continuous = true; interimResults = true;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      startCalls = 0;
      constructor() { FakeRecognition.last = this; }
      start() { this.startCalls++; }
      stop() {}
    }
    (window as any).SpeechRecognition = FakeRecognition;
    try {
      const app = mount(baseCfg, { store: memoryStore(), fetchImpl: fetch })!;
      app.refs.mic.click();
      const rec = FakeRecognition.last!;
      expect(rec.startCalls).toBe(1);
      rec.onresult!({ results: [[{ transcript: "   " }]] }); // whitespace-only -> treated as empty
      expect(rec.startCalls).toBe(2); // restarted immediately, no send() involved
      expect(app.refs.list.children.length).toBe(0); // nothing was sent/rendered
    } finally {
      delete (window as any).SpeechRecognition;
    }
  });
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd widget && npx vitest run tests/index.test.ts` → FAIL (mic tap doesn't toggle a persistent `conversationMode`; no auto-restart wiring exists yet).

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
import { createVisualizer, type VisualizerDeps } from "./voice/visualizer";
import { applyLevel } from "./voice/level-render";

export interface MountDeps {
  store?: Store;
  fetchImpl?: typeof fetch;
  synth?: SynthLike | null;
  makeAudio?: (res: Response) => AudioLike | Promise<AudioLike>;
  getUserMedia?: VisualizerDeps["getUserMedia"];
  AudioContextCtor?: VisualizerDeps["AudioContextCtor"];
  requestFrame?: VisualizerDeps["requestFrame"];
  cancelFrame?: VisualizerDeps["cancelFrame"];
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
    let listening = false;
    let conversationMode = false;
    let awaitingReply = false;
    let awaitingSpeechEnd = false;
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

    const visualizer = createVisualizer(
      (level) => applyLevel(refs, level),
      { getUserMedia: deps.getUserMedia, AudioContextCtor: deps.AudioContextCtor, requestFrame: deps.requestFrame, cancelFrame: deps.cancelFrame },
    );

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
    speaker?.onState((s) => {
      orb.setSpeaking(s === "speaking");
      if (s === "idle" && awaitingSpeechEnd) {
        awaitingSpeechEnd = false;
        if (conversationMode) startListening();
      }
    });

    const renderSound = () => {
      refs.sound.textContent = soundOn ? "🔊" : "🔇";
      refs.sound.setAttribute("aria-pressed", String(!soundOn));
      refs.sound.setAttribute(
        "aria-label",
        soundOn ? `Mute ${cfg.branding.botName}'s voice` : `Unmute ${cfg.branding.botName}'s voice`,
      );
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
      awaitingSpeechEnd = false; // cancel any pending restart tied to a previous, now-stale turn
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
            awaitingReply = false;
            if (shouldSpeak(voiceInitiated, soundOn) && speaker) {
              awaitingSpeechEnd = true;
              speaker.speak(reply); // fire-and-forget; onState("idle") above triggers the restart
            } else if (conversationMode) {
              startListening();
            }
          },
          onError: () => {
            line.remove(); panel.showError(); orb.setThinking(false); emit(analytics, "error");
            awaitingReply = false;
            if (conversationMode) startListening();
          },
          onBlocked: () => {
            line.remove(); orb.setThinking(false); emit(analytics, "blocked");
            awaitingReply = false;
            if (conversationMode) startListening();
          },
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

    const setListeningVisual = (on: boolean) => {
      orb.setListening(on);
      refs.form.classList.toggle("listening", on);
      refs.mic.classList.toggle("listening", on);
    };

    let recognizer: { start(): void; stop(): void } | null = null;

    const startListening = () => {
      if (listening || !recognizer) return;
      listening = true;
      setListeningVisual(true);
      visualizer.start();
      try {
        recognizer.start();
      } catch {
        listening = false;
        setListeningVisual(false);
        visualizer.stop();
      }
    };

    const stopListeningVisual = () => {
      listening = false;
      setListeningVisual(false);
      visualizer.stop();
    };

    const canUseMic = cfg.voice.enabled && sttSupported();
    if (canUseMic) {
      try {
        recognizer = createRecognizer(cfg.behavior.language, {
          onResult: (text) => {
            stopListeningVisual();
            const t = text.trim();
            if (!t) { if (conversationMode) startListening(); return; }
            awaitingReply = true;
            refs.input.value = t;
            pendingVoice = true;
            refs.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
          },
          onEnd: () => {
            stopListeningVisual();
            if (conversationMode && !awaitingReply) startListening();
          },
          onError: () => {
            stopListeningVisual();
            if (conversationMode && !awaitingReply) startListening();
          },
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
        if (conversationMode) {
          conversationMode = false;
          if (listening) { try { recognizer!.stop(); } catch { /* onEnd still fires and cleans up */ } }
          return;
        }
        conversationMode = true;
        startListening();
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

Run: `npx vitest run tests/index.test.ts` → PASS. Then `npx vitest run` (full widget suite) → all PASS. `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Bundle size check**

Run: `cd widget && npm run build && gzip -c dist/ai-voice-bot.min.js | wc -c` → confirm the number printed stays reasonably close to the post-v0.2d baseline (~6.3 KB) — no hard budget regression expected from this slice (no new runtime dependencies), but note the actual figure in the commit/report.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/src/index.ts widget/tests/index.test.ts
git commit -m "feat(widget): continuous conversation mode + mic visualizer wiring"
```

---

### Task 5: Docs + demo + manual smoke

**Files:**
- Modify: `widget/README.md`

**Steps:**

- [ ] **Step 1: Add a "Conversation mode" note to `widget/README.md`**

In the existing prose near the voice/consent section (after the **Voice**: paragraph in `## Configuration reference`), add:
```md
**Conversation mode**: tap the mic once to start a hands-free back-and-forth — after each reply is
generated and (if speaking) fully spoken, the mic listens again automatically. Tap the mic again,
any time, to stop. While listening, the mic button shows a live, mic-volume-reactive animation and
the text input becomes a waveform line; both fall back gracefully (no animation, capture still
works) if the browser can't provide raw mic-level access.
```

- [ ] **Step 2: Manual smoke test (human runs this)**

Rebuild (`cd widget && npm run build`), serve `demo-embed.html` over `http://localhost` (not `file://`,
per the v0.2d testing note already in this README), run the Worker locally with `MODE=dev`, and verify:
1. Tap the mic once, have a multi-turn conversation without tapping again — each reply is generated, spoken, and the mic starts listening again on its own.
2. While actively listening, the mic button shows the glowing halo + bars, and the text input becomes a waveform — both visibly react to how loudly you're speaking.
3. Tap the mic mid-conversation — conversation mode stops immediately (no further auto-restart after the current reply, if one is in flight).
4. Stay silent for a while during a conversation-mode turn — listening keeps going (or restarts) rather than requiring a fresh tap.
5. The Send button now shows a paper-plane icon instead of the word "Send" at all times, including when not listening.
6. If your browser denies or lacks support for the second `getUserMedia` path, confirm speech capture still works via the plain `.mic.listening` border style (no animation, no crash).

- [ ] **Step 3: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/README.md
git commit -m "docs(widget): conversation mode + live mic visualization notes"
```

---

## Self-Review

**Spec coverage (v0.2e):**
- E1 toggle gesture (tap on/off) — Task 4. ✅
- E2 auto-restart only after reply generated *and spoken*, via `onState("idle")` not `await speak()` — Task 4 (corrected design, verified against the actual `tts.ts` implementation before writing this plan). ✅
- E3 silence/no-speech keeps listening — Task 4 (`onEnd`/`onError`/empty-`onResult` all restart when `conversationMode && !awaitingReply`). ✅
- E4 mic-button halo+bars, real audio-reactive — Tasks 1–3. ✅
- E5 input waveform + permanent icon-only Send — Task 2. ✅
- E6 second mic-access path, same permission grant assumed — Task 1 (documented assumption, not code-enforceable) + manual smoke Task 5. ✅
- E7 silent degradation on visualizer failure — Task 1 (`start()` never rejects). ✅
- E8 out-of-scope items correctly not built (typing doesn't disable conversation mode; tap-off doesn't interrupt speech; no true per-band analysis). ✅
- Testing table (spec §6): visualizer — Task 1; state machine — Task 4; DOM structure — Task 2; level→visual mapping — Task 3; manual smoke — Task 5. ✅

**Placeholder scan:** No TBD/TODO/"add appropriate handling" phrasing. Every step shows complete code. Task 4 explicitly calls out and replaces the one pre-existing test whose asserted behavior this plan deliberately changes, rather than silently leaving it to fail or rewriting it without comment.

**Type consistency:** `VisualizerDeps`/`Visualizer` (Task 1) match `MountDeps`'s four new fields and the `createVisualizer(...)` call (Task 4) exactly. `LevelRefs` (Task 3) is a structural subset of `Refs` (Task 2's `micHalo`/`micBars`/`waveform`) — `applyLevel(refs, level)` in Task 4 passes the full `Refs` object, which satisfies `LevelRefs` structurally without any cast. `conversationMode`/`awaitingReply`/`awaitingSpeechEnd` are declared once in Task 4 and referenced consistently across the mic-click handler, the recognizer callbacks, `send()`'s three outcome callbacks, and the `speaker.onState` callback — no duplicate/conflicting state.

**Scope check:** Single cohesive slice (voice UX only); no backend/agent changes; appropriately sized for one implementation pass.

---

*End of v0.2e plan. Continues on `feat/v0.2d`. That branch still owes: a human manual smoke test of the whole redesign, and a production redeploy of the v0.2d TTS-model fix, before either slice merges.*
