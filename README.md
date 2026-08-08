# AI Voice Bot

Self-hosted agentic chat + voice greeter for any website.

- **Worker** (Cloudflare) — LangGraph agent, SSE chat, TTS, sessions, lead capture  
- **Widget** — zero-dependency, Shadow DOM embed (~5.5 KB gzipped)  
- **Config** — your persona / allowlist / knowledge synced into Workers KV at deploy time  

There is **no shared hosted backend**. You deploy your own Worker, keep your own API keys, and embed the widget on your site.

| Layer | What you put there | Never put here |
| --- | --- | --- |
| Cloudflare **secrets** | `GROQ_API_KEY`, optional TTS/email keys | — |
| Cloudflare **KV** | `app_config` + `context` (via sync) | API keys |
| Browser / widget | `workerUrl` + public branding | API keys |

Schema and storage details: [`config/STORAGE.md`](config/STORAGE.md) · [`config/schema.json`](config/schema.json)

---

## Architecture

```text
Your site (HTML / React / Next.js / …)
   │  public: workerUrl + widget branding
   ▼
Your Cloudflare Worker
   │  secrets → LLM / TTS
   │  KV app_config → persona, allowedOrigins, behavior
   │  KV context → knowledge blob
   ▼
Visitor chat / voice
```

**Fail-closed origins:** until `app_config` is synced with a non-empty `allowedOrigins`, production browser calls get `403`. Locally use `MODE=dev` in `.dev.vars`.

---

## Prerequisites

- [Cloudflare](https://dash.cloudflare.com) account (Workers Free is enough for typical portfolio traffic)
- Node.js 18+
- [Groq API key](https://console.groq.com) (chat + optional neural TTS)
- Optional: [Formspree](https://formspree.io) / webhook URL for leads  
- Optional: [Resend](https://resend.com) for lead email notifications  
- Optional: custom domain on Cloudflare DNS  

---

## 1. Clone and install

```bash
git clone https://github.com/mohansagark/ai-voice-bot.git
cd ai-voice-bot/worker
npm install
```

---

## 2. Create Cloudflare resources

From `worker/` (after `npx wrangler login`):

```bash
npx wrangler login

# D1 (leads)
npx wrangler d1 create ai-voice-bot-db

# KV (app_config + context)
npx wrangler kv namespace create PORTFOLIO_KV
```

Copy the printed `database_id` and KV `id` into `worker/wrangler.toml`:

```toml
name = "ai-voice-bot"
main = "src/index.ts"
compatibility_date = "2024-09-01"
compatibility_flags = ["nodejs_compat"]

# Optional custom domain (DNS must be on Cloudflare):
# routes = [
#   { pattern = "voicebot.example.com", custom_domain = true }
# ]

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

**Do not** commit personal `PERSONA_JSON` or `ALLOWED_ORIGINS` into `[vars]`. Those belong in the synced site config (next section).

Apply D1 migrations if your checkout includes SQL migrations under `worker/` (see repo `worker/` docs / `migrations` folder if present).

---

## 3. Local development

```bash
cd worker
cp .dev.vars.example .dev.vars
```

Minimum `.dev.vars`:

```bash
GROQ_API_KEY=gsk_...
MODE=dev
# Optional:
# WEBHOOK_URL=https://formspree.io/f/xxxx
# DEEPGRAM_API_KEY=...
# OPENROUTER_API_KEY=...
# RESEND_API_KEY=...
# LEAD_NOTIFY_FROM=Leo <bot@example.com>
# LEAD_NOTIFY_TO=you@example.com
```

```bash
npm test          # includes tsc --noEmit + vitest
npm run dev       # http://localhost:8787
curl -s http://localhost:8787/health
```

With `MODE=dev`, origin / spam / length guards are relaxed for local testing.

**Widget locally:**

```bash
cd ../widget
npm install
npm run build
# open demo-embed.html (point workerUrl at http://localhost:8787)
```

---

## 4. Production site config (template)

Copy the production templates and edit them for your brand:

```bash
cp config/site-config.template.json ./mysite-config.json
cp config/context.template.txt ./mysite-context.txt
```

### `mysite-config.json` (→ KV `app_config`)

| Field | Required | Notes |
| --- | --- | --- |
| `allowedOrigins` | **Yes** | Exact browser origins, e.g. `https://www.example.com` — **no path, no trailing slash** |
| `persona` | **Yes** | `botName`, `owner`, `bio`, `tone`, `facts[]`, `do_not[]` |
| `behavior` | Optional | Caps, TTS voice, provider — **not** `mode` (mode stays a Worker env var) |
| `widget` | Optional | Public branding / greeting / voice UX for your site loader |

Full JSON Schema: [`config/schema.json`](config/schema.json)  
Example: [`config/example.json`](config/example.json) · Template: [`config/site-config.template.json`](config/site-config.template.json)

### `mysite-context.txt` (→ KV `context`)

Plain-text knowledge the model uses for specifics (projects, jobs, skills). Keep it factual. Template: [`config/context.template.txt`](config/context.template.txt)

---

## 5. Deploy Worker + secrets + sync

**Order matters on first deploy:**

1. Deploy the Worker (bindings must exist)  
2. Put secrets  
3. Sync KV (`app_config` + `context`)  
4. Confirm `/health` shows `"config":"kv"`  

```bash
cd worker
npx wrangler deploy

# Secrets (prompted interactively — or pipe from a secure env)
npx wrangler secret put GROQ_API_KEY
# npx wrangler secret put WEBHOOK_URL
# npx wrangler secret put OPENROUTER_API_KEY
# npx wrangler secret put DEEPGRAM_API_KEY
# npx wrangler secret put RESEND_API_KEY
# npx wrangler secret put LEAD_NOTIFY_FROM
# npx wrangler secret put LEAD_NOTIFY_TO

cd ..
export GROQ_API_KEY=...   # only if using --secrets-from-env
node scripts/sync-config.mjs \
  --config ./mysite-config.json \
  --context ./mysite-context.txt \
  --secrets-from-env
```

`sync-config.mjs` upserts KV and, with `--secrets-from-env`, any of these if present in the environment:  
`GROQ_API_KEY`, `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `LEAD_NOTIFY_FROM`, `LEAD_NOTIFY_TO`, `WEBHOOK_URL`.

Auth: `wrangler login` **or** `CLOUDFLARE_API_TOKEN` (Workers KV Edit).

### Verify

```bash
curl -s https://YOUR_WORKER_URL/health | jq .
# Expect: "config": "kv", "origins": <n>, "mode": "prod", "ok": true

curl -sN -X POST https://YOUR_WORKER_URL/chat \
  -H 'Origin: https://www.example.com' \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"smoke-1","message":"Hi","history":[]}'
# Expect: HTTP 200 + SSE token events
```

If you see `"config":"bootstrap"` or `origins: 0`, sync did not land — chat from browsers will 403.

---

## 6. Embed the widget

**Never** put API keys in the page.

### HTML

```html
<script>
  window.AiVoiceBotConfig = {
    workerUrl: "https://YOUR_WORKER_URL",
    branding: {
      botName: "Leo",
      greeting: "Hi, I'm Leo — how can I help?"
    },
    voice: { enabled: true, speakByDefault: false }
  };
</script>
<script
  src="https://cdn.jsdelivr.net/npm/ai-voice-bot-widget@0.1.0/dist/ai-voice-bot.min.js"
  defer
></script>
```

Or serve `widget/dist/ai-voice-bot.min.js` from your own origin after `npm run build` in `widget/`.

### React / Next.js

Set only a **public** Worker URL in the host env, e.g. `NEXT_PUBLIC_LEO_WORKER_URL`.  
Load branding from your CMS/static JSON if you want — still public-only.

More embed options: [`widget/README.md`](widget/README.md)

---

## 7. Updating config in production

Edit `mysite-config.json` / `mysite-context.txt`, then re-run:

```bash
node scripts/sync-config.mjs \
  --config ./mysite-config.json \
  --context ./mysite-context.txt
```

No Worker redeploy needed for persona / origins / knowledge changes.  
Redeploy the Worker only when **code** or **wrangler bindings/vars** change.

Optional automation: run the same sync from CI on your content repo’s deploy (pass `CLOUDFLARE_API_TOKEN`). That is integration glue for *your* site — not required to use this package.

---

## Configuration reference

### Worker secrets

| Secret | Required | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes | Chat (+ neural TTS if enabled) |
| `OPENROUTER_API_KEY` | No | Chat fallback |
| `DEEPGRAM_API_KEY` | No | TTS fallback |
| `WEBHOOK_URL` | No | Lead webhook |
| `RESEND_API_KEY` | No | Lead email |
| `LEAD_NOTIFY_FROM` / `LEAD_NOTIFY_TO` | No | Lead email addresses |

### Worker `[vars]` (non-secret)

| Var | Default | Notes |
| --- | --- | --- |
| `MODE` | `prod` | `dev` relaxes guards — **env only**, not syncable from KV |
| `DEFAULT_PROVIDER` | `groq` | |
| `MAX_MESSAGE_CHARS` | `2000` | Overridable via synced `behavior` |
| `MAX_TURNS_PER_SESSION` | `30` | |
| `TTS_VOICE` / `MAX_TTS_CHARS` | `hannah` / `1200` | |

### Neural TTS

Accept Groq model terms once:  
[canopylabs/orpheus-v1-english](https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english)  
Otherwise the widget falls back to browser `speechSynthesis`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `/health` → `"config":"bootstrap"` | KV sync never ran | Run `sync-config.mjs` |
| `{"error":"origin not allowed"}` | Origin not in `allowedOrigins` or path/slash in entry | Use exact `https://host` only; re-sync |
| Widget “hiccup” message | CORS / 403 / network | Check Origin allowlist + Worker URL |
| No spoken audio | Groq TTS terms / missing key | Accept model terms or rely on browser TTS |
| Chat works in `wrangler dev` but not prod | `MODE=dev` locally only | Sync `app_config` for prod |

---

## Repo layout

```text
ai-voice-bot/
├── config/           # schema, templates, storage map
├── scripts/          # sync-config.mjs (deploy-time)
├── worker/           # Cloudflare Worker
└── widget/           # embeddable frontend (npm: ai-voice-bot-widget)
```

Design history (optional): `docs/superpowers/`

---

## License / contributing

See repository license. PRs welcome — run `cd worker && npm test` before pushing.
