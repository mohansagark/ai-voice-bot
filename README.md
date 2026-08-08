<div align="center">

<img src="assets/leo-bot-icon.png" alt="AI Voice Bot" width="160" />

# ai-voice-bot

**A self-hosted voice + chat greeter for your website — your Worker, your keys, your knowledge.**

[![Widget](https://img.shields.io/npm/v/ai-voice-bot-widget?style=flat-square&label=widget&color=blue)](https://www.npmjs.com/package/ai-voice-bot-widget)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Runtime](https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020?style=flat-square)](https://workers.cloudflare.com/)
[![Node](https://img.shields.io/badge/node-18%2B-blue?style=flat-square)](#requirements)
[![Keys in browser](https://img.shields.io/badge/API%20keys-Worker%20secrets%20only-brightgreen?style=flat-square)](#security-model)

---

*Drop in a Shadow-DOM widget. Visitors chat or tap-to-talk with an assistant that actually knows your resume — without a shared black-box backend.*

</div>

---

## Why ai-voice-bot?

Most “chat on my site” options force a trade-off:

- **Hosted bots** that own your keys, leads, and knowledge
- **DIY LLM demos** that put secrets in the browser or skip CORS / abuse guards
- **Heavy stacks** (vector DBs, always-on servers) for a greeter that should cost nearly nothing

ai-voice-bot is the opposite path: a **Cloudflare Worker you deploy**, a **KV sync for persona + knowledge**, and a **~5.5 KB gzipped** widget. Free Workers tier is enough for typical portfolio traffic.

**Fully yours.** Your API keys, your origin allowlist, your leads, your knowledge. No multi-tenant SaaS in the middle.

---

## Quick start

Get the bot on your site in four steps. You need a free [Cloudflare](https://dash.cloudflare.com) account and a free [Groq](https://console.groq.com) API key.

### 1. Deploy the backend (once)

```bash
git clone https://github.com/mohansagark/ai-voice-bot.git
cd ai-voice-bot/worker
npm install
npx wrangler login

npx wrangler d1 create ai-voice-bot-db
npx wrangler kv namespace create PORTFOLIO_KV
# paste the two IDs into wrangler.toml (replace the sample values)

npx wrangler deploy
npx wrangler secret put GROQ_API_KEY
```

Save the Worker URL wrangler prints (something like `https://ai-voice-bot.your-name.workers.dev`).  
Your Groq key lives in Cloudflare — the Worker uses it automatically after this. You never put it on your website.

<details>
<summary>Optional extras</summary>

- For neural voice: accept [Orpheus terms](https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english) in Groq once.
- Lead email/webhook: `wrangler secret put` for `WEBHOOK_URL` or `RESEND_API_KEY` / `LEAD_NOTIFY_FROM` / `LEAD_NOTIFY_TO`.
- Full `wrangler.toml` reference: [Config sync](#config-sync).

</details>

### 2. Tell the bot who you are

```bash
cd ..
cp config/site-config.template.json ./mysite-config.json
cp config/context.template.txt ./mysite-context.txt
```

Edit those two files:

| File | Fill in |
|------|---------|
| `mysite-config.json` | Your site URL(s) under `allowedOrigins` (e.g. `https://yoursite.com`), your name/role, bot name, greeting, and a few facts |
| `mysite-context.txt` | Plain-text resume: projects, jobs, skills — whatever visitors should be able to ask about |

`allowedOrigins` must match your live site exactly (`https://…` only — no `/` at the end).

Then push both to Cloudflare:

```bash
node scripts/sync-config.mjs \
  --config ./mysite-config.json \
  --context ./mysite-context.txt
```

Change your bio or projects later? Edit the files and run the same command again — no redeploy.

### 3. Add two tags to your site

Paste this before `</body>` (or load it from your app). Replace the Worker URL and greeting:

```html
<script>
  window.AiVoiceBotConfig = {
    workerUrl: "https://YOUR_WORKER_URL",
    branding: {
      botName: "Leo",
      greeting: "Hi! Ask me about their work or how to get in touch."
    },
    voice: { enabled: true, speakByDefault: false }
  };
</script>
<script
  src="https://cdn.jsdelivr.net/npm/ai-voice-bot-widget@0.1.0/dist/ai-voice-bot.min.js"
  defer
></script>
```

That’s the plug-and-play part: public URL + name + greeting. No API keys on the page.

### 4. Check it works

1. Open `https://YOUR_WORKER_URL/health` — you want `"config":"kv"` and `"origins"` greater than `0`.
2. Open your site — the chat bubble should appear.
3. Send a message about a project from your context file.

Stuck? See [Troubleshooting](#troubleshooting). React / Next.js notes: [`widget/README.md`](widget/README.md).

---

## Features

### Streaming chat

LangGraph agent over SSE with session memory in Durable Objects. Grounded on persona facts plus an optional long-form knowledge blob.

### Voice in / voice out

Tap-to-talk via browser `SpeechRecognition`, neural TTS via Groq, browser TTS fallback when neural is unavailable.

### Fail-closed CORS

Only origins you sync are allowed. Empty or missing allowlist **denies everyone** in production — no accidental open proxy.

### Lead capture

Agent tool + optional webhook / Resend email. Leads land in your D1, not a third-party CRM by default.

### Shadow DOM widget

Isolated styles, public config only (`workerUrl` + branding). Never ship LLM keys to the page.

### Honest ops

`GET /health` reports `bootstrap` vs `kv` so you know whether sync actually ran.

---

## Architecture

```text
your-site/
└── <script> AiVoiceBotConfig.workerUrl = "https://voicebot.example.com"
         │
         ▼
Cloudflare Worker (yours)
├── secrets     GROQ_API_KEY, optional TTS / email keys
├── KV          app_config  → persona, origins, behavior
│               context     → knowledge blob
├── DO          session memory
└── D1          leads
```

| Piece | Path |
|-------|------|
| Worker | [`worker/`](worker/) |
| Widget (npm) | [`widget/`](widget/) · [`ai-voice-bot-widget`](https://www.npmjs.com/package/ai-voice-bot-widget) |
| Sync CLI | [`scripts/sync-config.mjs`](scripts/sync-config.mjs) |
| Templates | [`config/`](config/) |
| Schema / storage map | [`config/schema.json`](config/schema.json) · [`config/STORAGE.md`](config/STORAGE.md) |

**Stack:** Cloudflare Workers + Durable Objects + KV + D1 · LangGraph.js · Groq (OpenAI-compatible) · optional Deepgram / OpenRouter / Resend. No Neo4j or vector DB required for the default path.

---

## Embed (reference)

Script tags live in [Quick start §3](#3-add-two-tags-to-your-site). Build from source if you prefer not to use the CDN:

```bash
cd widget && npm install && npm run build
# → widget/dist/ai-voice-bot.min.js
```

| Host | How |
|------|-----|
| Plain HTML | Two tags from Quick start §3 |
| Next.js / React | Public env for `workerUrl` + client loader — see [`widget/README.md`](widget/README.md) |
| CMS-driven sites | Build `mysite-config.json` from your CMS; sync on production deploy |

---

## Config sync

Re-sync after persona / knowledge edits (**no Worker redeploy**):

```bash
node scripts/sync-config.mjs \
  --config ./mysite-config.json \
  --context ./mysite-context.txt
```

| File | KV key | Contains |
|------|--------|----------|
| `mysite-config.json` | `app_config` | `allowedOrigins`, `persona`, `behavior`, `widget` |
| `mysite-context.txt` | `context` | Plain-text knowledge (projects, jobs, skills…) |

- Origins must be exact browser `Origin` values: `https://www.example.com` — **no path, no trailing slash**
- `mode` is a Worker env var only — not syncable (CMS cannot disable abuse guards)

<details>
<summary><strong>Minimal mysite-config.json shape</strong></summary>

```json
{
  "allowedOrigins": ["https://www.example.com", "https://example.com"],
  "persona": {
    "botName": "Leo",
    "owner": { "name": "Alex", "role": "Software Engineer" },
    "bio": "…",
    "tone": "warm, a little playful…",
    "facts": ["…"],
    "do_not": ["quote prices", "commit to dates", "schedule meetings"]
  },
  "widget": {
    "branding": {
      "botName": "Leo",
      "greeting": "Hi, I'm Leo — Alex's assistant."
    },
    "voice": { "enabled": true, "speakByDefault": false }
  }
}
```

</details>

<details>
<summary><strong>wrangler.toml skeleton</strong></summary>

```toml
name = "ai-voice-bot"
main = "src/index.ts"
compatibility_date = "2024-09-01"
compatibility_flags = ["nodejs_compat"]

# Optional:
# routes = [{ pattern = "voicebot.example.com", custom_domain = true }]

[[d1_databases]]
binding = "DB"
database_name = "ai-voice-bot-db"
database_id = "YOUR_D1_DATABASE_ID"

[[kv_namespaces]]
binding = "PORTFOLIO_KV"
id = "YOUR_KV_NAMESPACE_ID"

[vars]
DEFAULT_PROVIDER = "groq"
MAX_MESSAGE_CHARS = "2000"
MAX_TURNS_PER_SESSION = "30"
MODE = "prod"
TTS_VOICE = "hannah"
MAX_TTS_CHARS = "1200"

[[durable_objects.bindings]]
name = "SESSION_DO"
class_name = "SessionDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["SessionDO"]
```

Do **not** commit personal persona / allowlist into `[vars]` — those sync into KV.

</details>

---

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | `config`, `origins`, provider, mode |
| `POST` | `/chat` | SSE agent replies |
| `POST` | `/tts` | Neural speech |
| `POST` | `/lead` | Direct lead capture |

---

## Requirements

- Node.js 18+
- A [Cloudflare](https://dash.cloudflare.com) account
- A [Groq](https://console.groq.com) API key (default LLM + neural TTS path)
- macOS, Linux, or Windows (local wrangler / sync)

**Local smoke test:**

```bash
cd worker
cp .dev.vars.example .dev.vars   # GROQ_API_KEY=...  MODE=dev
npm test
npm run dev                      # http://localhost:8787
```

Optional secrets: `WEBHOOK_URL`, `OPENROUTER_API_KEY`, `DEEPGRAM_API_KEY`, `RESEND_API_KEY`, `LEAD_NOTIFY_FROM`, `LEAD_NOTIFY_TO`.

---

## Security model

Built so a portfolio site never becomes an open LLM proxy:

- **No API keys in the browser** — only `workerUrl` + branding reach the page
- **Fail-closed origins** — missing/empty allowlist → `403` in prod
- **`mode` is Worker-only** — not writable via CMS / KV sync
- **Secrets stay in Wrangler** — Groq / TTS / email keys never live in the widget bundle

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `/health` → `"config":"bootstrap"` | Run `sync-config.mjs` |
| `origin not allowed` / widget hiccup | Add exact origin; re-sync |
| No neural voice | Accept [Orpheus terms](https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english) on Groq |
| Works in `wrangler dev` only | You probably have `MODE=dev` locally — sync KV for prod |

---

## Contributing

```bash
git clone https://github.com/mohansagark/ai-voice-bot.git
cd ai-voice-bot
cd worker && npm test    # tsc --noEmit + vitest
cd ../widget && npm test
```

Design notes live under `docs/superpowers/`. PRs welcome.

---

## License

[MIT](LICENSE) © [Mohansagar Killamsetty](https://github.com/mohansagark)
