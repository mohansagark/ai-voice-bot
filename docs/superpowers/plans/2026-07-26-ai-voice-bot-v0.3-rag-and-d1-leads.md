# Leo v0.3 — RAG + D1/email leads (implementation plan)

Plan for `docs/superpowers/specs/2026-07-26-ai-voice-bot-v0.3-rag-and-d1-leads-design.md`.

TDD: each slice lands with its test file written first, run red, then production code, run green.

## Slice 1 — RAG module (pure, no Worker runtime)

**1.1** `worker/tests/rag.test.ts` (new)
- `retrieve()`:
  - calls `env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [query] })`
  - calls `env.VECTORIZE.query(vec, { topK, returnMetadata: "all" })`
  - drops matches with `score <= minScore`
  - drops matches with empty `metadata.text`
  - returns `[{ text, source, score }]` capped at `topK`
  - throws a typed error if `env.AI` is missing
  - throws a typed error if `env.VECTORIZE` is missing
- `buildContext()`:
  - concatenates blocks `[Source: <source>]\n<text>` separated by `\n\n---\n\n`
  - total chars never exceeds `maxChars` (off-by-one: the last accepted block that would push over
    is dropped, not partially included)
  - returns `""` for empty matches
- `maybeAugmentSystemPrompt()`:
  - returns `base` unchanged when context is `""`
  - returns `base + "\n\n" + contextBlock` when context is non-empty, with the same instructions
    MohanBot used (cite the source naturally, fall back to general knowledge only when context is
    empty)

**1.2** `worker/src/rag.ts` (new) — implement to pass 1.1.

**1.3** `npm test -- rag` green.

## Slice 2 — Leads store + D1 schema

**2.1** `worker/schema.sql` (new) — the `leads` table exactly as in the spec.

**2.2** `worker/tests/leads-store.test.ts` (new)
- `saveLead`:
  - inserts a row with `source: "agent"`, returns void
  - inserts a row with `source: "direct"` when explicitly set
  - throws when `env.DB` is missing
  - bubbles D1 errors
- `notifyLeadByEmail`:
  - no-op when `LEAD_NOTIFY_FROM` or `LEAD_NOTIFY_TO` is unset
  - no-op when `LEAD_EMAIL` binding is absent
  - calls `LEAD_EMAIL.send` with the expected `{ from, to, subject, text, html }` shape
  - swallows `LEAD_EMAIL.send` rejection with `console.error` (does not throw)
  - email body contains the lead's name, email, and question (escaped)
- Use a minimal `D1Database` fake (interface only) + a `SendEmail` fake for the assertions.

**2.3** `worker/src/leads-store.ts` (new) — implement to pass 2.2.

**2.4** `npm test -- leads-store` green.

## Slice 3 — Config: add RAG knobs and lead env vars

**3.1** `worker/tests/config.test.ts` (extend)
- new defaults: `ragTopK=6`, `ragMinScore=0.65`, `ragMaxContextChars=6000`
- env overrides: `RAG_TOP_K`, `RAG_MIN_SCORE`, `RAG_MAX_CONTEXT_CHARS`
- new `Env` fields: `LEAD_NOTIFY_FROM?`, `LEAD_NOTIFY_TO?`, `LEAD_EMAIL?`, `AI?`, `VECTORIZE?`,
  `DB?`
- unknown RAG var types throw with a clear message

**3.2** `worker/src/config.ts` — add the fields and parsing.

**3.3** `npm test -- config` green.

## Slice 4 — `wrangler.toml` updates

```toml
[ai]
binding = "AI"

[[vectorize]]
binding = "VECTORIZE"
index_name = "portfolio-rag"

[[d1_databases]]
binding = "DB"
database_name = "ai-voice-bot-db"
database_id = "REPLACE_AFTER_D1_CREATE"

# [[send_email]]
# name = "LEAD_EMAIL"
# destination_address = "contact@devmohan.in"
```

Plus under `[vars]`:
- `RAG_TOP_K = "6"`
- `RAG_MIN_SCORE = "0.65"`
- `RAG_MAX_CONTEXT_CHARS = "6000"`

The `send_email` block stays commented (user uncomments + sets `LEAD_NOTIFY_FROM` / `LEAD_NOTIFY_TO`
secrets when they want email).

## Slice 5 — `save_lead` node: drop webhook, use persistLead

**5.1** `worker/tests/graph.test.ts` (extend)
- existing tests stay (use a `persistLead` fake in deps)
- new test: `save_lead` calls `deps.persistLead` exactly once with the parsed lead + `source: "agent"`
- new test: when `deps.persistLead` throws, the node still returns the "Lead recorded (delivery
  failed)." ToolMessage (the agent's UX should be: lead saved OR failure, not an exception)
- new test: when `leadSaved` is already true, the node does NOT call `persistLead` again

**5.2** `worker/src/agent/nodes.ts` — replace the `postLead(...)` call with `deps.persistLead(...)`.
Update `AgentDeps` to require `persistLead: (row) => Promise<void>` and drop `webhookUrl`.

**5.3** `npm test -- graph` green.

## Slice 6 — Wire RAG into the chat route

**6.1** `worker/tests/chat.test.ts` (extend)
- new test: chat route calls `retrieve` once per turn and threads the resulting context into the
  agent's input messages
- new test: when `retrieve` returns no matches, no context system message appears
- new test: when `retrieve` returns matches, a single `SystemMessage` containing the context block
  appears in the runner's input

**6.2** `worker/src/index.ts`
- inject `retrieve` via `Deps`
- before building the graph runner, `const context = buildContext(await retrieve(env, message,
  config.rag), config.rag.maxContextChars)`
- pass `context` into the LangGraph state as a new field (see slice 7)

**6.3** `worker/src/agent/state.ts`
- add `context: Annotation<string>({ reducer: (_, y) => y, default: () => "" })`

**6.4** `worker/src/agent/nodes.ts` — `agent` node
- read `state.context`, build a context system message when non-empty
- prepend it after the persona system prompt and before the `leadSaved` reminder
- existing tests stay green

**6.5** `npm test` green.

## Slice 7 — `/lead` direct route

**7.1** `worker/tests/chat.test.ts` (extend)
- `POST /lead` with valid body → 200 `{ok:true}`, D1 row inserted with `source: "direct"`
- `POST /lead` with invalid email → 400
- `POST /lead` with empty `question` → 400
- `POST /lead` with overlong `question` (>2000 chars) → 400
- `POST /lead` from disallowed origin → 403 (in prod mode)

**7.2** `worker/src/index.ts` — add the `/lead` handler.

**7.3** `npm test` green.

## Slice 8 — Ingest script (admin path, no Worker runtime)

**8.1** `worker/scripts/ingest.mjs` (new) — port from the deleted `~/Documents/portfolio-chatbot/scripts/ingest.mjs` (the script in the plan's design doc).

**8.2** `worker/package.json`:
```json
"scripts": {
  "ingest": "node scripts/ingest.mjs"
}
```

**8.3** `worker/README.md` (extend) — add the ingest section, the `wrangler d1 create` /
`wrangler vectorize create` / `wrangler secret put` commands, and the deploy order.

## Slice 9 — Widget swap in next-gen-portfolio

**9.1** Create `next-gen-portfolio/src/components/shared/others/LeoLoader.js` per the spec.

**9.2** Find every reference to `MohanBotLoader` / `MohanBotWidget` / `NEXT_PUBLIC_MOHANBOT_API_URL`
in the portfolio project (`grep -r MohanBot src/`, `grep -r MOHANBOT_API .`), update to `LeoLoader`
+ `NEXT_PUBLIC_LEO_WORKER_URL`.

**9.3** Delete `MohanBotLoader.js` and `MohanBotWidget.js`.

**9.4** Remove the `/mohanbot.js` public asset (if present in `public/`).

**9.5** `next-gen-portfolio/.env.local`: rename `NEXT_PUBLIC_MOHANBOT_API_URL` →
`NEXT_PUBLIC_LEO_WORKER_URL` (the value is the Leo worker URL, not MohanBot's).

**9.6** Smoke test: `npm run dev` and confirm Leo's orb appears + chat works against the deployed
worker.

## Order of operations (final)

1. Slices 1–3 (pure modules + config) — no deploy needed; `npm test` after each.
2. Slice 4 (wrangler.toml) — config only, no runtime change.
3. Slices 5–7 (agent + routes) — runtime change, deploy required to validate against real bindings.
4. Slice 8 (ingest) — admin script, no runtime change.
5. Slice 9 (widget swap) — frontend only, `npm run dev` to validate.

After all slices green, follow the spec's Rollout section.
