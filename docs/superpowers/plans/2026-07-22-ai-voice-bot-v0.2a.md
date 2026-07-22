# AI Voice Bot v0.2a — Backend Streaming + Session Memory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the v0.1 Cloudflare Worker from stateless/non-streamed to **SSE-streamed** replies with **per-session memory in a Durable Object**, locking the `{ session_id, message }` → SSE contract for the widget. The v0.1 LangGraph agent is reused unchanged.

**Architecture:** A per-`session_id` Durable Object stores the serialized conversation. Each turn the handler loads history from the DO, runs the (unchanged) graph over history + the new message while streaming tokens over SSE, then saves the updated state back. All new logic is factored into plain, injectable, node-testable units (`SessionStore`, serialize, `streamChatSSE`); the Durable-Object and LangGraph-streaming adapters are thin and verified by a `wrangler dev` smoke test.

**Tech Stack:** TypeScript, Cloudflare Workers + Wrangler, Durable Objects (SQLite-backed, free tier), `@langchain/langgraph`, `@langchain/core`, Vitest.

## Global Constraints

- **Free-tier only.** The Durable Object MUST be SQLite-backed via a `new_sqlite_classes` migration (free-plan eligible). No paid bindings, no paid-only features. Stay within Workers free limits. Use the DO's simple `ctx.storage` KV API (one key per session).
- **TypeScript on Cloudflare Workers**; `nodejs_compat` stays enabled. `npx tsc --noEmit` must be clean before every commit.
- **No secret reaches the browser.** Keys only via env.
- **New `/chat` contract (clean break, no backward-compat):** request `{ session_id: string, message: string, consent?: {...} }` → **SSE** response (`event: token|lead|done|error`). Pre-stream guard failures are plain JSON with CORS headers (403 origin / 400 missing fields / 413 over `MAX_MESSAGE_CHARS` / 429 over `MAX_TURNS_PER_SESSION`). `/health` unchanged.
- **The graph is unchanged.** Do NOT modify `agent/graph.ts`, `agent/nodes.ts`, `agent/state.ts`, `agent/tools.ts`, `prompts.ts`, `providers.ts`, `leads.ts`, or the persona/voice in `config.ts`.
- **Node-testable core via injection.** Do NOT add a workers-runtime test pool. Core logic is tested in plain node Vitest with fakes; the DO class and the LangGraph-streaming adapter are the only untested-by-unit pieces and are covered by the `wrangler dev` smoke test.
- **Turn cap is server-authoritative** (from the DO's stored `turns`), never from client-sent history length.
- TDD (failing test first), `tsc` clean, frequent commits.

## File Structure

```
worker/src/
  agent/serialize.ts     # BaseMessage <-> StoredMessage (node-safe, no workers imports)
  session-store.ts       # SessionState, KvLike, SessionStore, storageToKv (node-safe)
  session-do.ts          # SessionDO (extends DurableObject; imports cloudflare:workers)
  stream.ts              # sse(), GraphRunner types, streamChatSSE(), makeGraphRunner()
  index.ts               # /chat rewrite (SSE + DO), exports SessionDO; getSession/makeRunner seams
  config.ts              # + Env.SESSION_DO binding type (persona/providers unchanged)
worker/tests/
  serialize.test.ts
  session-store.test.ts
  stream.test.ts
  chat.test.ts           # rewritten for the new contract
worker/wrangler.toml     # + DO binding + SQLite migration
widget/demo.html         # SSE client + session_id in localStorage
```

> **Note on file split:** `SessionStore` (node-tested) lives in `session-store.ts` and the `SessionDO` class (imports `cloudflare:workers`, not loadable in node Vitest) lives in `session-do.ts`. This differs from the spec's single-file suggestion, deliberately, so the store logic stays node-testable.

---

### Task 1: Message serialization

**Files:**
- Create: `worker/src/agent/serialize.ts`
- Test: `worker/tests/serialize.test.ts`

**Interfaces:**
- Consumes: `HumanMessage`, `AIMessage`, `ToolMessage`, `BaseMessage` from `@langchain/core/messages`.
- Produces: `StoredMessage` (union), `serializeMessages(msgs: BaseMessage[]): StoredMessage[]`, `deserializeMessages(stored: StoredMessage[]): BaseMessage[]`.

- [ ] **Step 1: Write the failing test**

`worker/tests/serialize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { serializeMessages, deserializeMessages } from "../src/agent/serialize";

describe("message serialization", () => {
  it("round-trips a human message", () => {
    const [out] = deserializeMessages(serializeMessages([new HumanMessage("hi")]));
    expect(out).toBeInstanceOf(HumanMessage);
    expect(out.content).toBe("hi");
  });

  it("round-trips an AI message with a tool call", () => {
    const ai = new AIMessage({ content: "", tool_calls: [{ name: "save_lead", id: "c1", args: { email: "a@b.com" } }] });
    const stored = serializeMessages([ai]);
    expect(stored[0]).toMatchObject({ role: "ai", tool_calls: [{ name: "save_lead", id: "c1" }] });
    const [out] = deserializeMessages(stored) as [AIMessage];
    expect(out).toBeInstanceOf(AIMessage);
    expect(out.tool_calls?.[0]).toMatchObject({ name: "save_lead", id: "c1", args: { email: "a@b.com" } });
  });

  it("round-trips a tool message including error status", () => {
    const tm = new ToolMessage({ content: "bad email", tool_call_id: "c1", status: "error" });
    const stored = serializeMessages([tm]);
    expect(stored[0]).toMatchObject({ role: "tool", tool_call_id: "c1", status: "error" });
    const [out] = deserializeMessages(stored) as [ToolMessage];
    expect(out).toBeInstanceOf(ToolMessage);
    expect(out.tool_call_id).toBe("c1");
  });

  it("skips system messages (rebuilt each turn)", () => {
    // A valid ai->tool sequence survives; system is never stored.
    const seq = [new HumanMessage("hi"), new AIMessage("hello")];
    expect(deserializeMessages(serializeMessages(seq))).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd worker && npm test -- tests/serialize.test.ts`
Expected: FAIL — cannot find module `../src/agent/serialize`.

- [ ] **Step 3: Implement `serialize.ts`**

`worker/src/agent/serialize.ts`:
```ts
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

export type StoredMessage =
  | { role: "human"; content: string }
  | { role: "ai"; content: string; tool_calls?: { name: string; id: string; args: unknown }[] }
  | { role: "tool"; content: string; tool_call_id: string; status?: "error" };

function asText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

export function serializeMessages(msgs: BaseMessage[]): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (const m of msgs) {
    const content = asText(m.content);
    if (m instanceof HumanMessage) {
      out.push({ role: "human", content });
    } else if (m instanceof AIMessage) {
      const calls = (m.tool_calls ?? []).map((c) => ({ name: c.name, id: c.id ?? "", args: c.args }));
      out.push(calls.length ? { role: "ai", content, tool_calls: calls } : { role: "ai", content });
    } else if (m instanceof ToolMessage) {
      const sm: StoredMessage = { role: "tool", content, tool_call_id: m.tool_call_id };
      if (m.status === "error") sm.status = "error";
      out.push(sm);
    }
    // SystemMessage is intentionally skipped — the system prompt is rebuilt fresh each turn.
  }
  return out;
}

export function deserializeMessages(stored: StoredMessage[]): BaseMessage[] {
  return stored.map((s) => {
    if (s.role === "human") return new HumanMessage(s.content);
    if (s.role === "ai") {
      return new AIMessage({
        content: s.content,
        tool_calls: (s.tool_calls ?? []).map((c) => ({
          name: c.name, id: c.id, args: (c.args ?? {}) as Record<string, unknown>, type: "tool_call" as const,
        })),
      });
    }
    return new ToolMessage({ content: s.content, tool_call_id: s.tool_call_id, ...(s.status ? { status: s.status } : {}) });
  });
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/serialize.test.ts`
Expected: PASS (4 passed). If `m.status` typing on `ToolMessage` differs in the installed `@langchain/core`, read the installed type and adjust the access (keep the stored shape identical).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add worker/src/agent/serialize.ts worker/tests/serialize.test.ts
git commit -m "feat(worker): LangChain message <-> JSON serialization for session storage"
```

---

### Task 2: SessionStore + storage adapter

**Files:**
- Create: `worker/src/session-store.ts`
- Test: `worker/tests/session-store.test.ts`

**Interfaces:**
- Consumes: `StoredMessage` (Task 1), `Lead` from `agent/state.ts`.
- Produces:
  - `KvLike` — `{ get<T>(key): Promise<T|undefined>; put<T>(key, val): Promise<void> }`.
  - `SessionState` — `{ messages: StoredMessage[]; lead: Lead; leadSaved: boolean; turns: number }`.
  - `SessionStore` class — `constructor(kv: KvLike)`, `load(): Promise<SessionState>` (defaults on first use), `save(state): Promise<void>`.
  - `DOStorageLike` — `{ get<T>(key): Promise<T|undefined>; put<T>(key, val): Promise<void> }`; `storageToKv(storage: DOStorageLike): KvLike`.

- [ ] **Step 1: Write the failing test**

`worker/tests/session-store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SessionStore, storageToKv, type KvLike, type SessionState } from "../src/session-store";

function fakeKv(): KvLike {
  const map = new Map<string, unknown>();
  return { get: async (k) => map.get(k) as any, put: async (k, v) => void map.set(k, v) };
}

describe("SessionStore", () => {
  it("returns a default empty state on first load", async () => {
    const s = await new SessionStore(fakeKv()).load();
    expect(s).toEqual({ messages: [], lead: {}, leadSaved: false, turns: 0 });
  });

  it("round-trips a saved state", async () => {
    const store = new SessionStore(fakeKv());
    const state: SessionState = { messages: [{ role: "human", content: "hi" }], lead: { email: "a@b.com" }, leadSaved: true, turns: 3 };
    await store.save(state);
    expect(await store.load()).toEqual(state);
  });

  it("storageToKv adapts a DO-storage-like object", async () => {
    const map = new Map<string, unknown>();
    const kv = storageToKv({ get: async (k) => map.get(k) as any, put: async (k, v) => void map.set(k, v) });
    await kv.put("session", { turns: 1 });
    expect(await kv.get("session")).toEqual({ turns: 1 });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/session-store.test.ts`
Expected: FAIL — cannot find module `../src/session-store`.

- [ ] **Step 3: Implement `session-store.ts`**

`worker/src/session-store.ts`:
```ts
import type { StoredMessage } from "./agent/serialize";
import type { Lead } from "./agent/state";

export interface KvLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, val: T): Promise<void>;
}

export interface SessionState {
  messages: StoredMessage[];
  lead: Lead;
  leadSaved: boolean;
  turns: number;
}

const KEY = "session";
const emptyState = (): SessionState => ({ messages: [], lead: {}, leadSaved: false, turns: 0 });

export class SessionStore {
  constructor(private kv: KvLike) {}
  async load(): Promise<SessionState> {
    return (await this.kv.get<SessionState>(KEY)) ?? emptyState();
  }
  async save(state: SessionState): Promise<void> {
    await this.kv.put(KEY, state);
  }
}

// A Durable Object's `ctx.storage` exposes get/put; adapt it to KvLike.
export interface DOStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}
export function storageToKv(storage: DOStorageLike): KvLike {
  return { get: (k) => storage.get(k), put: (k, v) => storage.put(k, v) };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/session-store.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add worker/src/session-store.ts worker/tests/session-store.test.ts
git commit -m "feat(worker): SessionStore (injectable per-session state) + DO storage adapter"
```

---

### Task 3: SSE streaming (`stream.ts`)

**Files:**
- Create: `worker/src/stream.ts`
- Test: `worker/tests/stream.test.ts`

**Interfaces:**
- Consumes: `Lead` (state.ts), `BaseMessage` (`@langchain/core/messages`), the compiled graph from `buildGraph` (agent/graph.ts).
- Produces:
  - `sse(event: string, data: unknown): string`.
  - `GraphFinal` — `{ reply: string; leadSaved: boolean; lead: Lead; messages: BaseMessage[] }`.
  - `GraphStreamRun` — `{ tokens: AsyncIterable<string>; final: Promise<GraphFinal> }`.
  - `GraphRunner` — `(messages: BaseMessage[], consent: unknown) => GraphStreamRun`.
  - `streamChatSSE(run: GraphStreamRun, cors: Record<string,string>, persist?: (f: GraphFinal) => Promise<void>): Response`.
  - `makeGraphRunner(graph: ReturnType<typeof buildGraph>): GraphRunner` — the LangGraph-streaming adapter (verified by smoke, not unit test).

- [ ] **Step 1: Write the failing test (covers `sse` + `streamChatSSE` with a fake run)**

`worker/tests/stream.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { sse, streamChatSSE, type GraphStreamRun, type GraphFinal } from "../src/stream";

const cors = { "access-control-allow-origin": "https://devmohan.in" };

async function bodyText(res: Response): Promise<string> {
  return await res.text();
}

function runFrom(tokens: string[], final: GraphFinal, throwAfter = false): GraphStreamRun {
  async function* gen() {
    for (const t of tokens) yield t;
    if (throwAfter) throw new Error("stream boom");
  }
  return { tokens: gen(), final: Promise.resolve(final) };
}

describe("sse", () => {
  it("formats an event frame", () => {
    expect(sse("token", { text: "hi" })).toBe(`event: token\ndata: {"text":"hi"}\n\n`);
  });
});

describe("streamChatSSE", () => {
  it("streams token frames then a done frame, and sets SSE + CORS headers", async () => {
    const final: GraphFinal = { reply: "Hi there", leadSaved: false, lead: {}, messages: [new AIMessage("Hi there")] };
    const res = streamChatSSE(runFrom(["Hi ", "there"], final), cors);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://devmohan.in");
    const body = await bodyText(res);
    expect(body).toContain(`event: token\ndata: {"text":"Hi "}`);
    expect(body).toContain(`event: token\ndata: {"text":"there"}`);
    expect(body).toContain(`event: done`);
    expect(body).toContain(`"reply":"Hi there"`);
  });

  it("emits a lead frame when the lead was saved, and calls persist", async () => {
    const final: GraphFinal = { reply: "Saved!", leadSaved: true, lead: { email: "a@b.com" }, messages: [new AIMessage("Saved!")] };
    let persisted: GraphFinal | null = null;
    const res = streamChatSSE(runFrom(["Saved!"], final), cors, async (f) => void (persisted = f));
    const body = await bodyText(res);
    expect(body).toContain(`event: lead`);
    expect(body).toContain(`"email":"a@b.com"`);
    expect(persisted?.leadSaved).toBe(true);
  });

  it("emits an error frame (with CORS) when the token stream throws", async () => {
    const final: GraphFinal = { reply: "", leadSaved: false, lead: {}, messages: [] };
    const res = streamChatSSE(runFrom(["partial"], final, true), cors);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://devmohan.in");
    const body = await bodyText(res);
    expect(body).toContain(`event: error`);
    expect(body).toContain(`stream boom`);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/stream.test.ts`
Expected: FAIL — cannot find module `../src/stream`.

- [ ] **Step 3: Implement `stream.ts`**

`worker/src/stream.ts`:
```ts
import type { BaseMessage } from "@langchain/core/messages";
import type { Lead } from "./agent/state";
import type { buildGraph } from "./agent/graph";

export function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface GraphFinal {
  reply: string;
  leadSaved: boolean;
  lead: Lead;
  messages: BaseMessage[];
}
export interface GraphStreamRun {
  tokens: AsyncIterable<string>;
  final: Promise<GraphFinal>;
}
export type GraphRunner = (messages: BaseMessage[], consent: unknown) => GraphStreamRun;

export function streamChatSSE(
  run: GraphStreamRun,
  cors: Record<string, string>,
  persist?: (f: GraphFinal) => Promise<void>,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(sse(event, data)));
      try {
        for await (const t of run.tokens) if (t) send("token", { text: t });
        const f = await run.final;
        if (persist) {
          // Persisting this turn's memory must not abort delivery of the reply.
          try { await persist(f); } catch { /* memory of this turn lost; reply still delivered */ }
        }
        if (f.leadSaved) send("lead", { saved: true, lead: f.lead });
        send("done", { reply: f.reply, lead_saved: f.leadSaved });
      } catch (e) {
        send("error", { message: String((e as Error).message) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

// --- LangGraph-streaming adapter (verified by the wrangler dev smoke test, not unit-tested) ---
// Drives the compiled graph, yielding LLM token text and resolving the final graph state.
// If the installed @langchain/langgraph exposes a different streaming surface, adjust HERE
// only — the SSE contract above stays identical. Primary API: graph.stream with multi-mode
// ["messages","values"]; "messages" yields [AIMessageChunk, metadata], "values" yields state.
export function makeGraphRunner(graph: ReturnType<typeof buildGraph>): GraphRunner {
  return (messages, consent) => {
    let resolveFinal!: (f: GraphFinal) => void;
    let rejectFinal!: (e: unknown) => void;
    const final = new Promise<GraphFinal>((res, rej) => { resolveFinal = res; rejectFinal = rej; });

    async function* tokens(): AsyncIterable<string> {
      try {
        let lastState: any;
        const stream = await graph.stream(
          { messages, consent } as any,
          { streamMode: ["messages", "values"] as any },
        );
        for await (const [mode, chunk] of stream as any) {
          if (mode === "messages") {
            const msgChunk = Array.isArray(chunk) ? chunk[0] : chunk;
            const text = typeof msgChunk?.content === "string" ? msgChunk.content : "";
            if (text) yield text;
          } else if (mode === "values") {
            lastState = chunk;
          }
        }
        const msgs: BaseMessage[] = lastState?.messages ?? [];
        const last = msgs[msgs.length - 1];
        resolveFinal({
          reply: typeof last?.content === "string" ? last.content : "",
          leadSaved: !!lastState?.leadSaved,
          lead: lastState?.lead ?? {},
          messages: msgs,
        });
      } catch (e) {
        rejectFinal(e);
        throw e;
      }
    }

    return { tokens: tokens(), final };
  };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/stream.test.ts`
Expected: PASS (4 passed). Only `sse` + `streamChatSSE` are unit-tested; `makeGraphRunner` is exercised by the smoke test in Task 6.

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add worker/src/stream.ts worker/tests/stream.test.ts
git commit -m "feat(worker): SSE streaming helper + LangGraph token-stream adapter"
```

---

### Task 4: SessionDO (Durable Object) + Wrangler config

**Files:**
- Create: `worker/src/session-do.ts`
- Modify: `worker/wrangler.toml`, `worker/src/config.ts` (add `SESSION_DO` to `Env`)
- Test: none automated (needs the workers runtime) — verified by `tsc` here and the smoke test in Task 6.

**Interfaces:**
- Consumes: `SessionStore`, `storageToKv`, `SessionState` (Task 2).
- Produces: `class SessionDO` with async RPC methods `load(): Promise<SessionState>` and `save(state: SessionState): Promise<void>`; `Env.SESSION_DO: DurableObjectNamespace`.

- [ ] **Step 1: Implement `session-do.ts`**

`worker/src/session-do.ts`:
```ts
import { DurableObject } from "cloudflare:workers";
import { SessionStore, storageToKv, type SessionState } from "./session-store";

// One instance per session_id (via idFromName). Storage only — no agent logic here.
export class SessionDO extends DurableObject {
  private store = new SessionStore(storageToKv(this.ctx.storage));

  async load(): Promise<SessionState> {
    return this.store.load();
  }
  async save(state: SessionState): Promise<void> {
    return this.store.save(state);
  }
}
```

- [ ] **Step 2: Add the DO binding + SQLite migration to `wrangler.toml`**

Append to `worker/wrangler.toml`:
```toml
[[durable_objects.bindings]]
name = "SESSION_DO"
class_name = "SessionDO"

# SQLite-backed DO => eligible on the Cloudflare free plan.
[[migrations]]
tag = "v1"
new_sqlite_classes = ["SessionDO"]
```

- [ ] **Step 3: Add the binding type to `Env` in `config.ts`**

In `worker/src/config.ts`, add to the `Env` interface (leave everything else untouched):
```ts
  SESSION_DO: DurableObjectNamespace;
```
(`DurableObjectNamespace` comes from `@cloudflare/workers-types`, already in `tsconfig` types.)

- [ ] **Step 4: tsc**

Run: `cd worker && npx tsc --noEmit`
Expected: 0 errors. (If the installed types name the DO base import differently, verify against `@cloudflare/workers-types` / `cloudflare:workers` and adjust the import only.)

- [ ] **Step 5: Commit**

```bash
git add worker/src/session-do.ts worker/wrangler.toml worker/src/config.ts
git commit -m "feat(worker): SQLite-backed SessionDO durable object + binding (free-tier)"
```

---

### Task 5: Rewrite `/chat` for SSE + DO memory

**Files:**
- Modify: `worker/src/index.ts`
- Test: `worker/tests/chat.test.ts` (rewrite for the new contract)

**Interfaces:**
- Consumes: `loadConfig`/`Env`/`AppConfig`/`Consent` (config.ts), `buildModel` (providers.ts), `buildGraph` (agent/graph.ts), `HumanMessage` (`@langchain/core/messages`), `serializeMessages`/`deserializeMessages` (serialize.ts), `SessionStore`/`SessionState` (session-store.ts), `SessionDO` (session-do.ts), `streamChatSSE`/`makeGraphRunner`/`GraphRunner`/`GraphFinal` (stream.ts).
- Produces:
  - `SessionHandle` — `{ load(): Promise<SessionState>; save(s: SessionState): Promise<void> }`.
  - `Deps` — `{ buildModel: typeof buildModel; getSession: (env: Env, sessionId: string) => SessionHandle; makeRunner: (graph) => GraphRunner }`, all defaulted.
  - `createApp(deps?)` serving the new `/chat`; `export { SessionDO }`; `export default createApp()`.
- `/chat` request `{ session_id, message, consent? }`; SSE response.

- [ ] **Step 1: Write the failing tests (rewrite `worker/tests/chat.test.ts`)**

Replace the whole file:
```ts
import { describe, it, expect } from "vitest";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { createApp, type SessionHandle } from "../src/index";
import type { Env } from "../src/config";
import type { SessionState } from "../src/session-store";
import type { GraphRunner, GraphFinal } from "../src/stream";

const env = { GROQ_API_KEY: "x", WEBHOOK_URL: "https://hook.test/x", ALLOWED_ORIGINS: "https://devmohan.in" } as unknown as Env;
const headers = { origin: "https://devmohan.in", "content-type": "application/json" };
const chatReq = (body: unknown) => new Request("https://w/chat", { method: "POST", headers, body: JSON.stringify(body) });

// In-memory session store shared across a test, keyed by session_id.
function memSessions() {
  const map = new Map<string, SessionState>();
  const getSession = (_env: Env, id: string): SessionHandle => ({
    load: async () => map.get(id) ?? { messages: [], lead: {}, leadSaved: false, turns: 0 },
    save: async (s) => void map.set(id, s),
  });
  return { map, getSession };
}

// A fake runner that records the messages it was given and streams scripted tokens + final.
function fakeRunnerFactory(tokens: string[], final: Omit<GraphFinal, "messages">) {
  const seen: BaseMessage[][] = [];
  const makeRunner = (_graph: unknown): GraphRunner => (messages) => {
    seen.push(messages);
    async function* gen() { for (const t of tokens) yield t; }
    return { tokens: gen(), final: Promise.resolve({ ...final, messages: [...messages, new AIMessage(final.reply)] }) };
  };
  return { seen, makeRunner };
}

const fakeBuildModel = (() => ({ bindTools: () => ({ invoke: async () => new AIMessage("") }) })) as any;

async function readSSE(res: Response): Promise<string> { return await res.text(); }

describe("/chat (SSE + session memory)", () => {
  it("streams tokens then a done frame", async () => {
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["Hi ", "there"], { reply: "Hi there", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const res = await app.fetch(chatReq({ session_id: "s1", message: "hello" }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const body = await readSSE(res);
    expect(body).toContain(`event: token`);
    expect(body).toContain(`"text":"there"`);
    expect(body).toContain(`event: done`);
    expect(body).toContain(`"reply":"Hi there"`);
  });

  it("remembers prior turns for the same session_id", async () => {
    const { getSession } = memSessions();
    const { seen, makeRunner } = fakeRunnerFactory(["ok"], { reply: "ok", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    await readSSE(await app.fetch(chatReq({ session_id: "s1", message: "I'm Alex" }), env));
    await readSSE(await app.fetch(chatReq({ session_id: "s1", message: "what's my name?" }), env));
    // 2nd turn's runner input includes the FIRST turn's human message (history carried via the store).
    const secondInput = seen[1].map((m) => String(m.content));
    expect(secondInput).toContain("I'm Alex");
    expect(secondInput).toContain("what's my name?");
  });

  it("emits a lead frame and persists sticky lead state", async () => {
    const { map, getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["done"], { reply: "Saved!", leadSaved: true, lead: { email: "a@b.com" } });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const body = await readSSE(await app.fetch(chatReq({ session_id: "s1", message: "a@b.com" }), env));
    expect(body).toContain(`event: lead`);
    expect(map.get("s1")?.leadSaved).toBe(true);
    expect(map.get("s1")?.lead).toMatchObject({ email: "a@b.com" });
  });

  it("rejects a disallowed origin with 403 (before streaming)", async () => {
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const req = new Request("https://w/chat", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ session_id: "s1", message: "hi" }) });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(403);
  });

  it("rejects missing session_id/message with 400", async () => {
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    expect((await app.fetch(chatReq({ message: "hi" }), env)).status).toBe(400);
    expect((await app.fetch(chatReq({ session_id: "s1" }), env)).status).toBe(400);
  });

  it("rejects an over-long message with 413", async () => {
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const res = await app.fetch(chatReq({ session_id: "s1", message: "a".repeat(3000) }), env);
    expect(res.status).toBe(413);
  });

  it("rejects when the DO turn count is at the cap with 429", async () => {
    const map = new Map<string, SessionState>([["s1", { messages: [], lead: {}, leadSaved: false, turns: 30 }]]);
    const getSession = (_e: Env, id: string): SessionHandle => ({
      load: async () => map.get(id)!, save: async (s) => void map.set(id, s),
    });
    const { makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const res = await app.fetch(chatReq({ session_id: "s1", message: "hi" }), env);
    expect(res.status).toBe(429);
  });

  it("health still works", async () => {
    const app = createApp();
    const res = await app.fetch(new Request("https://w/health"), env);
    expect((await res.json() as any).provider).toBe("groq");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- tests/chat.test.ts`
Expected: FAIL — the old handler uses `messages[]`, not `{ session_id, message }` + SSE; `SessionHandle`/new `Deps` not exported.

- [ ] **Step 3: Rewrite `worker/src/index.ts`**

`worker/src/index.ts`:
```ts
import { loadConfig, type Env, type AppConfig, type Consent } from "./config";
import { buildModel } from "./providers";
import { buildGraph } from "./agent/graph";
import { HumanMessage } from "@langchain/core/messages";
import { serializeMessages, deserializeMessages } from "./agent/serialize";
import type { SessionState } from "./session-store";
import { SessionDO } from "./session-do";
import { streamChatSSE, makeGraphRunner, type GraphRunner, type GraphFinal } from "./stream";

export interface SessionHandle {
  load(): Promise<SessionState>;
  save(state: SessionState): Promise<void>;
}

// Default session accessor: a Durable Object per session_id (RPC methods load/save).
function doGetSession(env: Env, sessionId: string): SessionHandle {
  const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId)) as unknown as SessionHandle;
  return { load: () => stub.load(), save: (s) => stub.save(s) };
}

export interface Deps {
  buildModel: typeof buildModel;
  getSession: (env: Env, sessionId: string) => SessionHandle;
  makeRunner: (graph: ReturnType<typeof buildGraph>) => GraphRunner;
}

function corsHeaders(origin: string, allowed: string[]): Record<string, string> {
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    "access-control-allow-origin": ok && origin ? origin : "null",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

interface ChatBody { session_id?: string; message?: string; consent?: Consent; }

export function createApp(
  deps: Deps = { buildModel, getSession: doGetSession, makeRunner: makeGraphRunner },
) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const config: AppConfig = loadConfig(env);
      const origin = request.headers.get("origin") || "";
      const cors = corsHeaders(origin, config.allowedOrigins);

      if (request.method === "OPTIONS") return new Response(null, { headers: cors });

      if (url.pathname === "/health") {
        const p = config.providers[config.defaultProvider];
        return Response.json(
          { ok: true, provider: config.defaultProvider, model: p?.model, tts: "browser", leads: env.WEBHOOK_URL ? "webhook" : "none" },
          { headers: cors },
        );
      }

      if (url.pathname === "/chat" && request.method === "POST") {
        if (config.allowedOrigins.length && !config.allowedOrigins.includes(origin)) {
          return Response.json({ error: "origin not allowed" }, { status: 403, headers: cors });
        }
        const body = (await request.json().catch(() => null)) as ChatBody | null;
        if (!body?.session_id || !body?.message) {
          return Response.json({ error: "session_id and message are required" }, { status: 400, headers: cors });
        }
        if (body.message.length > config.maxMessageChars) {
          return Response.json({ error: "message too long" }, { status: 413, headers: cors });
        }

        const handle = deps.getSession(env, body.session_id);
        let state: SessionState;
        try { state = await handle.load(); }
        catch (e) { return Response.json({ error: String((e as Error).message) }, { status: 500, headers: cors }); }

        if (state.turns + 1 > config.maxTurnsPerSession) {
          return Response.json({ error: "too many turns" }, { status: 429, headers: cors });
        }
        const turns = state.turns + 1;

        let model;
        try { model = deps.buildModel(config, env); }
        catch (e) { return Response.json({ error: String((e as Error).message) }, { status: 500, headers: cors }); }

        const graph = buildGraph({ model, persona: config.persona, webhookUrl: env.WEBHOOK_URL || "" });
        const history = deserializeMessages(state.messages);
        const messages = [...history, new HumanMessage(body.message)];
        const run = deps.makeRunner(graph)(messages, body.consent ?? { agreed: false });

        const persist = async (f: GraphFinal): Promise<void> => {
          await handle.save({
            messages: serializeMessages(f.messages),
            lead: f.leadSaved ? f.lead : state.lead,          // sticky: keep prior lead if none saved this turn
            leadSaved: state.leadSaved || f.leadSaved,          // sticky across the session
            turns,
          });
        };

        return streamChatSSE(run, cors, persist);
      }

      return new Response("Not found", { status: 404, headers: cors });
    },
  };
}

export { SessionDO };
export default createApp();
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- tests/chat.test.ts`
Expected: PASS (all cases). Then run the full suite: `npm test` — everything green.

- [ ] **Step 5: tsc + bundle check + commit**

Run: `npx tsc --noEmit` → 0 errors. Then `npm run dryrun` → confirm it still bundles (note the gz size; DO adds little). 
```bash
git add worker/src/index.ts worker/tests/chat.test.ts
git commit -m "feat(worker): stream /chat over SSE with per-session Durable Object memory"
```

---

### Task 6: Update `demo.html` (SSE + session_id) + smoke test

**Files:**
- Modify: `widget/demo.html`
- Test: manual (`wrangler dev` + browser).

- [ ] **Step 1: Rewrite `widget/demo.html`**

`widget/demo.html`:
```html
<!doctype html>
<meta charset="utf-8" />
<title>AI Voice Bot — v0.2a demo (streaming + memory)</title>
<style>
  body { font: 15px system-ui; max-width: 560px; margin: 40px auto; }
  #log { border: 1px solid #ddd; border-radius: 8px; padding: 12px; min-height: 220px; white-space: pre-wrap; }
  .u { color: #333; } .a { color: #6c5ce7; } .m { margin: 6px 0; }
  form { display: flex; gap: 8px; margin-top: 12px; }
  input { flex: 1; padding: 10px; } button { padding: 10px 16px; }
  small { color: #888; }
</style>
<h1>AI Voice Bot — v0.2a</h1>
<small>Streaming replies + memory. Your session persists across reloads (localStorage).</small>
<div id="log"></div>
<form id="f"><input id="i" placeholder="Say hi…" autocomplete="off" /><button>Send</button></form>
<script>
  const WORKER = "http://localhost:8787";
  // Stable session id per browser — this is what gives Leo memory across reloads.
  let sid = localStorage.getItem("avb_session");
  if (!sid) { sid = crypto.randomUUID(); localStorage.setItem("avb_session", sid); }

  const log = document.getElementById("log");
  function line(role, text) {
    const d = document.createElement("div");
    d.className = "m " + (role === "user" ? "u" : "a");
    d.textContent = (role === "user" ? "You: " : "Leo: ") + text;
    log.appendChild(d);
    return d;
  }

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById("i");
    const message = input.value.trim(); if (!message) return;
    input.value = "";
    line("user", message);
    const botLine = line("bot", "");

    const res = await fetch(WORKER + "/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sid, message, consent: { agreed: true, timestamp: new Date().toISOString() } }),
    });
    if (!res.ok || !res.body) { botLine.textContent = "Leo: [error " + res.status + "]"; return; }

    // Minimal SSE parser over the fetch stream.
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", reply = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const frames = buf.split("\n\n"); buf = frames.pop() || "";
      for (const frame of frames) {
        const ev = /event: (.*)/.exec(frame)?.[1];
        const data = /data: (.*)/.exec(frame)?.[1];
        if (!ev || !data) continue;
        const payload = JSON.parse(data);
        if (ev === "token") { reply += payload.text; botLine.textContent = "Leo: " + reply; }
        else if (ev === "done") { botLine.textContent = "Leo: " + (reply || payload.reply); if (payload.lead_saved) line("bot", "✅ lead saved"); }
        else if (ev === "lead") { /* lead frame; done follows */ }
        else if (ev === "error") { botLine.textContent = "Leo: [error] " + payload.message; }
      }
    }
  };
</script>
```

- [ ] **Step 2: Live smoke test (manual — the human runs this; needs a real GROQ_API_KEY)**

Run:
```bash
cd ~/Documents/ai-voice-bot/worker && npm run dev   # wrangler dev on :8787
```
Open `widget/demo.html`. Verify:
1. Type "Hi, I'm Alex" → Leo's reply **streams in token-by-token**.
2. Then ask "what's my name?" → Leo answers "Alex" (**memory works** — the DO held the prior turn).
3. **Reload the page**, ask "still remember me?" → Leo still knows (session_id persisted in localStorage → same DO).
4. Give name+email+message → a `✅ lead saved` line appears and the lead hits your webhook.

If `wrangler dev` errors on the Durable Object migration, confirm the `[[migrations]]` block uses `new_sqlite_classes` (free-tier) and that `SessionDO` is exported from `src/index.ts`.

- [ ] **Step 3: Commit**

```bash
cd ~/Documents/ai-voice-bot
git add widget/demo.html
git commit -m "feat(widget): demo.html consumes SSE and persists session_id for memory"
```

---

## Self-Review

**Spec coverage (v0.2a):**
- New `{ session_id, message, consent? }` → SSE contract (token/lead/done/error) — Tasks 3, 5. ✅
- Durable Object per session (SQLite-backed, free-tier migration) storing serialized history + lead + turns — Tasks 2, 4. ✅
- Load → run unchanged graph → save each turn; sticky lead/leadSaved — Task 5. ✅
- Streaming via a LangGraph adapter isolated from the tested SSE logic — Task 3. ✅
- Server-authoritative turn cap (429 from DO `turns`) + origin/length guards + CORS-safe error — Task 5. ✅
- Message serialization round-trip (incl. ai-tool-call → tool pairing) — Task 1. ✅
- demo.html SSE + session_id persistence; wrangler dev smoke — Task 6. ✅
- Node-testable core via injection (no workers test pool) — Tasks 1–3, 5 use fakes. ✅
- Free-tier only (SQLite DO migration, no paid bindings) — Global Constraints + Task 4. ✅

**Placeholder scan:** No TBD/TODO. The two intentionally-untested adapters (`makeGraphRunner` LangGraph streaming; `SessionDO` DO class) are explicitly covered by the Task 6 smoke test, and both are isolated behind interfaces the unit tests fully exercise with fakes.

**Type consistency:** `SessionState` shape identical across session-store.ts, index.ts persist, and the chat tests. `GraphFinal`/`GraphRunner`/`GraphStreamRun` identical across stream.ts and chat.test.ts. `SessionHandle` (index.ts) matches the DO's `load`/`save` RPC methods (session-do.ts) and the in-memory test fake. `Deps` (`buildModel`/`getSession`/`makeRunner`) matches `createApp`'s default and every test injection. `/chat` request `{ session_id, message, consent }` and SSE frame names match between index.ts, stream.ts, and demo.html.

---

*End of v0.2a plan. Next slices: v0.2b (the widget consuming this SSE contract) and v0.2c (voice).*
