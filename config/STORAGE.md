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
{ "ok": false, "config": "bootstrap", "origins": 0,
  "warning": "running on bootstrap config — run the deploy-time KV sync, see config/STORAGE.md" }
```

`"config": "kv"` with a non-zero `origins` is the healthy state. `"config": "bootstrap"` in prod
means the sync never ran.

## First-deploy / rollout order

The three repos have a hard ordering dependency. Both wrong orders break production: deploying
the Worker first leaves it 403-ing on bootstrap config, and merging the portfolio before the
content SoT is published makes its `prebuild` exit non-zero, which fails the whole Vercel deploy.

1. Merge and deploy the content SoT (`portfolio-data`). Confirm the file is actually served:
   ```bash
   curl -fsI https://admin.devmohan.in/data/chatbot.json
   ```
2. Set `CLOUDFLARE_API_TOKEN` on the portfolio's Vercel project (Workers KV Edit, scoped to this
   namespace only).
3. Merge the portfolio (`next-gen-portfolio`). Its `prebuild` runs `sync:leo`; the build log must
   show `→ KV put app_config` and `→ KV put context`.
4. Verify KV directly before touching the Worker:
   ```bash
   npx wrangler kv key get app_config --namespace-id 0ac98a2a6f5f428aafa4dd9e1d3f2feb --remote
   ```
5. Only now deploy the Worker (`ai-voice-bot`), then confirm `GET /health` reports
   `"config":"kv"` with a non-zero `origins`.

Steady state after the first rollout is order-independent: a CMS edit pushes to `portfolio-data`,
which fires the Vercel deploy hook, which re-runs the sync.
