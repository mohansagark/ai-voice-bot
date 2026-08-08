# Configuration storage map

> **Installer guide:** see the root [README.md](../README.md) for the full self-host setup.  
> This file is the storage contract + failure semantics reference.

| Kind | Source | Cloudflare destination | Runtime reader |
| --- | --- | --- | --- |
| API keys | Deploy/CI env vars (`GROQ_API_KEY`, …) | Worker **secrets** | `env.*` |
| Persona, allowlist, behavior, widget public | Site config JSON ([`site-config.template.json`](./site-config.template.json)) | KV key **`app_config`** | `mergeKvAppConfig` |
| Portfolio / knowledge text | Plain text / CMS export | KV key **`context`** | `getPortfolioContext` |
| Widget bootstrap on the live site | `widget` slice of config (public) | Host site static file / loader | Browser only |
| Infra (D1/KV/DO ids, routes) | `worker/wrangler.toml` | Worker bindings | Wrangler deploy |

**Never** put API keys in the config JSON, the widget, or `NEXT_PUBLIC_*` vars.

**Sync (deploy-time, privileged):**

```bash
# From ai-voice-bot/
node scripts/sync-config.mjs \
  --config ./mysite-config.json \
  --context ./mysite-context.txt \
  --secrets-from-env
```

Requires Wrangler auth (`wrangler login` or `CLOUDFLARE_API_TOKEN`).

## Failure semantics

Origin enforcement **fails closed**. An empty or missing `allowedOrigins` means *deny every
browser request*, not *allow all* — a failed sync must never silently open `/chat`, `/lead`,
and `/tts` to the internet.

Consequences worth knowing before you deploy:

- A Worker deployed before its first KV sync answers every browser request with `403`.
- With no `app_config`, the persona falls back to the generic built-in default (`defaultPersona`),
  so the bot would introduce itself as the wrong person if it could answer at all.
- `mode` is **not** readable from KV. It is the master enforcement switch (`enforce = mode === "prod"`),
  and CMS-authored content must never be able to disable the origin allowlist, spam detection,
  the turn cap, or the message-length cap.

`GET /health` is the diagnostic:

```json
{
  "ok": true,
  "config": "kv",
  "origins": 2,
  "mode": "prod"
}
```

`"config": "kv"` with a non-zero `origins` is the healthy state. `"config": "bootstrap"` in prod
means the sync never ran (chat from browsers will 403).

## Example: multi-repo CMS integration

If your content SoT is a separate CMS repo and your marketing site deploys on Vercel (or similar),
a working pattern is:

1. Publish site config / knowledge from the CMS (or build it in CI).
2. On **production** site deploy, run the same sync (`app_config` + `context` → KV) with
   `CLOUDFLARE_API_TOKEN`.
3. Deploy Worker code only when the Worker changes; config sync does not require a Worker redeploy.

Gate sync to production deploys so preview builds cannot overwrite live KV.
