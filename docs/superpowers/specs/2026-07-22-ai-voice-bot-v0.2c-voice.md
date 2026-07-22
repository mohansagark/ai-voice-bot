# AI Voice Bot v0.2c — Voice (STT + TTS) — Technical Specification

**Version:** 1.0 (design/spec — no implementation yet)
**Date:** 2026-07-22
**Author:** Mohan Sagar K
**Status:** Approved design, ready for implementation

> Final slice of v0.2 (a → b → **c**). Adds voice to the merged widget: the visitor can talk
> to Leo (tap-to-talk mic) and Leo can talk back (neural voice). Adds one backend endpoint
> (`/tts`); everything else layers onto the v0.2b widget. Builds on `main` (`475be9c`).

---

## 1. Goal

Make it an actual **voice** bot: a tap-to-talk mic for input (browser speech recognition, text
always available as fallback) and a spoken reply for output (Groq neural voice via a new `/tts`
endpoint, browser voice as fallback). Voice is **opt-in and calm** — text-first UI, Leo speaks
only when spoken to (plus a mute/unmute toggle), and all audio/mic starts on a user gesture.

---

## 2. Locked Decisions

| # | Area | Decision |
|---|------|----------|
| C1 | Voice input | **Tap-to-talk mic button** (text-first, opt-in). Tap → listen for one utterance → send. Text input always available. |
| C2 | Voice output | **Speak when spoken to**: Leo speaks the reply when the visitor used the mic. A **mute/unmute toggle** (header) forces sound on (even for typed) or off. State persisted. |
| C3 | STT | **Browser Web Speech API** (`SpeechRecognition`) only. Where unsupported/denied (Safari/Firefox), the mic is disabled with a hint and the visitor types. **Cloud STT (Groq Whisper) deferred.** |
| C4 | TTS | **Groq PlayAI neural TTS** via a new backend `/tts` (one consistent voice on every device) → **browser TTS** fallback → silent. |
| C5 | Backend | New `POST /tts` on the Worker (reuses `GROQ_API_KEY`), behind the same origin + dev/prod guards as `/chat`. `/health` reports the TTS provider. |
| C6 | Orb states | Add **listening** (reactive while mic open) and **speaking** (animated during playback) to the existing idle/thinking. |
| C7 | Gestures | Mic capture and first audio playback are triggered by the visitor's tap (iOS autoplay/mic rules). No autoplay of speech. |
| C8 | Config | `behavior.language` (STT/TTS locale), `voice.ttsVoice` (neural voice id), `voice.enabled` (master off-switch). Widget stays forward-compatible with these keys (already ignored in v0.2b). |
| C9 | Accessibility | Mic button + mute toggle are keyboard-operable with ARIA; orb animations respect `prefers-reduced-motion`; the text transcript remains the source of truth (captions for spoken output). |

---

## 3. Backend — `POST /tts` (Groq neural TTS)

New endpoint in the Worker (no change to `/chat`).

### 3.1 Contract
```jsonc
POST /tts
{ "text": "Hi, I'm Leo…", "voice": "Fritz-PlayAI" }   // voice optional; defaults from config
```
- **Success:** `200`, `Content-Type: audio/wav` (or `audio/mpeg`), body = the audio bytes.
- **Guard failures (prod only):** `403` origin not allowed; `400` missing/empty text; `413` text over a cap (e.g. 1200 chars). In **dev** mode these guards are bypassed (same `MODE` switch as `/chat`).
- **Provider failure:** `502` (JSON `{ error }`, CORS-safe) → the widget falls back to browser TTS.

### 3.2 Implementation (`worker/src/tts.ts`)
- Calls Groq speech: `POST https://api.groq.com/openai/v1/audio/speech` with
  `{ model: "playai-tts", voice, input: text, response_format: "wav" }`, `Authorization: Bearer ${GROQ_API_KEY}`.
- Injectable `fetchImpl` (so the handler is unit-testable without a real Groq call).
- Config: `tts.voice` (default `Fritz-PlayAI`) in `config.ts`; `/health` reports `tts: "groq"` when a key is present, else `"browser"`.
- Guarded in `index.ts` exactly like `/chat` (origin + dev/prod `enforce`), with a text-length cap.

> The `playai-tts` model requires one-time terms acceptance in the Groq console; documented in the deploy notes. If unavailable, the widget's browser-TTS fallback keeps voice working.

---

## 4. Widget — the voice layer

Layers onto the v0.2b widget (Shadow DOM, orb, panel, SSE client). New modules under
`widget/src/voice/`.

### 4.1 STT (`voice/stt.ts`) — tap-to-talk
- `sttSupported(): boolean` — `('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window)`.
- `createRecognizer(lang, { onResult, onEnd, onError })` → `{ start(), stop() }`. Single-utterance
  (`continuous = false`, `interimResults` optional). `start()` must be called from a user gesture.
- On result → the transcript becomes the outgoing message (sent through the existing chat flow).
- On unsupported/denied → the mic button is disabled with a title hint ("voice input isn't
  available in this browser — type instead"); text input is unaffected.

### 4.2 TTS (`voice/tts.ts`) — the fallback chain
- `createSpeaker(cfg, { fetchImpl?, synth? })` → `{ speak(text), stop(), onState(cb) }`.
- `speak(text)`:
  1. **Groq neural:** `POST {workerUrl}/tts { text, voice }` → play the returned audio via an
     `Audio` element (object URL). Emit `speaking` state during playback.
  2. **Browser fallback:** on non-OK/`/tts` error → `window.speechSynthesis` with a best-voice
     pick for the locale.
  3. **Silent:** if neither is available, do nothing (transcript already shows the reply).
- `stop()` cancels current playback/synthesis (used when the visitor sends a new message).

### 4.3 Orb states (`orb.ts` + `styles.ts`)
- Add `listening` (a soft reactive pulse while the mic is open) and `speaking` (a waveform/pulse
  during playback) classes, alongside idle/thinking. Only one active at a time; all animations
  gated behind `prefers-reduced-motion`.

### 4.4 UI (`dom.ts` / `panel.ts`)
- **Mic button** in the input row (next to Send). Tap → `orb.setListening(true)` + start
  recognition; on result → fill/send; on end → `setListening(false)`. Disabled + hinted when STT
  unsupported.
- **Sound toggle** (🔊/🔇) in the header — persisted in localStorage; controls whether Leo speaks.
- Spoken output is **captioned** by the existing streamed transcript (nothing audio-only).

### 4.5 Flow (`index.ts` wiring)
1. Visitor taps mic → listen → transcript → send through the existing consent-gated chat flow
   (the reply streams as text as it does today).
2. **Speak decision:** if the message was voice-initiated **OR** the sound toggle is on → on
   `done`, `speaker.speak(finalReply)` (orb → speaking). Typed input with sound off → silent.
3. Sending a new message `speaker.stop()`s any in-progress speech.
4. First mic use / first playback happens inside the tap handler (gesture) for iOS.

### 4.6 Config additions (`window.AiVoiceBotConfig`)
```js
behavior: { /* …existing… */ language: "en-US" },   // drives STT + TTS locale
voice: {
  enabled: true,            // master off-switch (false → no mic/speak at all)
  ttsVoice: "Fritz-PlayAI", // neural voice id (Groq) or browser voice name for fallback
  speakByDefault: false,    // initial sound-toggle state
},
```
Defaults keep v0.2b behavior if `voice` is omitted; unknown keys already ignored.

---

## 5. Testing

| Layer | Approach |
|-------|----------|
| Backend `/tts` | Vitest with injected `fetch`: returns audio content-type on a mocked Groq audio response; origin 403 (prod) / bypass (dev); 400 empty text; 413 over-cap; 502 on Groq failure. Mirrors the `/chat` handler tests. |
| Widget TTS chain | Vitest + injected `fetchImpl` + fake `speechSynthesis`: neural path plays audio; on `/tts` failure falls back to synth; on neither, silent. `speak` decision (voice-initiated OR sound-on) unit-tested. |
| Widget STT | Vitest: `sttSupported()` detection with a stubbed `window`; recognizer wrapper dispatches `onResult`/`onError` from a fake `SpeechRecognition`. |
| Orb states | happy-dom: `setListening`/`setSpeaking` toggle the right classes; only one active. |
| Manual/browser smoke | Real device pass (Chrome desktop full; Safari/iOS: TTS + text, mic gesture; Firefox: text + TTS): tap-to-talk transcribes and sends; Leo speaks the neural voice; mute toggle silences; unsupported-STT browser disables the mic gracefully; `prefers-reduced-motion` calms the orb. |

Pure logic (STT detection, TTS fallback chain, speak-decision, `/tts` handler) is unit-tested
with injected browser APIs / fetch; real mic + audio playback are validated by the manual smoke.

---

## 6. Out of Scope (→ later)

- **Cloud STT (Groq Whisper `/stt`)** for Safari/Firefox mic parity — deferred; browser STT + text fallback only.
- Sentence-chunked TTS synced to the token stream (speak-as-it-streams) — v1 speaks the final reply.
- ElevenLabs/Azure neural TTS adapters + the multi-provider failover chain — later.
- npm/CDN publish + deploy → **v0.3**.

---

## 7. Risks

| # | Item | Mitigation |
|---|------|------------|
| R1 | iOS Safari: no speech autoplay; mic needs a gesture | All mic/playback triggered by the visitor's tap; never autoplay. Documented. |
| R2 | Safari/Firefox: patchy/absent `SpeechRecognition` | Feature-detect; disable the mic with a hint; text input unaffected (never a dead widget). |
| R3 | Groq `playai-tts` needs terms acceptance / may be unavailable | One-time acceptance documented; browser-TTS fallback keeps voice working regardless. |
| R4 | Groq TTS latency on long replies | Cap `/tts` text length; keep replies short (system prompt already does); consider chunking later. |
| R5 | Audio format compatibility | Request `wav` (broadly `Audio`-playable); fall back to browser TTS if playback fails. |
| R6 | Extra Groq cost/abuse via `/tts` | Origin + dev/prod guards + text cap; only spoken when voice-initiated/sound-on (bounded calls). |

---

*End of v0.2c specification. After this, v0.3: npm/CDN publish + deploy to voicebot.devmohan.in + embed on devmohan.in.*
