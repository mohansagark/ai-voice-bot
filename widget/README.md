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
