# Configuration storage map

| Kind | Source | Cloudflare destination | Runtime reader |
| --- | --- | --- | --- |
| API keys | Deploy/CI env vars (`GROQ_API_KEY`, …) | Worker **secrets** | `env.*` |
| Persona, allowlist, behavior, widget public | Site config JSON (`config/example.json` shape) | KV key **`app_config`** | `mergeKvAppConfig` |
| Portfolio / knowledge text | Built from content SoT (e.g. portfolio-data) | KV key **`context`** | `getPortfolioContext` |
| Widget bootstrap on the live site | `widget` slice of config (public) | Host site static file / loader | Browser only |
| Infra (D1/KV/DO ids, routes) | `worker/wrangler.toml` | Worker bindings | Wrangler deploy |

**Never** put API keys in the config JSON, the widget, or `NEXT_PUBLIC_*` vars.

**Sync (deploy-time, privileged):**

```bash
# From ai-voice-bot/
node scripts/sync-config.mjs \
  --config ./path/to/site-config.json \
  --context ./path/to/context.txt \
  --secrets-from-env
```

Requires Wrangler auth (`wrangler login` or `CLOUDFLARE_API_TOKEN`).
