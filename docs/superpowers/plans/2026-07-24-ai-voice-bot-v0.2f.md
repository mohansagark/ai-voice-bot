# AI Voice Bot v0.2f — Proactive First-Visit Greeting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a visitor's first-ever visit only, the widget auto-opens its own chat panel a short
while after page load and has Leo speak its greeting out loud, without any click.

**Architecture:** A new persisted "have we ever greeted this visitor" flag in `session.ts` gates a
`setTimeout` in `index.ts` that calls the existing `orb.open()` (reusing the current
`autoGreet`/greeting-text logic for free) and separately queues the spoken audio through a new small
module that either speaks immediately (if the visitor already interacted with the page) or waits for
their first click/keypress/touch (since browsers block unrequested audio autoplay).

**Tech Stack:** TypeScript, Vitest + happy-dom (existing widget test stack — no new dependencies).

## Global Constraints

- Auto-open + speak fires once per visitor, on their first-ever visit only (spec F1). Every later
  visit/reload is unaffected — existing manual-open + "Welcome back" flow stays exactly as is.
- Delay before auto-open: exactly **1800ms** after mount (spec F2).
- The greeting **text** renders through the existing `!greeted && cfg.behavior.autoGreet` path
  unchanged (spec F3) — do not duplicate or re-derive that branch.
- The proactive greeting **always speaks**, regardless of `voice.speakByDefault`/mute state (spec
  F4). This override applies to this one utterance only — every later reply keeps respecting mute.
- The mic/conversation mode is never auto-started (spec F5).
- New config field `behavior.proactiveGreet: boolean`, default `true`. Auto-open requires **both**
  `autoGreet && proactiveGreet` to be true (spec F6).
- The programmatic auto-open must NOT focus the text input; manual orb clicks still do (spec F7).
- No backend/agent changes. No change to the greeting text itself. Leo's tone/verbosity is
  explicitly out of scope for this plan (separate future spec).

---

### Task 1: `session.ts` — first-visit tracking flag

**Files:**
- Modify: `widget/src/session.ts`
- Test: `widget/tests/session.test.ts`

**Interfaces:**
- Consumes: nothing new (existing `Store` interface: `get`/`set`/`remove`).
- Produces: `createSession(store).hasVisitedBefore(): boolean` and
  `createSession(store).markVisited(): void`, both added to the object `createSession` already
  returns. `forget()` additionally clears this new key.

- [ ] **Step 1: Write the failing tests**

Append to `widget/tests/session.test.ts` (inside the existing `describe("session", ...)` block, after
the `"forget() also clears the sound preference"` test):

```ts
  it("tracks whether the visitor has ever been greeted before, defaulting to false", () => {
    const store = memoryStore();
    const s = createSession(store);
    expect(s.hasVisitedBefore()).toBe(false);
    s.markVisited();
    expect(s.hasVisitedBefore()).toBe(true);
    expect(createSession(store).hasVisitedBefore()).toBe(true); // persists across a fresh createSession() call
  });

  it("forget() also clears the visited flag", () => {
    const store = memoryStore();
    const s = createSession(store);
    s.markVisited();
    s.forget();
    expect(s.hasVisitedBefore()).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/session.test.ts`
Expected: FAIL — `s.hasVisitedBefore is not a function` (or `markVisited`).

- [ ] **Step 3: Implement in `widget/src/session.ts`**

Change the top of the file from:

```ts
const K_ID = "avb_session", K_NAME = "avb_name", K_CONSENT = "avb_consent", K_SOUND = "avb_sound";
```

to:

```ts
const K_ID = "avb_session", K_NAME = "avb_name", K_CONSENT = "avb_consent", K_SOUND = "avb_sound", K_VISITED = "avb_visited";
```

In the object returned by `createSession`, add two new methods (next to `soundOn`/`setSoundOn` is a
natural spot):

```ts
    hasVisitedBefore: (): boolean => store.get(K_VISITED) === "1",
    markVisited: (): void => store.set(K_VISITED, "1"),
```

Change the existing `forget` method from:

```ts
    forget: () => { store.remove(K_ID); store.remove(K_NAME); store.remove(K_CONSENT); store.remove(K_SOUND); },
```

to:

```ts
    forget: () => { store.remove(K_ID); store.remove(K_NAME); store.remove(K_CONSENT); store.remove(K_SOUND); store.remove(K_VISITED); },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/session.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add widget/src/session.ts widget/tests/session.test.ts
git commit -m "feat(widget): track first-visit state in session for proactive greeting"
```

---

### Task 2: config — `behavior.proactiveGreet` flag

**Files:**
- Modify: `widget/src/types.ts`
- Modify: `widget/src/config.ts`
- Test: `widget/tests/config.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WidgetConfig.behavior.proactiveGreet: boolean`, defaulting to `true` via
  `DEFAULTS.behavior.proactiveGreet`, mergeable from raw config exactly like every other `behavior`
  field (no new merge logic — `RawConfig`'s `behavior` is already `Partial<WidgetConfig["behavior"]>`).

- [ ] **Step 1: Write the failing test**

Append to `widget/tests/config.test.ts` (inside `describe("validateConfig", ...)`, after the
`"fills voice + language defaults"` test):

```ts
  it("defaults proactiveGreet to true and allows disabling it", () => {
    const cfg = validateConfig({ workerUrl: "https://w.test" });
    expect(cfg!.behavior.proactiveGreet).toBe(true);
    const disabled = validateConfig({ workerUrl: "https://w.test", behavior: { proactiveGreet: false } } as any);
    expect(disabled!.behavior.proactiveGreet).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/config.test.ts`
Expected: FAIL — `cfg!.behavior.proactiveGreet` is `undefined`, `expect(undefined).toBe(true)` fails.

- [ ] **Step 3: Implement**

In `widget/src/types.ts`, change:

```ts
  behavior: { autoGreet: boolean; rememberReturning: boolean; language: string };
```

to:

```ts
  behavior: { autoGreet: boolean; rememberReturning: boolean; language: string; proactiveGreet: boolean };
```

In `widget/src/config.ts`, change:

```ts
  behavior: { autoGreet: true, rememberReturning: true, language: "en-US" },
```

to:

```ts
  behavior: { autoGreet: true, rememberReturning: true, language: "en-US", proactiveGreet: true },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/config.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add widget/src/types.ts widget/src/config.ts widget/tests/config.test.ts
git commit -m "feat(widget): add behavior.proactiveGreet config flag (default true)"
```

---

### Task 3: `orb.ts` — non-focusing programmatic open

**Files:**
- Modify: `widget/src/orb.ts`
- Test: `widget/tests/orb.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `wireOrb(refs, onToggle?).open(opts?: { focus?: boolean }): void` — `opts.focus` defaults
  to `true` when omitted, so every existing call site (`refs.orb` click handler, all current tests)
  is unaffected. `open({ focus: false })` opens the panel without calling `refs.input.focus()`.

- [ ] **Step 1: Write the failing test**

Append to `widget/tests/orb.test.ts` (inside `describe("wireOrb", ...)`, after the
`"toggles the panel open on orb click and closed on close button"` test):

```ts
  it("open({ focus: false }) opens the panel without focusing the input; open() with no args still focuses it", () => {
    const refs = mountShell(cfg);
    const orb = wireOrb(refs);
    const focusSpy = vi.fn();
    refs.input.focus = focusSpy;

    orb.open({ focus: false });
    expect(refs.panel.getAttribute("data-open")).toBe("true");
    expect(focusSpy).not.toHaveBeenCalled();

    orb.close();
    orb.open();
    expect(refs.panel.getAttribute("data-open")).toBe("true");
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });
```

This also requires importing `vi` in the test file. Change the top import line from:

```ts
import { describe, it, expect } from "vitest";
```

to:

```ts
import { describe, it, expect, vi } from "vitest";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/orb.test.ts`
Expected: FAIL — TypeScript/runtime error, since `open()` currently takes no parameters and always
focuses (so `focusSpy` would be called on the very first `open({ focus: false })`, failing the
`not.toHaveBeenCalled()` assertion).

- [ ] **Step 3: Implement in `widget/src/orb.ts`**

Change:

```ts
  const setOpen = (open: boolean) => {
    refs.panel.setAttribute("data-open", String(open));
    if (open) refs.input.focus();
    onToggle?.(open);
  };
```

to:

```ts
  const setOpen = (open: boolean, focus = true) => {
    refs.panel.setAttribute("data-open", String(open));
    if (open && focus) refs.input.focus();
    onToggle?.(open);
  };
```

Change:

```ts
  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen()),
```

to:

```ts
  return {
    open: (opts?: { focus?: boolean }) => setOpen(true, opts?.focus ?? true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen()),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/orb.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add widget/src/orb.ts widget/tests/orb.test.ts
git commit -m "feat(widget): orb.open() takes an optional { focus } flag for non-focusing programmatic opens"
```

---

### Task 4: `voice/greet-on-interaction.ts` — speak-on-first-interaction module

**Files:**
- Create: `widget/src/voice/greet-on-interaction.ts`
- Test: Create `widget/tests/voice/greet-on-interaction.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  ```ts
  export interface UserActivationLike { hasBeenActive: boolean; }
  export interface InteractionDeps {
    userActivation?: UserActivationLike | null;
    addEventListener?: (type: string, cb: () => void, opts: { once: boolean; capture: boolean }) => void;
  }
  export function speakGreetingOnInteraction(speak: () => void, deps?: InteractionDeps): void;
  ```
  Task 5 imports `speakGreetingOnInteraction` and `type InteractionDeps` from this file.

- [ ] **Step 1: Write the failing tests**

Create `widget/tests/voice/greet-on-interaction.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { speakGreetingOnInteraction } from "../../src/voice/greet-on-interaction";

describe("speakGreetingOnInteraction", () => {
  it("speaks immediately when the visitor already interacted with the page (userActivation.hasBeenActive)", () => {
    const speak = vi.fn();
    speakGreetingOnInteraction(speak, { userActivation: { hasBeenActive: true } });
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("waits for the first click/keydown/touchstart when there's no prior activation", () => {
    const speak = vi.fn();
    const listeners: Record<string, () => void> = {};
    const addEventListener = vi.fn((type: string, cb: () => void) => { listeners[type] = cb; });
    speakGreetingOnInteraction(speak, { userActivation: { hasBeenActive: false }, addEventListener });
    expect(speak).not.toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalledWith("click", expect.any(Function), { once: true, capture: true });
    expect(addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function), { once: true, capture: true });
    expect(addEventListener).toHaveBeenCalledWith("touchstart", expect.any(Function), { once: true, capture: true });
    listeners.click();
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("treats a missing/unsupported userActivation the same as false — waits for interaction", () => {
    const speak = vi.fn();
    const listeners: Record<string, () => void> = {};
    const addEventListener = vi.fn((type: string, cb: () => void) => { listeners[type] = cb; });
    speakGreetingOnInteraction(speak, { addEventListener }); // no userActivation provided at all
    expect(speak).not.toHaveBeenCalled();
    listeners.keydown();
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("only speaks once even if more than one interaction listener fires", () => {
    const speak = vi.fn();
    const listeners: Record<string, () => void> = {};
    const addEventListener = vi.fn((type: string, cb: () => void) => { listeners[type] = cb; });
    speakGreetingOnInteraction(speak, { userActivation: { hasBeenActive: false }, addEventListener });
    listeners.click();
    listeners.keydown();
    listeners.touchstart();
    expect(speak).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/voice/greet-on-interaction.test.ts`
Expected: FAIL — cannot find module `../../src/voice/greet-on-interaction`.

- [ ] **Step 3: Implement `widget/src/voice/greet-on-interaction.ts`**

```ts
export interface UserActivationLike { hasBeenActive: boolean; }
export interface InteractionDeps {
  userActivation?: UserActivationLike | null;
  addEventListener?: (type: string, cb: () => void, opts: { once: boolean; capture: boolean }) => void;
}

export function speakGreetingOnInteraction(speak: () => void, deps: InteractionDeps = {}): void {
  const activation = deps.userActivation ??
    (typeof navigator !== "undefined" ? (navigator as unknown as { userActivation?: UserActivationLike }).userActivation : undefined);
  if (activation?.hasBeenActive) {
    speak();
    return;
  }
  const addEventListener = deps.addEventListener ?? ((type, cb, opts) => window.addEventListener(type, cb, opts));
  let fired = false;
  const onInteract = () => {
    if (fired) return;
    fired = true;
    speak();
  };
  (["click", "keydown", "touchstart"] as const).forEach((type) => addEventListener(type, onInteract, { once: true, capture: true }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/voice/greet-on-interaction.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add widget/src/voice/greet-on-interaction.ts widget/tests/voice/greet-on-interaction.test.ts
git commit -m "feat(widget): add speakGreetingOnInteraction — speak now or on first page interaction"
```

---

### Task 5: `index.ts` — wire the proactive-greeting trigger

**Files:**
- Modify: `widget/src/index.ts`
- Test: `widget/tests/index.test.ts`

**Interfaces:**
- Consumes: `session.hasVisitedBefore()`/`markVisited()` (Task 1), `cfg.behavior.proactiveGreet`
  (Task 2), `orb.open(opts?: { focus?: boolean })` (Task 3),
  `speakGreetingOnInteraction(speak, deps?)` + `type InteractionDeps` (Task 4).
- Produces: two new optional `MountDeps` fields (`userActivation`, `interactionAddEventListener`)
  that tests use to control the speak-timing branch deterministically.

- [ ] **Step 1: Write the failing tests**

Append to `widget/tests/index.test.ts`, inside `describe("mount", ...)`, after the
`"conversation mode: an empty/no-speech result keeps listening without going through send()"` test
(or any existing test — order doesn't matter, just keep it inside the same `describe` block):

```ts
  it("first-time visitor: auto-opens the panel and speaks the greeting after a delay, regardless of the mute default", async () => {
    vi.useFakeTimers();
    try {
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/tts")) return new Response("audio", { status: 200 });
        throw new Error("chat should not be called by the proactive greeting");
      }) as unknown as typeof fetch;
      const app = mount(baseCfg, {
        store: memoryStore(),
        fetchImpl,
        makeAudio: () => audio,
        userActivation: { hasBeenActive: true },
      } as any)!;
      expect(app.refs.panel.getAttribute("data-open")).toBe("false"); // not yet — delay hasn't elapsed
      await vi.advanceTimersByTimeAsync(1800);
      expect(app.refs.panel.getAttribute("data-open")).toBe("true");
      expect(app.refs.list.textContent).toContain("Hi there!"); // baseCfg's greeting text
      await vi.advanceTimersByTimeAsync(0); // let the queued speak()'s fetch/play chain settle
      expect(audio.played).toBe(true); // spoke despite speakByDefault:false/soundOn default being off
    } finally {
      vi.useRealTimers();
    }
  });

  it("returning visitor: does not auto-open (avb_visited already set)", async () => {
    vi.useFakeTimers();
    try {
      const store = memoryStore();
      store.set("avb_visited", "1");
      const app = mount(baseCfg, { store, fetchImpl: fetch } as any)!;
      await vi.advanceTimersByTimeAsync(5000); // well past the 1800ms delay
      expect(app.refs.panel.getAttribute("data-open")).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/index.test.ts`
Expected: FAIL — the first new test times out or the panel never opens (`data-open` stays `"false"`
after advancing timers, since no such `setTimeout` exists yet); TypeScript may also flag the unknown
`userActivation` `MountDeps` field, hence `as any` is used in the test itself so the test can be
written before the type exists.

- [ ] **Step 3: Implement in `widget/src/index.ts`**

Add the import at the top, alongside the other `voice/` imports:

```ts
import { speakGreetingOnInteraction, type InteractionDeps } from "./voice/greet-on-interaction";
```

Extend `MountDeps` (currently ending with `cancelFrame?: VisualizerDeps["cancelFrame"];`) by adding
two fields:

```ts
export interface MountDeps {
  store?: Store;
  fetchImpl?: typeof fetch;
  synth?: SynthLike | null;
  makeAudio?: (res: Response) => AudioLike | Promise<AudioLike>;
  getUserMedia?: VisualizerDeps["getUserMedia"];
  AudioContextCtor?: VisualizerDeps["AudioContextCtor"];
  requestFrame?: VisualizerDeps["requestFrame"];
  cancelFrame?: VisualizerDeps["cancelFrame"];
  userActivation?: InteractionDeps["userActivation"];
  interactionAddEventListener?: InteractionDeps["addEventListener"];
}
```

Add a module-level constant just above `export function mount(...)`:

```ts
const PROACTIVE_OPEN_DELAY_MS = 1800;
```

Insert the trigger block right after the existing `const orb = wireOrb(refs, (open) => { ... });`
block (i.e. immediately before the existing `speaker?.onState((s) => { ... });` line):

```ts
    if (cfg.behavior.autoGreet && cfg.behavior.proactiveGreet && !session.hasVisitedBefore()) {
      session.markVisited();
      setTimeout(() => {
        orb.open({ focus: false });
        if (cfg.voice.enabled && speaker) {
          speakGreetingOnInteraction(() => { void speaker!.speak(cfg.branding.greeting); }, {
            userActivation: deps.userActivation,
            addEventListener: deps.interactionAddEventListener,
          });
        }
      }, PROACTIVE_OPEN_DELAY_MS);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/index.test.ts`
Expected: PASS (16 tests).

Then run the full suite to confirm nothing else regressed:

Run: `npm test`
Expected: PASS (all test files, 96 tests total: 86 baseline + 2 session + 1 config + 1 orb + 4 greet-on-interaction + 2 index).

- [ ] **Step 5: Typecheck, build, and commit**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: `built dist/ai-voice-bot.min.js`.

```bash
git add widget/src/index.ts widget/tests/index.test.ts
git commit -m "feat(widget): wire proactive first-visit auto-open + spoken greeting"
```

---

## Final Verification

- [ ] Run the full suite once more from `widget/`: `npm test` — all tests pass.
- [ ] `npm run typecheck` — clean.
- [ ] `npm run build` — succeeds, `dist/ai-voice-bot.min.js` rebuilt.
- [ ] Manual smoke test (per spec §8): clear site data for `localhost:8080` (or use a fresh
  incognito window), load `widget/demo-embed.html` with the worker running — the panel should open
  on its own after a couple seconds and show the greeting text; interact with the page once (click
  anywhere) if it doesn't already speak immediately, and confirm Leo's voice plays. Reload the page —
  confirm the panel now stays closed until manually opened.
