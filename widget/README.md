# ai-voice-bot-widget

An embeddable chat + voice widget — tap-to-talk mic, neural voice replies, Shadow-DOM isolated so
it can't be affected by (or leak into) your site's CSS. Zero runtime dependencies, ~5.5 KB gzipped.

This README is a complete guide to activating the widget on **your own site**, plus notes for
anyone building/maintaining this package.

## How it works (read this first)

The widget is just the frontend — a floating orb + chat panel. It talks to a small backend (a
Cloudflare Worker) that runs the actual chat agent and text-to-speech. **There is no shared/hosted
backend** — to use this widget you deploy your own Worker (free Cloudflare plan is enough), point
the widget at it, and it's yours: your own API keys, your own conversation data, your own rate
limits.

So activating this on a new site is two steps:
1. **Deploy your own Worker backend** (one-time, ~10 minutes).
2. **Add the widget's script tag** to your site, pointed at that Worker.

---

## Step 1 — Deploy your own backend

The backend lives in [`worker/`](../worker) in the [source repo](https://github.com/mohansagark/ai-voice-bot).

```bash
git clone https://github.com/mohansagark/ai-voice-bot.git
cd ai-voice-bot/worker
npm install
```

You need:
- A free [Cloudflare](https://dash.cloudflare.com) account (for `wrangler`, the Workers CLI).
- A free **Groq API key** from [console.groq.com](https://console.groq.com) (powers the chat model
  and, optionally, neural text-to-speech via the `playai-tts` model — accept that model's terms
  once in the Groq console, or voice replies fall back to the browser's built-in TTS).
- A **lead webhook URL** to receive contact-form-style leads the agent captures — a free one from
  [formspree.io](https://formspree.io) works, or point it at your own endpoint (Zapier, a Worker,
  whatever accepts a `POST` with JSON).

**Local test first:**
```bash
cp .dev.vars.example .dev.vars   # fill in GROQ_API_KEY and WEBHOOK_URL
npm test                         # offline unit + integration tests
npm run dev                      # wrangler dev -> http://localhost:8787
```

**Deploy to Cloudflare:**
```bash
npx wrangler login
npx wrangler deploy
```
This creates the Worker on your account (default URL like `https://ai-voice-bot.<you>.workers.dev`).

**Set production secrets** (separate from `.dev.vars`, which is local-only):
```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put WEBHOOK_URL
```
Run these in a real terminal (not a piped/non-interactive shell) — they prompt for the value.

**Lock it down to your site(s)** — edit `worker/wrangler.toml`:
```toml
[vars]
ALLOWED_ORIGINS = "https://yoursite.com,https://www.yoursite.com"
```
Leave empty during local development to allow all origins, or set `MODE=dev` in `.dev.vars` to
bypass origin/rate/spam guards while testing. Redeploy after changing config: `npx wrangler deploy`.

**Optional — custom domain** (e.g. `voicebot.yoursite.com` instead of the default `workers.dev`
URL) — add to `wrangler.toml`:
```toml
routes = [
  { pattern = "voicebot.yoursite.com", custom_domain = true }
]
```
Requires `yoursite.com`'s DNS to already be on Cloudflare. Redeploy and Cloudflare provisions the
domain + TLS automatically.

---

## Step 2 — Add the widget to your site

### Plain HTML
```html
<script>
  window.AiVoiceBotConfig = {
    workerUrl: "https://your-worker-url.workers.dev", // or your custom domain
  };
</script>
<script src="https://cdn.jsdelivr.net/npm/ai-voice-bot-widget@0.1.0/dist/ai-voice-bot.min.js" defer></script>
```
Place both tags before `</body>`. That's the minimum needed — everything else has sane defaults.
Pin the version (`@0.1.0`) for reproducible embeds, or drop it for jsDelivr's `latest`.

### React / Next.js (App Router)
```jsx
// in your root layout
import Script from "next/script";

<Script id="ai-voice-bot-config" strategy="afterInteractive">
  {`window.AiVoiceBotConfig = { workerUrl: "https://your-worker-url.workers.dev" };`}
</Script>
<Script
  src="https://cdn.jsdelivr.net/npm/ai-voice-bot-widget@0.1.0/dist/ai-voice-bot.min.js"
  strategy="afterInteractive"
/>
```

### Vue / any SPA
Add the same two `<script>` tags to your `index.html` (the one Vite/Webpack serves as the shell) —
same as the plain HTML case above. The widget self-mounts on load; no framework integration needed.

### Via npm (instead of the CDN tag)
```bash
npm install ai-voice-bot-widget
```
```js
import "ai-voice-bot-widget"; // side-effect import; still reads window.AiVoiceBotConfig
```
Set `window.AiVoiceBotConfig` before this import runs.

---

## Configuration reference

Everything except `workerUrl` is optional and falls back to the defaults shown.

```js
window.AiVoiceBotConfig = {
  workerUrl: "https://your-worker-url.workers.dev", // required, no default

  branding: {
    botName: "Leo",                                  // default: "Leo"
    themeColor: "#6C5CE7",                            // default: "#6C5CE7"
    position: "bottom-right",                         // "bottom-right" | "bottom-left"
    greeting: "Hi, I'm Leo — how can I help?",        // first-open message
  },

  behavior: {
    autoGreet: true,          // show the greeting automatically on first open
    rememberReturning: true,  // persist visitor's name locally, greet by name next visit
    language: "en-US",        // BCP-47 tag for speech recognition + TTS
  },

  privacy: {
    consentText: "I agree to share my info so I can be followed up with.",
    privacyPolicyUrl: null,   // set a URL to link it from the consent gate
  },

  voice: {
    enabled: true,            // set false to disable mic + spoken replies entirely
    ttsVoice: "Fritz-PlayAI", // must match a voice your Worker's TTS_VOICE/backend supports
    speakByDefault: false,    // if true, Leo speaks replies to typed messages too, not just voice ones
  },

  advanced: {
    analyticsCallback: (event, payload) => {},
    // event: "open" | "message" | "lead" | "error" | "blocked"
  },
};
```

**Consent gate**: the widget never sends a message to your backend until the visitor accepts the
`privacy.consentText` prompt once (persisted locally after that).

**Voice**: tap-to-talk mic uses the browser's native `SpeechRecognition` — unsupported in Safari
and Firefox, where the mic button is disabled with a tooltip and text chat still works fully.
Spoken replies try your Worker's neural TTS first, fall back to the browser's `speechSynthesis`,
then fall back to silent (the text reply is always shown regardless).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `{"error":"origin not allowed"}` in the console/network tab | Your site's origin isn't in the Worker's `ALLOWED_ORIGINS` | Add it in `worker/wrangler.toml` and redeploy, or set `MODE=dev` for local testing |
| Widget doesn't appear at all | `window.AiVoiceBotConfig` missing/typo'd, or set *after* the widget script ran | Check the browser console for a `[ai-voice-bot]` error; make sure the config `<script>` runs before the widget `<script>` |
| Mic button greyed out | Browser doesn't support `SpeechRecognition` (Safari/Firefox), or `voice.enabled: false` | Expected in unsupported browsers — text still works. Check config if unintended |
| No spoken reply, but text appears fine | `/tts` errored (missing/unaccepted Groq `playai-tts` terms) and browser TTS is also unavailable | Widget falls back silently by design — accept the model's terms in the Groq console, or ignore if browser TTS is acceptable |
| Widget styling looks broken on host page | Shouldn't happen — it renders in a Shadow DOM | File an issue with a repro; this would be a widget bug |

---

## Browser support

Chat (typing) works everywhere. Voice input requires `SpeechRecognition` (Chrome, Edge, and
Chromium-based browsers on desktop/Android); Safari and Firefox get text-only with the mic
disabled. Spoken replies work anywhere with either the Worker's neural TTS or `speechSynthesis`.

---

## Development / contributing

```bash
git clone https://github.com/mohansagark/ai-voice-bot.git
cd ai-voice-bot/widget
npm install
npm test           # unit tests (config, SSE client, session, voice, DOM via happy-dom)
npm run typecheck
npm run build      # -> dist/ai-voice-bot.min.js
```

**Local smoke test against your own Worker:**
1. `cd ../worker && npm run dev` (http://localhost:8787), with `MODE=dev` in `.dev.vars` to bypass
   guards.
2. `cd widget && npm run build`
3. Open `widget/demo-embed.html` in a browser — it points at `localhost:8787` and includes
   deliberately hostile host CSS to prove Shadow DOM isolation holds.

**Publishing** (maintainers only):
```bash
npm login              # once, if not already
npm publish            # runs typecheck + test + build via prepublishOnly, then publishes
```
jsDelivr and unpkg mirror npm automatically — no separate CDN step. Bump `version` in
`package.json` (and any version-pinned docs) before each publish.

## License

MIT — see [LICENSE](./LICENSE).
