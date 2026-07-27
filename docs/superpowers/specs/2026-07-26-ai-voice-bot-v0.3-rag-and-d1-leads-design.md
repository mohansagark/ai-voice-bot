# Leo v0.3 — RAG over portfolio data + D1/email lead capture

**Status:** design (pre-implementation)
**Slice owner:** TBD
**Predecessor:** v0.2f (proactive greeting). Builds on top of v0.2a–f. The LangGraph agent, Durable Object session memory, SSE streaming, persona JSON, spam guard, injection guardrail, and the embeddable widget all stay untouched.

## Why this slice

v0.2 Leo answers purely from a hand-curated `facts[]` array in `PERSONA_JSON`. That works for ~10
bullet points but it caps the bot at the depth of whatever someone remembers to type into the
persona. Mohan's real portfolio (`~/Documents/portfolio-data/data/*.json`) is a structured dump of
profile, experience, projects, skills, education, services, testimonials, and achievements — far
more than the persona currently exposes, and it changes as his work changes.

v0.3 adds **retrieval-augmented generation (RAG)**: every chat turn retrieves the most relevant
chunks from that portfolio data and prepends them to the system prompt, so Leo can answer concrete
questions ("what did Mohan ship at Invesco?", "which projects use Next.js?") grounded in real
source text instead of inventing.

v0.3 also replaces the current Formspree lead webhook with a **durable** lead pipeline: leads land
in D1 (source of truth) and trigger an email via Cloudflare Email Service. No third party, fully on
the free tier, recoverable from D1 if email delivery fails.

## Goals

- G1. Leo answers project/experience/skill questions grounded in the portfolio dataset, citing the
  source naturally in the reply.
- G2. Adding/editing portfolio data only requires re-running `npm run ingest` — no worker redeploy.
- G3. Leads captured by the agent's `save_lead` tool land in D1 and trigger an email to Mohan. No
  external webhook dependency.
- G4. A direct `POST /lead` route exists as a backup path for the widget (or any client) to submit
  a lead without going through the agent.
- G5. All of this works on the free tier. Chat still goes to Groq (already free); only embeddings
  use Workers AI, and only at ingest time.

## Non-goals

- NG1. Voice/TTS changes (already shipped in v0.2c).
- NG2. Changing persona JSON shape (already shipped in v0.2).
- NG3. Streaming lead events differently over SSE (the existing `event: lead` frame stays).
- NG4. Admin UI for browsing leads. `wrangler d1 execute` is enough for now.
- NG5. Multi-language RAG or per-language indexes.

## Architecture

```
Next.js portfolio (devmohan.in)
        │  <script src=".../ai-voice-bot.min.js">
        ▼
ai-voice-bot worker (voicebot.devmohan.in)
  ├─ Groq (llama-3.3-70b)              → responses
  ├─ Workers AI (bge-base-en-v1.5)     → embeddings (ingest only; also one embed per /chat turn)
  ├─ Vectorize (portfolio-rag)         → semantic search over portfolio data
  ├─ D1 (ai-voice-bot-db)              → leads
  ├─ Email Service                     → notify Mohan on new lead
  ├─ Durable Object (SessionDO)        → session memory (existing, unchanged)
  └─ LangGraph agent (existing)        → guardrail → agent(+RAG) → save_lead → confirm
```

### Data flow on a chat turn

1. Widget sends `POST /chat { session_id, message, consent }` (existing).
2. Worker enforces origin/turn/spam guards (existing).
3. Worker loads session state from `SessionDO` (existing).
4. **NEW:** Worker calls `retrieve(env, message)`:
   - `env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [message] })` → 768-dim vector.
   - `env.VECTORIZE.query(vec, { topK: RAG_TOP_K, returnMetadata: "all" })`.
   - Filter `score > RAG_MIN_SCORE`, keep top-K, accumulate text up to `RAG_MAX_CONTEXT_CHARS`.
5. Worker passes the retrieved context as a system message to the LangGraph agent (before the
   existing `SystemMessage(buildSystemPrompt(persona))`).
6. Agent runs as today: guardrail → agent → optional `save_lead` → confirm.
7. **CHANGED:** `save_lead` node persists to D1 and triggers email — no more Formspree webhook.
8. SSE streams tokens + `lead` frame + `done` (existing).

### Data flow on lead-only submit (no chat)

- `POST /lead { email, name, question, sessionId? }` → validate → D1 insert → email → `200 {ok:true}`.
- Mirrors the agent's `save_lead` exactly so the schema is one place.

### Data flow on ingest (admin, off the request path)

```
portfolio-data/data/*.json
        │  npm run ingest
        ▼
scripts/ingest.mjs
  ├─ chunkText()                  → profile/experience/projects/skills/edu/services/testimonials/achievements
  ├─ Workers AI REST: embed       → 768-dim vectors (batch of 20)
  └─ Vectorize REST: upsert       → idempotent by chunk id
```

## Module plan

### `worker/src/rag.ts` (new)

```ts
export interface RagMatch { text: string; source: string; score: number; }
export interface RagEnv { AI: Ai; VECTORIZE: VectorizeIndex; }

export async function retrieve(
  env: RagEnv,
  query: string,
  cfg: { topK: number; minScore: number; maxContextChars: number },
): Promise<RagMatch[]>;

export function buildContext(matches: RagMatch[], maxChars: number): string;
export function maybeAugmentSystemPrompt(base: string, context: string): string;
```

`retrieve` filters low-score matches, returns metadata.text + metadata.source. `buildContext` is a
character-budget loop with an off-by-one fix (we do not exceed `maxChars` on the last accepted
block). `maybeAugmentSystemPrompt` returns `base` unchanged when context is empty — keeps Leo's
"don't make stuff up" behavior when RAG finds nothing.

`Ai` and `VectorizeIndex` types come from `@cloudflare/workers-types`. The function takes a
`RagEnv` so it's trivially testable with fakes (no Worker runtime needed).

### `worker/src/leads-store.ts` (new)

```ts
export interface LeadRow {
  email: string; name: string | null; question: string;
  sessionId: string | null; userAgent: string | null; referer: string | null;
  source: "agent" | "direct";
}

export interface LeadsEnv {
  DB: D1Database;
  LEAD_NOTIFY_FROM?: string;
  LEAD_NOTIFY_TO?: string;
  LEAD_EMAIL?: SendEmail;       // optional binding
}

export async function saveLead(env: LeadsEnv, row: LeadRow): Promise<void>;
export async function notifyLeadByEmail(env: LeadsEnv, row: LeadRow): Promise<void>;
```

- `saveLead` is a single `INSERT INTO leads ...` statement. Errors bubble.
- `notifyLeadByEmail` is a no-op when either `LEAD_NOTIFY_FROM` or `LEAD_NOTIFY_TO` is missing OR
  the `LEAD_EMAIL` binding is absent. Otherwise sends a plain-text + HTML email.
- Email failure does **not** fail the lead (D1 row is the source of truth; email is fan-out).

### `worker/schema.sql` (new)

```sql
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT,
  question TEXT NOT NULL,
  session_id TEXT,
  source TEXT NOT NULL DEFAULT 'agent',  -- 'agent' | 'direct'
  user_agent TEXT,
  referer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_email      ON leads(email);
```

### `worker/src/config.ts` — additions

- New fields on `AppConfig`: `ragTopK: number; ragMinScore: number; ragMaxContextChars: number;`.
- New fields on `Env`: `RAG_TOP_K?`, `RAG_MIN_SCORE?`, `RAG_MAX_CONTEXT_CHARS?`,
  `LEAD_NOTIFY_FROM?`, `LEAD_NOTIFY_TO?`, `AI?`, `VECTORIZE?`, `DB?`, `LEAD_EMAIL?`.
- `loadConfig` parses the new vars; defaults match the values below.

### `worker/src/agent/nodes.ts` — `agent` node

- Build the messages list as today, but insert a new `SystemMessage` *between* the persona system
  prompt and the user history: it carries the retrieved context.
- The retrieval call is performed in `index.ts` (the route handler), then passed to the agent via a
  new field on the LangGraph state (`context: string`).
- If context is empty, no extra system message is added (keep current behavior).

### `worker/src/agent/nodes.ts` — `save_lead` node

- Drop `WEBHOOK_URL` and `postLead`.
- Call `deps.persistLead(row)` instead, where `row` is built from the tool args + `state.consent`
  + session metadata, with `source: "agent"`.
- `deps.persistLead` is provided by `createApp` and does D1 insert + email notify.

### `worker/src/agent/state.ts` — additions

- New annotation: `context: Annotation<string>({ reducer: (_, y) => y, default: () => "" })`.
- Stored in the `SessionDO` along with the existing fields (or computed fresh each turn — see
  open question below).

### `worker/src/index.ts` — additions

- New route: `POST /lead { email, name, question, sessionId? }` — same validation as the agent's
  lead, calls `saveLead` directly with `source: "direct"`.
- In `POST /chat`, before constructing the graph runner, call `retrieve(env, message, config.rag)`
  → `buildContext` → attach as `context` to the graph input.
- Remove all references to `env.WEBHOOK_URL` and the `leads.ts` `postLead` function. Keep the
  `isValidEmail` and `saveLeadSchema` exports used by the agent.
- The dependency injection in `createApp` already exists; extend it to include `persistLead` so
  the agent's `save_lead` node stays testable.

### `worker/wrangler.toml` — additions

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

# Optional — only required if you want email notifications.
# [[send_email]]
# name = "LEAD_EMAIL"
# destination_address = "contact@devmohan.in"

[vars]
RAG_TOP_K = "6"
RAG_MIN_SCORE = "0.65"
RAG_MAX_CONTEXT_CHARS = "6000"
# LEAD_NOTIFY_FROM and LEAD_NOTIFY_TO are secrets, not vars.
```

`LEAD_NOTIFY_FROM` and `LEAD_NOTIFY_TO` are set via `wrangler secret put`.

### `worker/scripts/ingest.mjs` (new)

Port of `~/Documents/portfolio-chatbot/scripts/ingest.mjs` (which was deleted along with that
project — see commit message). Identical chunking strategy:

- One chunk per "responsibility" inside an experience item.
- One chunk for the experience's description.
- One chunk per project + one per project section.
- One chunk per skills category.
- One chunk per education, service, testimonial, achievement entry.
- One chunk for the profile.

Embeds in batches of 20 via Workers AI REST, upserts in batches of 100 via Vectorize REST.
Idempotent — re-runs upsert by chunk `id`.

```bash
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...   # needs Workers AI: Edit + Vectorize: Edit
export VECTORIZE_INDEX=portfolio-rag   # optional, default
npm run ingest
```

### `next-gen-portfolio/src/components/shared/others/LeoLoader.js` (new, replaces `MohanBotLoader.js`)

```jsx
"use client";
import { useEffect } from "react";

export default function LeoLoader() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.AiVoiceBotConfig = {
      workerUrl: process.env.NEXT_PUBLIC_LEO_WORKER_URL,
      branding: {
        botName: "Leo",
        greeting:
          "Hi, I'm Leo — Mohan's assistant. Ask me about his work, projects, or how to get in touch.",
      },
      behavior: { autoGreet: true, rememberReturning: true, language: "en-US" },
      privacy: {
        consentText: "I agree to share my info so I can be followed up with.",
        privacyPolicyUrl: null,
      },
      voice: { enabled: false }, // start text-only; can flip later
    };
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/ai-voice-bot-widget@0.1.0/dist/ai-voice-bot.min.js";
    s.async = true; s.defer = true;
    document.body.appendChild(s);
  }, []);
  return null;
}
```

`MohanBotLoader.js` and `MohanBotWidget.js` are deleted. The public `/mohanbot.js` asset is removed.
`NEXT_PUBLIC_LEO_WORKER_URL` is the new env var (replaces `NEXT_PUBLIC_MOHANBOT_API_URL`).

## Data: chunking schema (ingest contract)

| Source JSON file | Chunk id pattern | Metadata.source | Text prefix |
|---|---|---|---|
| `profile.json` | `profile-main` | `profile` | `PROFILE\n...` |
| `experience.json` | `exp-<company>-<idx>` / `exp-<company>-desc` | `experience` | `EXPERIENCE: <role> at <company>...` |
| `projects.json` | `proj-<slug>` / `proj-<slug>-<section>` | `project` | `PROJECT: <title>...` |
| `skills.json` | `skills-<category>` | `skills` | `SKILLS (<category>): ...` |
| `education.json` | `edu-<institution>` | `education` | `EDUCATION: ...` |
| `services.json` | `service-<slug>` | `services` | `SERVICE: ...` |
| `testimonials.json` | `testimonial-<name>` | `testimonials` | `TESTIMONIAL from <name>...` |
| `achievements.json` | `achieve-<title>` | `achievements` | `ACHIEVEMENT: ...` |

Each stored vector carries `metadata.text` (the chunk body, first 1000 chars) so retrieval returns
readable context without a second lookup.

## Decisions and trade-offs

### D1. Retrieval happens once per turn, not per message in history
RAG is over the *current* user message only. We don't re-retrieve the whole history. The agent's
own conversational memory is still the Durable Object. This keeps cost flat per turn and means the
context block is always relevant to what the user is asking *now*.

### D2. RAG context is a fresh system message each turn
Stored in LangGraph state as `context` (default empty). We do **not** persist it into the Durable
Object's serialized history (it's recomputed from the current user message). This avoids storing
potentially-stale context forever.

### D3. `save_lead` drops the webhook, gains D1 + email
The webhook was a black box (Formspree). D1 + Email is fully on Cloudflare, fully free, and
recoverable — leads survive email outages.

### D4. Email failure doesn't fail the lead
D1 insert is the source of truth. Email is a notification. If email fails, the lead is still
saved; we log and move on.

### D5. `RAG_MIN_SCORE = 0.65` default
A safe starting point for bge-base-en-v1.5 cosine similarity. Below 0.65 you start getting
"close but not on-topic" chunks that pollute the answer. Configurable via env.

### D6. Widget starts text-only (voice disabled)
Voice on the portfolio is opt-in. The widget already supports `voice.enabled: false`; the mic
button is hidden and TTS is skipped. We can flip this on later without a Worker change.

## Failure modes

- **F1. Vectorize returns 0 matches** → `retrieve` returns `[]` → `buildContext` returns `""` →
  `maybeAugmentSystemPrompt` returns the base prompt unchanged. Leo answers from persona `facts[]`
  only, just like v0.2. No regression.
- **F2. Workers AI embedding call fails** → `retrieve` throws → the chat route returns a 500
  with a friendly SSE `error` frame. The widget shows "Hmm, something hiccuped" (existing).
- **F3. D1 insert fails on `save_lead`** → agent's `save_lead` node returns a `ToolMessage` with
  `status: "error"` (existing path). Leo's confirm step is skipped, the conversation continues
  naturally. The user isn't told "lead failed" — that would be bad UX — but Mohan will see no
  email and no D1 row, and can re-ask the user.
- **F4. Email send fails** → `notifyLeadByEmail` swallows the error (logged via `console.error`),
  D1 row is still saved. Worst case: Mohan has to check D1.
- **F5. Ingest script is run twice with no data change** → idempotent (upsert by id). Safe.
- **F6. Ingest script is run with no `CLOUDFLARE_*` env** → fails fast with a clear error
  (existing pattern from the old script).
- **F7. RAG context exceeds token limit** → character cap is conservative (6000 chars ≈ 1500
  tokens); well under the 70B model's context. If a single chunk is itself > 6000 chars, the
  ingest script truncates to 1000 chars in `metadata.text` (existing behavior).

## Test plan

| File | Cases |
|---|---|
| `worker/tests/rag.test.ts` | empty matches → no augmentation; low-score filtered; character cap respected; off-by-one doesn't exceed cap; embed call uses correct model + shape; vectorize query uses correct topK; missing binding fails loudly. |
| `worker/tests/leads-store.test.ts` | D1 insert happy path; email is no-op without env vars; email is no-op without `LEAD_EMAIL` binding; email send is best-effort (failure does not throw); email body contains name/email/question; schema rejects invalid email; source defaults to `'agent'`, can be overridden to `'direct'`. |
| `worker/tests/chat.test.ts` (extend) | chat route calls `retrieve` once per turn; the agent's input messages include the context system message when matches exist; no context system message when matches are empty; lead path persists via D1 + email instead of webhook; `/lead` direct route validates and inserts with `source: 'direct'`. |
| `worker/tests/graph.test.ts` (extend) | `save_lead` node calls `persistLead` (not `postLead`); on D1 success, `leadSaved = true` and a confirm AIMessage follows. |

## Rollout

1. Land the code (slice per the plan doc).
2. `npm test` green.
3. `npx wrangler d1 create ai-voice-bot-db` → paste id into `wrangler.toml`.
4. `npx wrangler d1 execute ai-voice-bot-db --remote --file=./schema.sql`.
5. `npx wrangler vectorize create portfolio-rag --dimensions 768 --metric cosine`.
6. `npm run ingest` (reads `~/Documents/portfolio-data/data/*.json`).
7. `npx wrangler secret put LEAD_NOTIFY_FROM` / `LEAD_NOTIFY_TO` (skip if email is off).
8. `npx wrangler deploy`.
9. In `next-gen-portfolio/.env.local`: set `NEXT_PUBLIC_LEO_WORKER_URL=https://voicebot.devmohan.in`.
10. `npm run dev` and verify the orb + chat.
11. After verification, commit the deletion of `~/Documents/portfolio-chatbot`.

## Open questions

- **OQ1.** Should RAG context be persisted in the DO, or always recomputed? Current plan: always
  recomputed. If we find the model complains "you don't have that context anymore" mid-thread,
  we'll revisit.
- **OQ2.** Do we want a `/admin/leads` route on the worker for read-only browsing, or is
  `wrangler d1 execute` enough? Deferring.
- **OQ3.** Should the widget also POST a lead directly to `/lead` on its own (without the agent's
  tool call) when the user fills the consent form? Probably no — the agent path is enough. Defer.
