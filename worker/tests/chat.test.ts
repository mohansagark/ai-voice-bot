import { describe, it, expect } from "vitest";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { createApp, type SessionHandle } from "../src/index";
import { defaultPersona, type Env } from "../src/config";
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
function fakeRunnerFactory(
  tokens: string[],
  final: Omit<GraphFinal, "messages" | "uiComponent" | "leadJustSaved"> & { uiComponent?: string | null; leadJustSaved?: boolean },
) {
  const seen: BaseMessage[][] = [];
  const makeRunner = (_graph: unknown): GraphRunner => (messages) => {
    seen.push(messages);
    async function* gen() { for (const t of tokens) yield t; }
    return {
      tokens: gen(),
      final: Promise.resolve({
        uiComponent: null,
        leadJustSaved: final.leadSaved, // tests assume a save this turn unless overridden
        ...final,
        messages: [...messages, new AIMessage(final.reply)],
      }),
    };
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

  // Origins come from ALLOWED_ORIGINS (env) or synced KV app_config — every embed host must be listed
  // or the browser gets a CORS failure → widget "hiccup" message.
  it("allows each origin listed in a multi-host ALLOWED_ORIGINS CSV", async () => {
    const multiEnv = {
      GROQ_API_KEY: "x",
      ALLOWED_ORIGINS: "https://site.example,https://www.site.example,https://blog.site.example",
    } as unknown as Env;
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    for (const origin of ["https://www.site.example", "https://blog.site.example"]) {
      const req = new Request("https://w/chat", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ session_id: `s-${origin}`, message: "hi" }),
      });
      const res = await app.fetch(req, multiEnv);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("allows origins from synced KV app_config over empty env allowlist", async () => {
    const kvEnv = {
      GROQ_API_KEY: "x",
      ALLOWED_ORIGINS: "",
      PORTFOLIO_KV: {
        get: async (key: string) =>
          key === "app_config"
            ? JSON.stringify({
                allowedOrigins: ["https://blog.example.com"],
                persona: {
                  botName: "Leo",
                  owner: { name: "Sam", role: "Engineer" },
                  bio: "x",
                  tone: "warm",
                  facts: ["f"],
                  do_not: [],
                },
              })
            : null,
      },
    } as unknown as Env;
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const res = await app.fetch(
      new Request("https://w/chat", {
        method: "POST",
        headers: { origin: "https://blog.example.com", "content-type": "application/json" },
        body: JSON.stringify({ session_id: "kv-origin", message: "hi" }),
      }),
      kvEnv,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://blog.example.com");
  });

  // Regression: the allowlist moved from wrangler [vars] to synced KV, so "empty" is now a
  // reachable state (sync never ran, KV unbound, malformed blob). It must mean "deny", not "allow".
  it("denies every origin in prod when the allowlist is empty and KV has no app_config", async () => {
    const unsynced = { GROQ_API_KEY: "x", MODE: "prod", PORTFOLIO_KV: { get: async () => null } } as unknown as Env;
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    for (const path of ["/chat", "/lead", "/tts"]) {
      const res = await app.fetch(
        new Request(`https://w${path}`, {
          method: "POST",
          headers: { origin: "https://evil.example", "content-type": "application/json" },
          body: JSON.stringify({ session_id: "s1", message: "hi", text: "hi" }),
        }),
        unsynced,
      );
      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBe("null");
    }
  });

  it("denies an unlisted origin even when KV app_config is present", async () => {
    const kvEnv = {
      GROQ_API_KEY: "x",
      PORTFOLIO_KV: {
        get: async (key: string) =>
          key === "app_config" ? JSON.stringify({ allowedOrigins: ["https://good.example"] }) : null,
      },
    } as unknown as Env;
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const res = await app.fetch(
      new Request("https://w/chat", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ session_id: "s1", message: "hi" }),
      }),
      kvEnv,
    );
    expect(res.status).toBe(403);
  });

  it("ignores a KV-supplied mode:dev — content edits cannot disable enforcement", async () => {
    const kvEnv = {
      GROQ_API_KEY: "x",
      MODE: "prod",
      PORTFOLIO_KV: {
        get: async (key: string) =>
          key === "app_config"
            ? JSON.stringify({ allowedOrigins: ["https://good.example"], behavior: { mode: "dev" } })
            : null,
      },
    } as unknown as Env;
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const res = await app.fetch(
      new Request("https://w/chat", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ session_id: "s1", message: "hi" }),
      }),
      kvEnv,
    );
    expect(res.status).toBe(403);
  });

  it("/health reports bootstrap config so an unsynced deploy is visible", async () => {
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });

    const unsynced = await app.fetch(new Request("https://w/health"), { GROQ_API_KEY: "x", MODE: "prod" } as unknown as Env);
    const body = (await unsynced.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.config).toBe("bootstrap");
    expect(body.origins).toBe(0);
    expect(body.warning).toBeTruthy();

    const synced = await app.fetch(new Request("https://w/health"), {
      GROQ_API_KEY: "x",
      MODE: "prod",
      PORTFOLIO_KV: { get: async () => JSON.stringify({ allowedOrigins: ["https://good.example"] }) },
    } as unknown as Env);
    const okBody = (await synced.json()) as Record<string, unknown>;
    expect(okBody.ok).toBe(true);
    expect(okBody.config).toBe("kv");
    expect(okBody.origins).toBe(1);
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
    // Distinct from a generic rate-limit 429 so the widget can show a friendly, honest
    // message instead of the generic "something hiccuped" — this is a permanent per-session
    // cap, not a transient failure, and telling visitors to "try again" would be misleading.
    expect((await res.json() as any).limitReached).toBe(true);
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
    expect(body).toContain(defaultPersona.owner.name);      // owner name comes from persona config, not hardcoded
    expect(body).not.toContain("Mohan");                    // this test's env has no PERSONA_JSON — must not leak the real name
    expect(seen.length).toBe(0);                            // the model runner was NEVER called (no tokens)
    expect(map.get("s1")?.blocked).toBe(true);             // session is now sticky-blocked
  });

  it("a blocked session goes silent (429, no message, no model call)", async () => {
    const map = new Map<string, SessionState>([["s1", { messages: [], lead: {}, leadSaved: false, turns: 2, blocked: true }]]);
    const getSession = (_e: Env, id: string): SessionHandle => ({
      load: async () => map.get(id)!, save: async (s) => void map.set(id, s),
    });
    const { seen, makeRunner } = fakeRunnerFactory(["x"], { reply: "x", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const res = await app.fetch(chatReq({ session_id: "s1", message: "hello?" }), env);
    expect(res.status).toBe(429);
    expect(seen.length).toBe(0);   // no model call -> no tokens
  });
});

describe("/chat dev mode (guards bypassed)", () => {
  const devEnv = { GROQ_API_KEY: "x", WEBHOOK_URL: "https://hook.test/x", ALLOWED_ORIGINS: "https://devmohan.in", MODE: "dev" } as unknown as Env;

  it("allows a disallowed origin in dev", async () => {
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["hi"], { reply: "hi", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const req = new Request("https://w/chat", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ session_id: "s1", message: "hi" }) });
    const res = await app.fetch(req, devEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  it("allows an over-long message in dev", async () => {
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["hi"], { reply: "hi", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const res = await app.fetch(chatReq({ session_id: "s1", message: "a".repeat(3000) }), devEnv);
    expect(res.status).toBe(200);
  });

  it("responds normally to a blocked session in dev (spam guard off)", async () => {
    const map = new Map<string, SessionState>([["s1", { messages: [], lead: {}, leadSaved: false, turns: 2, blocked: true }]]);
    const getSession = (_e: Env, id: string): SessionHandle => ({ load: async () => map.get(id)!, save: async (s) => void map.set(id, s) });
    const { seen, makeRunner } = fakeRunnerFactory(["hi"], { reply: "hi", leadSaved: false, lead: {} });
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner });
    const res = await app.fetch(chatReq({ session_id: "s1", message: "hi" }), devEnv);
    expect(res.status).toBe(200);
    expect(seen.length).toBe(1);   // the model WAS called (guard bypassed)
  });

  it("/health reports the mode", async () => {
    const prod = await createApp().fetch(new Request("https://w/health"), env);
    expect((await prod.json() as any).mode).toBe("prod");
    const dev = await createApp().fetch(new Request("https://w/health"), devEnv);
    expect((await dev.json() as any).mode).toBe("dev");
  });

  it("fetches portfolio context via getPortfolioContext and doesn't fail the turn if it errors", async () => {
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["hi"], { reply: "hi", leadSaved: false, lead: {} });
    let called = false;
    const getPortfolioContext = async () => { called = true; throw new Error("KV down"); };
    const app = createApp({ buildModel: fakeBuildModel, getSession, makeRunner, getPortfolioContext });
    const res = await app.fetch(chatReq({ session_id: "s1", message: "hello" }), env);
    expect(res.status).toBe(200); // KV failure is non-fatal, same pattern as RAG's old graceful degradation
    expect(called).toBe(true);
  });

  it("builds an OpenRouter fallback model when OPENROUTER_API_KEY is set", async () => {
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["hi"], { reply: "hi", leadSaved: false, lead: {} });
    const providersSeen: (string | undefined)[] = [];
    const buildModel = ((_config: unknown, _env: unknown, provider?: string) => {
      providersSeen.push(provider);
      return { bindTools: () => ({ invoke: async () => new AIMessage("") }) };
    }) as any;
    const envWithFallback = { ...env, OPENROUTER_API_KEY: "or-x" } as unknown as Env;
    const app = createApp({ buildModel, getSession, makeRunner });
    const res = await app.fetch(chatReq({ session_id: "s1", message: "hello" }), envWithFallback);
    expect(res.status).toBe(200);
    expect(providersSeen).toContain("openrouter");
  });

  it("does not attempt an OpenRouter fallback build when OPENROUTER_API_KEY is unset", async () => {
    const { getSession } = memSessions();
    const { makeRunner } = fakeRunnerFactory(["hi"], { reply: "hi", leadSaved: false, lead: {} });
    const providersSeen: (string | undefined)[] = [];
    const buildModel = ((_config: unknown, _env: unknown, provider?: string) => {
      providersSeen.push(provider);
      return { bindTools: () => ({ invoke: async () => new AIMessage("") }) };
    }) as any;
    const app = createApp({ buildModel, getSession, makeRunner });
    const res = await app.fetch(chatReq({ session_id: "s1", message: "hello" }), env);
    expect(res.status).toBe(200);
    expect(providersSeen).not.toContain("openrouter");
  });
});
