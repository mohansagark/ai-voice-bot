# AI Voice Bot v0.2b — The Embeddable Widget (text-first) — Technical Specification

**Version:** 1.0 (design/spec — no implementation yet)
**Date:** 2026-07-22
**Author:** Mohan Sagar K
**Status:** Approved design, ready for implementation

> Second slice of v0.2 (a → **b** → c). Builds the actual embeddable widget that consumes the
> v0.2a SSE contract. **Text-first** — voice (STT/TTS) is v0.2c. Replaces the throwaway
> `demo.html` with a real, self-mounting `ai-voice-bot.min.js`. Backend (`main`, `b17019d`) is
> unchanged by this slice.

---

## 1. Goal

Ship the browser widget a site owner drops onto their page with one `<script>` tag + a config
object. It renders a floating **orb launcher** and a **chat panel**, streams Leo's replies
token-by-token over the existing `/chat` SSE endpoint, remembers returning visitors, gates on
consent, and stays fully isolated from the host page's styles. No backend changes.

---

## 2. Locked Decisions

| # | Area | Decision |
|---|------|----------|
| B1 | Language/build | **TypeScript → esbuild** → a single self-mounting minified **IIFE** `dist/ai-voice-bot.min.js`, **zero runtime deps**. |
| B2 | Style isolation | **Shadow DOM.** The entire widget renders inside a shadow root; host CSS can't leak in, widget CSS can't leak out. |
| B3 | Mount | On load, read `window.AiVoiceBotConfig`, validate it, and mount. A missing/invalid `workerUrl` logs a clear console error and the widget stays dormant (never throws into the host page). |
| B4 | Transport | Consumes the v0.2a `/chat` contract: `POST { session_id, message, consent }` → **SSE** (`token`/`lead`/`done`/`error`); `429` = blocked/rate (silent per v0.2a). |
| B5 | Memory | `session_id` (UUID) persisted in `localStorage`; sent every turn so the Durable Object supplies history. Returning visitor recognized client-side (stored first name) for a "welcome back" greeting. |
| B6 | Consent | A one-line consent notice (config text + optional privacy-policy link) shown before the first message is sent; recorded with a timestamp and passed in every `/chat` body. |
| B7 | Scope | **Text-only.** Orb states: **idle** + **thinking**. Mic/STT, TTS, and the orb's listening/speaking states are **v0.2c**. |
| B8 | Config | `window.AiVoiceBotConfig` — v0.2b subset (below). Voice keys are accepted-but-ignored (forward-compatible). |
| B9 | Testing | Pure logic (config validation, SSE-stream parsing, session/consent) unit-tested with Vitest (+ injected `fetch`/`localStorage`, no full DOM). DOM/orb via a real embed demo page for manual/Playwright smoke. |
| B10 | Distribution | Build produces the file; actual npm + CDN **publish** is v0.3. This slice ships the built artifact + an embed demo. |

---

## 3. Architecture

```
Host page (e.g. devmohan.in)
  <script>window.AiVoiceBotConfig = { workerUrl: "...", branding: {...}, ... }</script>
  <script src=".../ai-voice-bot.min.js" defer></script>
        │  on load
        ▼
  index.ts  ── validate config ──▶ mount()
        │
        ▼
  host element  ── attachShadow({mode:"open"}) ──▶ shadow root
        ├─ <style>  (styles.ts — themeColor-driven, scoped to shadow)
        ├─ orb launcher (orb.ts)        ── click ──▶ toggles panel
        └─ chat panel (panel.ts)
              ├─ message list (streamed tokens render here)
              ├─ consent gate (consent.ts) — shown before first send
              └─ text input ── submit ──▶ client.ts
                                              │  POST /chat (SSE)
                                              ▼
                                    Cloudflare Worker (unchanged)
```

The widget mounts into a single container `<div>` appended to `document.body`; everything
visible lives under its shadow root. Nothing the widget does can throw into or restyle the host.

---

## 4. The `/chat` client (`client.ts`)

Pure, injectable (fetch is a parameter → unit-testable):

```ts
export interface ChatEvents {
  onToken(text: string): void;
  onLead(lead: unknown): void;
  onDone(reply: string, leadSaved: boolean): void;
  onError(message: string): void;
  onBlocked(): void;          // 429 (spam/rate) — go quiet
}

export async function sendChat(
  workerUrl: string,
  body: { session_id: string; message: string; consent: unknown },
  events: ChatEvents,
  fetchImpl?: typeof fetch,
): Promise<void>;
```

- POSTs JSON to `${workerUrl}/chat`.
- On `res.status === 429`: read the body; if `{ blocked: true }` → `onBlocked()` (render nothing);
  otherwise treat as a rate/limit note. On other non-2xx / no body → `onError`.
- Otherwise reads `res.body` as a stream, buffers, splits on `\n\n`, parses each `event:`/`data:`
  frame, and dispatches: `token`→`onToken`, `lead`→`onLead`, `done`→`onDone`, `error`→`onError`.
- Robust to partial frames across chunks (keep a trailing buffer). Network failure → `onError`.

The SSE-parsing core is a small pure function tested against a synthetic byte stream.

---

## 5. UI & behavior

### 5.1 Orb launcher (`orb.ts`)
- Floating button, `branding.position` (bottom-right default), `branding.themeColor`.
- **Idle:** gentle pulse. **Thinking:** subtle shimmer/spinner while awaiting the first token.
- Click toggles the panel open/closed. Keyboard-operable (Enter/Space), `aria-label`, focus ring.

### 5.2 Chat panel (`panel.ts`)
- Header (bot name + close), scrollable message list, text input + send button.
- Visitor messages right-aligned; Leo's left-aligned. **Streaming:** Leo's line grows as `token`
  frames arrive; on `done`, the final reply is settled. On `lead`, a subtle "✓ sent to {owner}"
  affordance. On `error`, a friendly inline "hmm, something hiccuped — try again." On `blocked`,
  the panel simply stops responding (no new Leo line).
- Respects `prefers-reduced-motion`. Mobile-responsive (panel fills small screens).

### 5.3 Consent (`consent.ts`)
- Before the **first** message is sent: show `privacy.consentText` + optional
  `privacy.privacyPolicyUrl` link + an "OK / I agree" affordance.
- On accept: store `{ agreed: true, timestamp, text }` in memory + localStorage; include it in
  every `/chat` body. If already consented (localStorage), skip the gate.

### 5.4 Session & returning visitor (`session.ts`)
- `session_id`: UUID, created once, stored in `localStorage` (`avb_session`). Sent every turn.
- On a `lead` event, store the visitor's first name (`avb_name`) if `rememberReturning`.
- On open: if a stored name exists → greeting is "Welcome back, {name}!" else `branding.greeting`.
- A "forget me" control clears `avb_session`/`avb_name`/consent (privacy).

### 5.5 Greeting
- `autoGreet` (default true): show the greeting line (static, no backend call) when the panel
  first opens. The visitor's first typed message starts the real conversation (backend has the
  history via the DO).

---

## 6. Config schema (`window.AiVoiceBotConfig`) — v0.2b subset

```js
window.AiVoiceBotConfig = {
  workerUrl: "https://voicebot.devmohan.in",   // REQUIRED

  branding: {
    botName: "Leo",
    themeColor: "#6C5CE7",
    position: "bottom-right",                    // bottom-left | bottom-right
    greeting: "Hi, I'm Leo — here on behalf of Mohan. How can I help?",
  },

  behavior: {
    autoGreet: true,
    rememberReturning: true,
  },

  privacy: {
    consentText: "I agree to share my info for Mohan to follow up.",
    privacyPolicyUrl: "https://devmohan.in/privacy",   // optional
  },

  advanced: {
    analyticsCallback: null,        // optional fn(eventName, payload): open|message|lead|error|blocked
  },
};
```
Validated at init (`config.ts`): sensible defaults for everything except `workerUrl`; unknown
keys ignored (voice keys forward-compatible). Invalid config → clear console error, widget stays
dormant.

---

## 7. Module / build structure

```
widget/
  src/
    index.ts       # entry: read+validate config, mount into shadow root, wire orb↔panel↔client
    config.ts      # WidgetConfig type, defaults, validate()
    dom.ts         # create host element + shadow root, build orb/panel skeleton, element refs
    styles.ts      # CSS string (themeColor-interpolated), injected into the shadow root
    orb.ts         # launcher orb + idle/thinking states, open/close
    panel.ts       # message list rendering, streaming updates, input handling
    client.ts      # sendChat() + pure SSE-frame parser
    session.ts     # session_id + stored name + consent persistence (localStorage)
    consent.ts     # consent gate UI + state
    analytics.ts   # optional analyticsCallback dispatch
  tests/
    config.test.ts     # validation + defaults + dormant-on-missing-workerUrl
    client.test.ts     # SSE frame parsing (token/lead/done/error), 429-blocked, partial frames
    session.test.ts    # session_id create/persist, name store, consent persistence (mock localStorage)
  demo-embed.html      # loads dist/ai-voice-bot.min.js via <script> + a window.AiVoiceBotConfig
  build.mjs            # esbuild → dist/ai-voice-bot.min.js (IIFE, minified, target es2020)
  package.json         # scripts: build, dev (watch), test; devDeps: esbuild, typescript, vitest
  tsconfig.json
  dist/                # build output (gitignored; v0.3 publishes to npm/CDN)
```

Build: `esbuild src/index.ts --bundle --minify --format=iife --target=es2020 --outfile=dist/ai-voice-bot.min.js`.
Target bundle size < ~45 KB gzipped (NFR).

`worker/` is untouched by this slice. The old `widget/demo.html` (the raw fetch tester) is
replaced by `widget/demo-embed.html`, which loads the *built* widget the way a real host would.

---

## 8. Testing strategy

| Layer | Approach |
|-------|----------|
| Config | Vitest: defaults applied; missing `workerUrl` → dormant + console error; unknown/voice keys ignored. |
| SSE client | Vitest with an injected `fetch` returning a synthetic `ReadableStream` of SSE bytes: token/lead/done/error dispatch in order; partial frames across chunks; `429 {blocked:true}` → `onBlocked`; network error → `onError`. |
| Session/consent | Vitest with a mock `localStorage`: session_id create+reuse, name store on lead, consent persist + skip-gate-when-consented, forget-me clears all. |
| DOM/orb/panel | Manual + Playwright smoke against `demo-embed.html` pointed at a locally-running Worker (`wrangler dev`): orb opens, greeting shows, message streams, consent gate on first send, returning-visitor greeting after reload, blocked → silent. |
| Isolation | Manual: embed on a page with aggressive global CSS; confirm the widget is visually unaffected (Shadow DOM). |

Pure-logic units follow the project's inject-and-test discipline (no full-DOM dependency for
the automated suite); DOM rendering is validated by the embed demo + Playwright/manual.

---

## 9. Out of Scope (→ later slices)

- Mic / speech-to-text; text-to-speech / Groq neural voice; orb listening/speaking states → **v0.2c**.
- npm + CDN **publish**, deploy to `voicebot.devmohan.in`, embed on the live site → **v0.3**.
- Layer 2 LLM spam classifier (backend) → separate slice.

---

## 10. Risks

| # | Item | Mitigation |
|---|------|------------|
| R1 | Shadow DOM font/inheritance quirks | Set explicit base styles inside the shadow root (font-family, box-sizing, line-height); don't rely on host inheritance. |
| R2 | Streaming fetch in older browsers | `res.body` streaming is widely supported; on absence, fall back to awaiting full text then rendering once (still correct, just not incremental). |
| R3 | localStorage unavailable (privacy mode) | Guard all localStorage access; fall back to in-memory session for the page lifetime. |
| R4 | Host CSP blocks inline `<style>`/`<script>` | Widget styles live in the shadow root via a `<style>` element (not inline attributes / eval), CSP-friendly; document the `<script src>` allowance the host needs. |
| R5 | Bundle bloat | Zero deps, esbuild minify + tree-shake; verify < ~45 KB gz in CI/build. |
| R6 | Visual polish | The exact aesthetic (orb shape, animation, typography, colors beyond themeColor) is refined during implementation with the frontend-design skill; this spec fixes structure/behavior, not final pixels. |

---

*End of v0.2b specification. Next: v0.2c (voice) and v0.3 (publish + deploy).*
