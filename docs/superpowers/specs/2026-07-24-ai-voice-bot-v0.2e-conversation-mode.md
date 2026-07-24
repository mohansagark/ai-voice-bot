# AI Voice Bot v0.2e — Continuous Conversation Mode + Live Audio Visualization — Technical Specification

**Version:** 1.0 (design/spec — no implementation yet)
**Date:** 2026-07-24
**Author:** Mohan Sagar K
**Status:** Approved design, ready for implementation

> Voice UX refinement, requested after local testing of v0.2d. Turns tap-to-talk (one utterance per
> tap) into hands-free back-and-forth conversation, and adds a real, mic-volume-reactive "Siri-like"
> animation while listening. No backend changes. Builds on `feat/v0.2d` (`ca601b4`).

---

## 1. Goal

Today, the visitor must tap the mic before every single utterance. This makes voice feel like a
button-mashing chore rather than a conversation. This slice adds a **conversation mode**: one tap
starts a hands-free loop that keeps listening — sending each utterance, waiting for Leo's reply to
be generated and spoken, then automatically listening again — until the visitor taps the mic again
to stop. Alongside this, the mic gets a **real audio-reactive visualization** (a glowing halo +
mini equalizer bars on the mic button, and a live waveform line replacing the text input) so it's
obvious the widget is actually hearing you, not just idling.

---

## 2. Locked Decisions

| # | Area | Decision |
|---|------|----------|
| E1 | Toggle gesture | Tap mic → conversation mode **on**, start listening. Tap mic again, any time → conversation mode **off**, stop listening. A pure toggle, not a hold-to-talk gesture. |
| E2 | Auto-restart timing | After the visitor's utterance is sent and Leo's reply is fully generated **and spoken** (if speech plays), the mic **automatically starts listening again** if conversation mode is still on. Restart is deliberately delayed until speech finishes, to avoid the mic capturing Leo's own voice as if it were the visitor's. |
| E3 | Silence/no-speech resilience | If a listening session ends with no captured speech (silence timeout, background noise, recognition error) **and no message is in flight**, keep listening automatically — conversation mode does not exit on its own. |
| E4 | Visual: mic button | While actively listening, the 🎤 icon is replaced by a **glowing halo pulse + 3-bar mini equalizer**, both driven by **real mic amplitude** (Web Audio `AnalyserNode`), not a canned animation. Chosen over a stylized-only loop and over halo-alone/bars-alone, via mockup review (Option C). |
| E5 | Visual: input row | While actively listening, the text `<input>` is replaced by a **live waveform line** (many thin bars spanning the row, same amplitude source as E4). The Send button stays visible at all times, but becomes **icon-only** (paper-plane SVG) instead of the text label "Send" — a permanent style change, not conditional on listening state. |
| E6 | Audio access | A second, independent mic access path via `getUserMedia` + `AnalyserNode`, separate from `SpeechRecognition` (which doesn't expose raw waveform data to JS). Assumed to share the same permission grant as `SpeechRecognition` on a real origin (already required to be `http(s)`, not `file://`, per the v0.2d local-testing fix) — verified manually, not something the code can control. |
| E7 | Graceful degradation | If the visualization's `getUserMedia`/`AudioContext` path fails for any reason (old browser, mic busy, permission denied for this specific path), it fails **silently** — speech capture keeps working via `SpeechRecognition` exactly as before; only the animation is lost (mic button falls back to its existing static `.listening` border style, input stays a normal text field). |
| E8 | Out of scope | Typing while conversation mode is on does not auto-disable it (rare edge case, unhandled). Tapping the mic off does not interrupt Leo's in-progress speech. True per-frequency-band visualization (this uses one overall amplitude level, rendered with small per-bar phase offsets for an organic look, not real per-bin frequency data). |

---

## 3. `widget/src/voice/visualizer.ts` (new module)

Audio-capture-and-analysis only — no DOM rendering. Mirrors the existing `voice/stt.ts`/`voice/tts.ts`
pattern: real browser APIs behind injectable dependencies, so it's unit-testable without a real mic.

```ts
export interface VisualizerDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  AudioContextCtor?: new () => AudioContextLike;
  requestFrame?: (cb: (t: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}
export interface AnalyserLike { fftSize: number; frequencyBinCount: number; getByteFrequencyData(arr: Uint8Array): void; }
export interface AudioContextLike {
  createMediaStreamSource(stream: MediaStream): { connect(node: AnalyserLike): void };
  createAnalyser(): AnalyserLike;
  close(): Promise<void> | void;
}
export interface Visualizer { start(): Promise<void>; stop(): void; }

export function createVisualizer(onLevel: (level: number) => void, deps?: VisualizerDeps): Visualizer;
```

- `start()`: calls `getUserMedia({ audio: true })`, builds `AudioContext → MediaStreamAudioSourceNode → AnalyserNode`, then drives a `requestAnimationFrame` loop reading `getByteFrequencyData` into a normalized `level` (0–1, e.g. mean of the byte array / 255), invoking `onLevel(level)` every frame. Never throws — any rejection/exception is caught internally and `start()` resolves anyway (E7); callers don't need their own try/catch.
- `stop()`: cancels the animation frame loop, stops every track on the `MediaStream`, closes the `AudioContext`. Safe to call even if `start()` never successfully completed (no-op).
- Calling `start()` while already started is a no-op (idempotent), matching the mic/recognizer's existing double-tap guard pattern.

---

## 4. Widget shell changes (`dom.ts`, `styles.ts`)

### 4.1 Mic button markup
```html
<button type="button" class="mic" aria-label="Speak your message">
  <span class="mic-icon">🎤</span>
  <span class="mic-halo"></span>
  <span class="mic-bars"><span></span><span></span><span></span></span>
</button>
```
CSS: `.mic-halo`/`.mic-bars` are `display: none` by default; `.mic.listening .mic-icon { display: none }`,
`.mic.listening .mic-halo, .mic.listening .mic-bars { display: block/flex }`. The halo is a radial-gradient
pseudo-circle (`position: absolute`, centered via inset, `border-radius: 50%`); bars are 3 thin
`span`s with `height` driven per-frame from JS (not a canned `@keyframes` loop — see §4.3).

### 4.2 Input row markup
```html
<div class="input-wrap">
  <input type="text" placeholder="Type a message…" autocomplete="off" aria-label="Message" />
  <div class="waveform" aria-hidden="true"><!-- N spans, generated once at mount --></div>
</div>
<button type="submit" class="send" aria-label="Send message">
  <svg viewBox="0 0 24 24" ...><path d="M3 11.5L20 4L12.5 21L10.5 13.5L3 11.5Z" .../></svg>
</button>
```
`form.listening input { display: none } form.listening .waveform { display: flex }` (and the reverse
for the non-listening default) — the `listening` class toggles on the `<form>` element itself, kept
in sync with the mic's own `.listening` class by `index.ts`. The waveform is ~32 pre-rendered `span`
elements (generated once in `mountShell`, not per-frame) whose `height` is updated per-frame.

Send button always renders as the icon (E5) — no text-label variant.

### 4.3 Per-frame rendering
A small render function (in `dom.ts` or a sibling helper) takes the `level: number` from the
visualizer's `onLevel` callback and updates:
- `.mic-halo`: `transform: scale(...)` and `opacity` mapped from `level`.
- `.mic-bars span` (3) and `.waveform span` (~32): each bar's `height` computed from `level` plus a
  small deterministic per-index phase offset (e.g. `Math.sin(i * 0.6 + performance.now() / 200)`)
  so bars don't move in lockstep — a rendering-layer trick, not real per-band frequency data (E8).

### 4.4 New `Refs` fields
```ts
micHalo: HTMLElement; micBars: HTMLElement; waveform: HTMLElement;
```
Additive only — no existing `Refs` fields change shape.

---

## 5. `index.ts` — conversation-mode state machine

New state alongside the existing `listening: boolean`:
```ts
let conversationMode = false;
let awaitingReply = false;   // true from "utterance captured, message in flight" until reply done+spoken
```

**Mic tap** (replaces today's `if (listening) return;` guard):
```ts
refs.mic.addEventListener("click", () => {
  if (conversationMode) { conversationMode = false; stopListening(); return; }
  conversationMode = true;
  startListening();
});
```
`startListening()`/`stopListening()` are small helpers wrapping `recognizer.start()`/`.stop()` +
`orb.setListening(...)` + `refs.form.classList.toggle("listening", ...)` + the visualizer's
`start()`/`stop()` (§3) — one place that keeps STT, the visual state, and the audio-level analyser
all in sync.

**Recognizer callbacks:**
```ts
onResult: (text) => {
  stopListeningVisualState(); // orb/form visuals off, but keep conversationMode as-is
  const t = text.trim();
  if (!t) { if (conversationMode) startListening(); return; } // nothing captured, keep the loop going (E3)
  awaitingReply = true;
  refs.input.value = t;
  pendingVoice = true;
  refs.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
},
onEnd: () => {
  stopListeningVisualState();
  if (conversationMode && !awaitingReply) startListening(); // silence/no-result end — keep going (E3)
},
onError: () => {
  stopListeningVisualState();
  if (conversationMode && !awaitingReply) startListening();
},
```

**Restart timing is driven by the speaker's existing `onState` callback, not by awaiting `speak()`.**
`speaker.speak(text): Promise<void>` resolves when `audio.play()` resolves — which is when playback
**starts**, not when it ends (confirmed in `widget/src/voice/tts.ts`); the actual "finished talking"
signal is the `onState` callback transitioning to `"idle"` (fired from `audio.onended`). `index.ts`
already has exactly one `onState` subscription (`speaker?.onState((s) => orb.setSpeaking(...))`) —
this slice extends that same callback rather than adding a second one (the `Speaker` interface only
holds a single callback), tracked via a new `awaitingSpeechEnd` flag:
```ts
speaker?.onState((s) => {
  orb.setSpeaking(s === "speaking");
  if (s === "idle" && awaitingSpeechEnd) {
    awaitingSpeechEnd = false;
    if (conversationMode) startListening();
  }
});
```
`send()`'s `onDone` sets `awaitingSpeechEnd` (when speech will actually play) or restarts listening
immediately (when it won't):
```ts
onDone: (reply) => {
  panel.endBot(line, reply);
  orb.setThinking(false);
  awaitingReply = false;
  if (shouldSpeak(voiceInitiated, soundOn) && speaker) {
    awaitingSpeechEnd = true;
    speaker.speak(reply); // fire-and-forget, as today — onState('idle') triggers the restart above
  } else if (conversationMode) {
    startListening();
  }
},
onError: () => { line.remove(); panel.showError(); orb.setThinking(false); emit(analytics, "error"); awaitingReply = false; if (conversationMode) startListening(); },
onBlocked: () => { line.remove(); orb.setThinking(false); emit(analytics, "blocked"); awaitingReply = false; if (conversationMode) startListening(); },
```
`send()` also resets `awaitingSpeechEnd = false` right before its existing `speaker?.stop()` call (at
the top of `send()`), so a new message sent while a previous reply is still speaking can't trigger a
stale restart — `stop()` itself fires `onState("idle")` (an existing v0.2c behavior, for clearing the
orb's speaking animation on mute), which would otherwise be misread as "the reply we're waiting on
just finished." `send`'s signature and every other call site are unchanged; `onDone` stays
synchronous (no `async`/`await` needed anywhere in this flow).

---

## 6. Testing

| Layer | Approach |
|-------|----------|
| `visualizer.ts` | Vitest with injected `getUserMedia`/`AudioContextCtor`/`requestFrame`/`cancelFrame` fakes: `start()` resolves and begins invoking `onLevel` with values derived from fake analyser byte data; `start()` never rejects/throws even when `getUserMedia` rejects (E7); `stop()` cancels the frame loop and stops all fake `MediaStreamTrack`s; calling `start()` twice without `stop()` is a no-op the second time. |
| Conversation-mode state machine (`index.ts`) | Vitest + happy-dom, extending the existing `FakeRecognition` instance-capture pattern from the current test suite: mic tap toggles `conversationMode`; a captured result with text sends and sets `awaitingReply`; after a mocked `onDone` (with a resolved fake `speaker.speak()`), listening auto-restarts iff still in conversation mode; a second mic tap mid-cycle prevents the restart; an empty/no-speech `onResult`/`onEnd` restarts listening without going through `send()`. |
| DOM structure | Extend `dom.test.ts`: `Refs.micHalo`/`micBars`/`waveform` exist and live in the shadow root; `form` gains/loses the `listening` class in sync with `orb.setListening`. |
| Rendering | Unit test the level→visual mapping function in isolation (pure function of `level` + bar index → style values), not the real rAF loop. |
| Manual/browser smoke | Real device: tap mic once, have a multi-turn conversation without re-tapping; confirm the halo/bars/waveform visibly react to actual speaking volume; confirm tapping mic mid-conversation stops it cleanly; confirm silence mid-conversation doesn't drop out of conversation mode; confirm the visualization degrades gracefully (no animation, but capture still works) if mic access for the analyser is denied while `SpeechRecognition` itself still has permission. |

---

## 7. Out of Scope (→ later)

- Typing while conversation mode is on auto-disabling it.
- Interrupting Leo's speech when the mic is tapped off mid-reply.
- True per-frequency-band visualization (real multi-band analysis rather than one amplitude level with per-bar phase offsets).
- Any backend/agent changes.

---

## 8. Risks

| # | Item | Mitigation |
|---|------|------------|
| R1 | A second `getUserMedia` call could, on some browser/permission-model combination, prompt separately from `SpeechRecognition`'s own mic access | E7: fails silently, speech capture is unaffected either way; documented as an assumption to verify manually (§6), not a code-level guarantee. |
| R2 | Holding a live `MediaStream`/`AudioContext` open across a long conversation could leak resources if `stop()` isn't reliably called on every exit path (tap-off, unmount, error) | `stopListening()` is the single choke point for both the recognizer and the visualizer's `stop()` — called from every exit path (tap-off, `onResult`, `onEnd`, `onError`), not duplicated per-callsite logic. |
| R3 | A second `send()` firing while a previous reply is still speaking could misfire the restart (since `speaker.stop()` itself emits `onState("idle")`) | `awaitingSpeechEnd` is explicitly reset to `false` before `send()`'s existing `speaker?.stop()` call, so a stale flag from the previous turn can't trigger a spurious restart. |
| R4 | Per-frame style updates (halo/bars/waveform, up to ~35 elements) at 60fps could be a performance concern on low-end devices | Only active while the mic is actually listening (a bounded, visitor-initiated window), not continuously; simple `height`/`opacity`/`transform` updates are cheap relative to layout-triggering properties. |

---

*End of v0.2e specification. Continues on `feat/v0.2d`; the finished branch still needs the pending manual browser smoke test and a production redeploy of the TTS model fix before merging.*
