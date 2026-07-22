# AI Voice Bot v0.2a — Backend: Streaming + Session Memory — Technical Specification

**Version:** 1.0 (design/spec — no implementation yet)
**Date:** 2026-07-22
**Author:** Mohan Sagar K
**Status:** Approved design, ready for implementation

> First slice of v0.2 (a → b → c). This slice upgrades the Cloudflare Worker backend only:
> **SSE token streaming** and **per-session memory in a Durable Object**, locking the final
> `/chat` contract that the widget (v0.2b) and voice (v0.2c) will build on. No UI work here.
> Builds on v0.1 (spec `2026-07-21-portfolio-chatbot-design.md`), which shipped a stateless,
> non-streamed `/chat`.

---

## 1. Goal

Turn the v0.1 backend from **stateless, non-streamed** into **stateful, streamed**:
- The client sends only the new turn plus a stable `session_id`; the server holds the
  conversation history in a per-session Durable Object.
- Replies stream token-by-token over Server-Sent Events (SSE).
- The turn cap becomes server-authoritative (in the DO), not trusting client-sent history.

The v0.1 LangGraph agent (guardrail → agent → save_lead → confirm → refuse) is reused
**unchanged** — this slice changes only how history is stored and how output is delivered.

---

## 2. Locked Decisions

| # | Area | Decision |
|---|------|----------|
| A1 | Memory storage | **Durable Object per `session_id`** stores the session blob (serialized history + lead state + turn count). Per turn: load → run graph with full history → save. The v0.1 graph runs **stateless** per turn (no LangGraph checkpointer). |
| A2 | DO storage flavor | **SQLite-backed DO** (`new_sqlite_classes` migration) for Cloudflare free-tier eligibility; accessed via the simple `state.storage` KV API (one key holds the session blob). |
| A3 | Contract | **Clean switch** — no backward-compat. Request `{ session_id, message, consent? }` → **SSE** response. `demo.html` updated to consume it. |
| A4 | Streaming | `graph.streamEvents(...)` → filter chat-model token events → SSE `token` frames via a `ReadableStream`; `lead`/`done`/`error` events at boundaries. |
| A5 | Guards | Turn cap authoritative in the DO (server counter) → 429. Origin allowlist + message-length cap unchanged. Model/stream failure → SSE `error` event. |
| A6 | KV runtime config | **Deferred** (not in this slice). Config stays bundled; provider/keys remain env-swappable. |
| A7 | Testing | Core logic as a plain injectable `SessionStore` (node-tested with a fake storage map) + `/chat` handler tested with an **injected fake DO stub** and fake model (no network, no workers runtime). Real DO behavior via `wrangler dev` manual smoke. |

---

## 3. The `/chat` Contract

### 3.1 Request
```jsonc
POST /chat
{
  "session_id": "uuid-v4",        // stable per visitor; client persists it (widget: localStorage)
  "message": "hi",                 // the new turn only — server holds the rest
  "consent": { "agreed": true, "timestamp": "..." }   // optional
}
```

### 3.2 Response — Server-Sent Events (`Content-Type: text/event-stream`)
Frames (each `event:` + `data:` JSON):

| event | data | when |
|-------|------|------|
| `token` | `{ "text": "…" }` | each incremental chunk of the assistant's reply |
| `lead`  | `{ "saved": true, "lead": { name, email, message, … } }` | when `save_lead` succeeds this turn |
| `done`  | `{ "reply": "…full text…", "lead_saved": boolean }` | end of turn (always the last event on success) |
| `error` | `{ "message": "…" }` | model/stream failure mid-turn (terminal) |

### 3.3 Pre-stream guard failures (plain JSON, before the stream opens)
Same status codes as v0.1, returned as normal JSON with CORS headers:
- `403` origin not allowed · `400` missing `session_id`/`message` · `413` message over `MAX_MESSAGE_CHARS` · `429` DO turn count over `MAX_TURNS_PER_SESSION`.

`GET /health` is unchanged in shape (still reports provider/model/tts/leads).

---

## 4. Session Memory — `SessionStore` + `SessionDO`

### 4.1 `SessionStore` (plain, injectable, node-testable)
A pure class over a minimal async storage interface (so it's unit-tested with a fake `Map`):

```ts
interface KvLike { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, val: T): Promise<void>; }

interface SessionState {
  messages: StoredMessage[];   // serialized history (§6)
  lead: Lead;                  // last captured lead ({} until saved)
  leadSaved: boolean;
  turns: number;               // count of user turns this session
}

class SessionStore {
  constructor(private kv: KvLike) {}
  async load(): Promise<SessionState>;                 // defaults on first use
  async save(state: SessionState): Promise<void>;
  async incTurn(): Promise<number>;                    // returns new turn count
}
```

### 4.2 `SessionDO` (Durable Object — thin wrapper)
- Declared in `wrangler.toml` as a SQLite-backed DO class (A2).
- Routed by `env.SESSION_DO.idFromName(session_id)` → one instance per session.
- Its `fetch` handler exposes tiny internal RPC (e.g. `POST /load`, `POST /save`, `POST /inc-turn`)
  delegating to a `SessionStore` built over `this.state.storage`. No agent logic in the DO —
  it is storage only.

### 4.3 Turn flow (in the Worker `/chat` handler)
1. Validate origin/message (pre-stream guards).
2. Get the DO stub for `session_id`; `inc-turn` → if over `MAX_TURNS_PER_SESSION`, return `429` (before streaming).
3. `load()` state; deserialize `messages` → LangChain messages; append the new `HumanMessage`.
4. Run the graph **streaming** (§5), writing `token` frames. Accumulate the final state.
5. `save()` updated state: full message list (history + new human + assistant/tool/confirm turns), `lead`, `leadSaved`.
6. Emit `lead` (if saved this turn) and `done`.

The graph itself is the v0.1 compiled graph via `buildGraph(deps)`, unchanged.

---

## 5. Streaming Implementation (`stream.ts`)

- Build a `ReadableStream` (or `TransformStream`) whose body is the SSE frames; return it with
  `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and CORS headers.
- Drive it from `graph.streamEvents(input, { version: "v2" })`: on each chat-model stream event
  carrying text, write a `token` frame. (If the installed LangGraph.js exposes a different
  streaming surface — e.g. `graph.stream(input, { streamMode: "messages" })` — use that; the
  implementer verifies against the installed version and keeps the SSE output identical.)
- Obtain the final state (final `reply`, `leadSaved`, `lead`) either from the terminal
  streamEvents value or by a final `graph.invoke` short-circuit — implementer picks the reliable
  path for the installed API. Then emit `lead`/`done`.
- Wrap the whole drive in try/catch: on failure, write an `error` frame and close (never a
  CORS-less 500 mid-stream).

SSE frame helper:
```ts
function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
```

---

## 6. Message Serialization (`agent/serialize.ts`)

DO storage is JSON, so LangChain messages are stored in a plain, reversible shape and rebuilt on
load. Cover the message types the graph produces: `human`, `ai` (with optional `tool_calls`),
`tool` (with `tool_call_id`, optional `status`), `system` (system prompt is rebuilt fresh each
turn, so it is NOT stored).

```ts
type StoredMessage =
  | { role: "human"; content: string }
  | { role: "ai"; content: string; tool_calls?: { name: string; id: string; args: unknown }[] }
  | { role: "tool"; content: string; tool_call_id: string; status?: "error" };

function serializeMessages(msgs: BaseMessage[]): StoredMessage[];
function deserializeMessages(stored: StoredMessage[]): BaseMessage[];
```
Round-trip must be lossless for the graph's needs (a stored AI tool-call turn followed by a tool
message must rehydrate into a valid LangChain sequence). Unit-tested both directions.

---

## 7. Config / Wrangler Changes

`worker/wrangler.toml` gains:
```toml
[[durable_objects.bindings]]
name = "SESSION_DO"
class_name = "SessionDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["SessionDO"]
```
`worker/src/index.ts` exports the `SessionDO` class (Workers requires DO classes exported from
the entry module) alongside the default fetch handler. No new secrets; no KV (A6).

---

## 8. Testing Strategy

| Layer | Approach |
|-------|----------|
| `SessionStore` unit | node Vitest with a fake `Map`-backed `KvLike`: load defaults on first use, save/load round-trip, `incTurn` increments and persists. |
| Serialization unit | round-trip `human` / `ai`+tool_calls / `tool`+status through serialize→deserialize; assert structural + content equality and a valid rehydrated sequence. |
| `/chat` streaming (handler) | inject a **fake DO stub** (in-memory store) + fake model (scripted) into `createApp`; parse the SSE body and assert: `token` frames arrive, `done` carries the full reply, a saved lead emits `lead`, and a **second** call with the same `session_id` sees prior history (context carries). |
| Guards | 403 disallowed origin, 400 missing fields, 413 over-length, **429 when the DO turn count exceeds the cap** (fake DO returns a high count). |
| Error path | fake model whose stream/invoke rejects → an SSE `error` frame is emitted with CORS headers (no bare 500). |
| Manual smoke | `wrangler dev` (real DO) + updated `demo.html`: chat, reload the page (session_id persists), confirm Leo remembers the prior turn; watch tokens stream in. |

Existing v0.1 unit/graph tests remain green (the graph is unchanged). The `/chat` tests from v0.1
are **rewritten** for the new `{ session_id, message }` + SSE contract.

Injection seams to add: `createApp(deps)` gains a way to obtain a session store for a
`session_id` (default: real DO stub via `env.SESSION_DO`; tests: an in-memory fake), alongside the
existing `buildModel` injection.

---

## 9. Files

- **New:**
  - `worker/src/session-do.ts` — `SessionStore` (plain, injectable) + `SessionDO` (DO wrapper).
  - `worker/src/agent/serialize.ts` — message ↔ `StoredMessage` (de)serialization.
  - `worker/src/stream.ts` — SSE frame helper + build-SSE-Response-from-graph-stream.
  - `worker/tests/session-store.test.ts`, `worker/tests/serialize.test.ts` — unit.
- **Changed:**
  - `worker/src/index.ts` — `/chat` rewrite (new request shape, DO load/save, streaming); export `SessionDO`; session-store injection seam.
  - `worker/tests/chat.test.ts` — rewritten for `{ session_id, message }` + SSE + turn-cap-via-DO.
  - `worker/wrangler.toml` — DO binding + SQLite migration.
  - `widget/demo.html` — send `{ session_id, message }`, consume SSE (render streamed tokens), persist `session_id` in localStorage.

Unchanged: `agent/graph.ts`, `agent/nodes.ts`, `agent/state.ts`, `agent/tools.ts`, `prompts.ts`,
`providers.ts`, `leads.ts`, `config.ts` (persona/guardrails/voice all carry over as-is).

---

## 10. Out of Scope (deferred to later slices)

- Widget UI / orb / consent gate / returning-visitor greeting UX → **v0.2b**.
- Any voice (STT/TTS/neural) → **v0.2c**.
- KV runtime-editable config → later.
- Neural-TTS `/tts` endpoint, cloud STT `/stt` → v0.2c / backlog.
- Deploy to `voicebot.devmohan.in`, npm/CDN publish → v0.3.

---

## 11. Risks

| # | Item | Mitigation |
|---|------|------------|
| R1 | LangGraph.js streaming API surface differs from `streamEvents(version:"v2")` | Implementer verifies against the installed `@langchain/langgraph` and uses whatever yields per-token events (`stream({streamMode:"messages"})` etc.); SSE output stays identical. Covered by the handler streaming test. |
| R2 | SQLite-backed DO free-tier eligibility at deploy | Works in `wrangler dev` locally now; confirm free-plan DO limits at v0.3 deploy. If ineligible, fall back to Workers KV for the session blob (accept eventual consistency / write limits). |
| R3 | Message serialization loses tool-call linkage → invalid rehydrated sequence | Explicit round-trip tests for the ai-tool-call → tool-message pairing; keep `tool_call_id` and `tool_calls[].id` intact. |
| R4 | Testing DOs needs the workers runtime | Core logic (`SessionStore`, serialize, handler) is injectable and node-tested with fakes; only real end-to-end DO behavior needs `wrangler dev` (manual). Avoids a workers-pool test dependency for this slice. |
| R5 | Streaming + CPU budget on Workers | Token streaming is awaited I/O (doesn't consume CPU-time budget); confirmed pattern from v0.1's 298 KiB bundle. |

---

*End of v0.2a specification. Next: v0.2b (the widget) and v0.2c (voice), each its own spec → plan → build.*
