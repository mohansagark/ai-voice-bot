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

## Voice (v0.2c)

- **Tap-to-talk mic**: appears next to Send; disabled with a hint in browsers without `SpeechRecognition` (Safari/Firefox) — text still works.
- **Leo speaks back**: neural voice via the Worker's `/tts` (Groq `playai-tts`), falling back to the browser's `speechSynthesis`, falling back to silent (the transcript is always there).
- Leo speaks automatically when you used the mic; the 🔊/🔇 toggle in the header forces sound on/off for typed messages too.
- **One-time setup**: the Groq `playai-tts` model requires accepting its terms once in the [Groq console](https://console.groq.com) under that model. Until accepted (or without a `GROQ_API_KEY`), `/tts` returns an error and the widget automatically falls back to browser TTS — voice still works.
- Set `MAX_TTS_CHARS`/`TTS_VOICE` in `worker/wrangler.toml` `[vars]` to tune the text cap / default voice.

## Embed on a site
```html
<script>window.AiVoiceBotConfig = { workerUrl: "https://voicebot.devmohan.in", /* branding, privacy, ... */ };</script>
<script src="https://cdn.jsdelivr.net/npm/ai-voice-bot-widget@0.1.0/dist/ai-voice-bot.min.js" defer></script>
```
Pin a version (`@0.1.0`) for reproducible embeds, or drop the version for jsDelivr's latest.
Published on npm as [`ai-voice-bot-widget`](https://www.npmjs.com/package/ai-voice-bot-widget).

## Publishing (maintainer notes)
```bash
cd widget
npm login              # once, if not already
npm publish            # runs typecheck + test + build via prepublishOnly, then publishes
```
jsDelivr and unpkg mirror npm automatically — no separate CDN step needed. Bump `version` in
`package.json` (and the CDN URL above) before each publish.
