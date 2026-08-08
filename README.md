# AI Voice Bot

Leo — an agentic voice/chat greeter for a portfolio site. A LangGraph.js agent running on a
Cloudflare Worker, fronted by a zero-dependency, Shadow-DOM-isolated embeddable widget with
tap-to-talk voice input and neural voice replies.

See `docs/superpowers/specs/` for the full design docs and `docs/superpowers/plans/` for the
implementation plans (this project was built spec → plan → TDD implementation, one slice at a
time).

## What's here

- **`worker/`** — the backend: a Cloudflare Worker exposing `POST /chat` (SSE-streamed LangGraph
  agent replies, session memory via Durable Objects, spam/rate guards, lead capture) and
  `POST /tts` (Groq neural text-to-speech). See `worker/` for local dev/test commands.
- **`widget/`** — the frontend: a self-mounting, embeddable chat widget (`<script>` tag, zero
  runtime deps, ~5.5 KB gzipped) that renders inside a Shadow DOM so it can't be affected by —
  or leak into — a host page's styles. Published on npm as
  [`ai-voice-bot-widget`](https://www.npmjs.com/package/ai-voice-bot-widget). See
  [`widget/README.md`](widget/README.md) for **activating it on any website** (your own backend +
  script tag), the full config reference, and dev/build/publish instructions.

## Features by version

| Version | What it adds |
|---|---|
| v0.1 | The agent + backend: streaming chat, session memory, spam/rate guards, lead capture to a webhook. |
| v0.2a | Backend streaming + memory hardening (dev/prod mode switch, operational guards). |
| v0.2b | The embeddable widget: Shadow DOM shell, orb + chat panel, SSE streaming client, consent gate, session/name persistence. |
| v0.2c | **Voice**: tap-to-talk mic (browser `SpeechRecognition`) and spoken replies (Groq neural TTS → browser `speechSynthesis` → silent fallback), with a mute toggle and calm, opt-in voice UX. |
| v0.2d | **Widget redesign**: dark Card & Avatar UI, bot-glyph orb/avatar, gradient theming (`themeColorSecondary`), typing indicator, message entrance animation, timestamps, scroll-pinned smooth auto-scroll. |
| v0.3 (in progress) | npm/CDN publish (done — [`ai-voice-bot-widget`](https://www.npmjs.com/package/ai-voice-bot-widget)) + deploy to `voicebot.devmohan.in` (done) + embed on `devmohan.in`. |

## Quickstart

**1. Run the backend:**
```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # add your free GROQ_API_KEY and a WEBHOOK_URL
npm test                         # unit + integration tests (offline, fake model)
npm run dev                      # wrangler dev on http://localhost:8787
```
Add `MODE=dev` to `worker/.dev.vars` to bypass the origin/rate/spam guards while testing locally.
Get a free Groq key at [console.groq.com](https://console.groq.com); a free lead webhook at
[formspree.io](https://formspree.io). To hear Leo's neural voice, also accept the
`canopylabs/orpheus-v1-english` model's terms once in the
[Groq console](https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english)
(see [`widget/README.md`](widget/README.md#configuration-reference) —
without it, `/tts` fails gracefully and the widget falls back to browser text-to-speech).

**2. Build and open the widget:**
```bash
cd widget
npm install
npm test           # unit tests (config, SSE client, session, voice, DOM via happy-dom)
npm run build      # -> dist/ai-voice-bot.min.js
```
Open `widget/demo-embed.html` in a browser (with the Worker running from step 1) to chat with
Leo — type or tap the mic — and prove the widget survives the demo page's deliberately hostile
CSS via Shadow DOM isolation.

Set application config (persona, allowlist, knowledge) via deploy-time sync — see
[`config/STORAGE.md`](config/STORAGE.md). Do not commit personal site data into
`worker/wrangler.toml`.

```bash
# Example: sync a site config + knowledge blob (requires wrangler auth)
node scripts/sync-config.mjs \
  --config ./config/example.json \
  --context ./path/to/context.txt \
  --secrets-from-env
```

For local Worker testing, leave allowlist empty or set `MODE=dev` in `worker/.dev.vars`
(bypasses origin/rate/spam guards). API keys go in `.dev.vars`, never in the widget.
