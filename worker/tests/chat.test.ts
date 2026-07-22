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
    expect(body).toContain(`"text":"Hi "`);
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

  it("blocks repetitive spam after the threshold WITHOUT calling the model", async () => {
    // Pre-seed 7 identical prior user turns; the 8th (also identical) trips the 4x/low-diversity rule.
    const map = new Map<string, SessionState>([["s1", {
      messages: Array(7).fill(0).map(() => ({ role: "human" as const, content: "buy now" })),
      lead: {}, leadSaved: false, turns: 7,
    }]]);
    const getSession = (_e: Env, id: string): SessionHandle => ({
      load: async () => map.get(id)!, save: async (s) => void map.set(id, s),
    });
    const { seen, makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const body = await readSSE(await app.fetch(chatReq({ session_id: "s1", message: "buy now" }), env));
    expect(body).toContain("going in circles");           // the pause message was delivered
    expect(seen.length).toBe(0);                            // the model runner was NEVER called (no tokens)
    expect(map.get("s1")?.blocked).toBe(true);             // session is now sticky-blocked
  });

  it("a blocked session rejects further messages instantly without the model", async () => {
    const map = new Map<string, SessionState>([["s1", { messages: [], lead: {}, leadSaved: false, turns: 2, blocked: true }]]);
    const getSession = (_e: Env, id: string): SessionHandle => ({
      load: async () => map.get(id)!, save: async (s) => void map.set(id, s),
    });
    const { seen, makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const body = await readSSE(await app.fetch(chatReq({ session_id: "s1", message: "hello?" }), env));
    expect(body).toContain("going in circles");
    expect(seen.length).toBe(0);   // no model call -> no tokens spent
  });
});
