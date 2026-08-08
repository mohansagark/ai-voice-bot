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

This is the end-to-end path to put the bot on **your** portfolio or project site.

**Order matters:** procure keys → deploy Worker → add secrets → write config + knowledge → sync KV → verify `/health` → embed the widget. Until KV sync succeeds, production chat **fails closed** (`403`).

### 1. Accounts and keys to procure

| What | Where | Required? | Where it goes |
|------|-------|-----------|---------------|
| Cloudflare account | [dash.cloudflare.com](https://dash.cloudflare.com) | **Yes** | Hosts the Worker, KV, D1, Durable Objects |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) | **Yes** | Worker **secret** (LLM + neural TTS) |
| Orpheus TTS terms | [Groq Orpheus playground](https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english) | For neural voice | Accept once in the Groq console |
| `WEBHOOK_URL` | Formspree / Zapier / your hook | Optional | Worker secret — lead ping |
| `RESEND_API_KEY` + `LEAD_NOTIFY_FROM` + `LEAD_NOTIFY_TO` | [resend.com](https://resend.com) | Optional | Worker secrets — email on new lead |
| `OPENROUTER_API_KEY` / `DEEPGRAM_API_KEY` | Vendor consoles | Optional | Worker secrets — alternate providers |

**Never** put any of these in the browser, `NEXT_PUBLIC_*`, or the site config JSON. Only the Worker holds secrets.

### 2. Clone and create Cloudflare bindings

```bash
git clone https://github.com/mohansagark/ai-voice-bot.git
cd ai-voice-bot/worker
npm install
npx wrangler login

npx wrangler d1 create ai-voice-bot-db
npx wrangler kv namespace create PORTFOLIO_KV
```

Paste the printed `database_id` and KV `id` into `worker/wrangler.toml` (see [wrangler.toml skeleton](#config-sync)). Comment out or replace any sample `routes` / custom domain with yours (or omit routes to use the default `*.workers.dev` URL).

### 3. Deploy the Worker and add secrets

```bash
npx wrangler deploy
# note the URL, e.g. https://ai-voice-bot.<your-subdomain>.workers.dev

npx wrangler secret put GROQ_API_KEY
# optional:
# npx wrangler secret put WEBHOOK_URL
# npx wrangler secret put RESEND_API_KEY
# npx wrangler secret put LEAD_NOTIFY_FROM
# npx wrangler secret put LEAD_NOTIFY_TO
```

Confirm `MODE = "prod"` in `wrangler.toml` for live traffic (local `wrangler dev` uses `.dev.vars` with `MODE=dev`).

### 4. Write your site config (persona + allowlist + widget)

```bash
cd ..   # back to ai-voice-bot/
cp config/site-config.template.json ./mysite-config.json
```

Edit `mysite-config.json`. The fields that matter for a portfolio:

| Field | What to put |
|-------|-------------|
| `allowedOrigins` | Exact browser origins that may call the Worker — e.g. `https://www.yoursite.com`, `https://yoursite.com`. **HTTPS + host only** — no path, no trailing slash |
| `persona.botName` | Display name of the assistant (e.g. `Leo`) |
| `persona.owner.name` / `owner.role` | Your name and role |
| `persona.bio` | Short owner bio the agent grounds on |
| `persona.tone` | How it should sound |
| `persona.facts` | Bullet facts visitors can ask about |
| `persona.do_not` | Hard refusals (prices, dates, scheduling, …) |
| `behavior.*` | Caps / TTS voice (safe to keep template defaults) |
| `widget.branding.botName` / `greeting` | What the floating widget shows before chat starts |
| `widget.voice.enabled` | `true` to enable tap-to-talk + speak replies |

This JSON is **not** committed into `[vars]` in wrangler — it syncs into KV as `app_config`.

### 5. Write the knowledge blob

```bash
cp config/context.template.txt ./mysite-context.txt
```

Fill `mysite-context.txt` with resume-style plain text: profile, experience, projects, skills, FAQs. This syncs to KV as `context` and is what makes answers specific to **you**.

### 6. Sync config + knowledge into KV

```bash
node scripts/sync-config.mjs \
  --config ./mysite-config.json \
  --context ./mysite-context.txt
```

Requires Wrangler auth (`wrangler login` or `CLOUDFLARE_API_TOKEN`). Re-run this whenever you change persona, origins, or knowledge — **no Worker redeploy needed**.

### 7. Verify the Worker is ready

```bash
curl -s https://YOUR_WORKER_URL/health
```

Healthy production response looks like:

```json
{ "ok": true, "config": "kv", "origins": 2, "mode": "prod" }
```

| Field | Meaning |
|-------|---------|
| `"config": "kv"` | Sync ran — persona/allowlist loaded from KV |
| `"origins": N` | `N > 0` — at least one origin allowed |
| `"config": "bootstrap"` | Sync never ran — browser chat will `403` |

### 8. Initiate the bot on your portfolio

On every page where the widget should appear, load **public** config first, then the script. No API keys here:

```html
<script>
  window.AiVoiceBotConfig = {
    workerUrl: "https://YOUR_WORKER_URL",
    branding: {
      botName: "Leo",
      greeting: "Hi, I'm Leo — ask me about their work or how to get in touch."
    },
    voice: {
      enabled: true,
      speakByDefault: false
    }
  };
</script>
<script
  src="https://cdn.jsdelivr.net/npm/ai-voice-bot-widget@0.1.0/dist/ai-voice-bot.min.js"
  defer
></script>
```

| Tag / field | Purpose |
|-------------|---------|
| `workerUrl` | **Required.** Your deployed Worker origin (same host you curled for `/health`) |
| `branding.botName` | Label in the widget chrome |
| `branding.greeting` | First message visitors see |
| `voice.enabled` | Show mic / allow spoken replies |
| `voice.speakByDefault` | Auto-speak agent replies (`false` is usually better on portfolios) |

**Checklist before you call it done**

1. Site origin is listed in `allowedOrigins` (exact match to the browser `Origin`)
2. `/health` shows `"config":"kv"` and `"origins"` > 0
3. Page loads `AiVoiceBotConfig` **before** the widget script
4. Open the site → widget appears → send a chat → get a grounded reply

**Next.js / React:** put `workerUrl` in a public env (e.g. `NEXT_PUBLIC_VOICE_BOT_WORKER_URL`) and load the script from a client component — see [`widget/README.md`](widget/README.md). Keep Groq / Cloudflare tokens on the Worker or CI only.

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

Full initiation steps are in [Quick start §8](#8-initiate-the-bot-on-your-portfolio). Build the widget from source if you prefer not to use the CDN:

```bash
cd widget && npm install && npm run build
# → widget/dist/ai-voice-bot.min.js
```

| Host | How |
|------|-----|
| Plain HTML | `AiVoiceBotConfig` + script tag (Quick start §8) |
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
