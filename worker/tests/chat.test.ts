import { describe, it, expect } from "vitest";
import { createApp } from "../src/index";
import type { Env } from "../src/config";
import { buildModel } from "../src/providers";
import { AIMessage } from "@langchain/core/messages";

const env: Env = { GROQ_API_KEY: "x", WEBHOOK_URL: "https://hook.test/x", ALLOWED_ORIGINS: "https://devmohan.in" };

describe("/health", () => {
  it("reports ok with the active provider", async () => {
    const app = createApp();
    const res = await app.fetch(new Request("https://w/health"), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("groq");
    expect(body.model).toBe("llama-3.3-70b-versatile");
  });
});

// Inject a fake buildModel so no network call happens.
function fakeDeps(reply: AIMessage) {
  const model = { bindTools: () => ({ invoke: async () => reply }) };
  return { buildModel: (() => model) as unknown as typeof buildModel };
}
const allowed: Env = { GROQ_API_KEY: "x", WEBHOOK_URL: "https://hook.test/x", ALLOWED_ORIGINS: "https://devmohan.in" };
const origin = { headers: { origin: "https://devmohan.in", "content-type": "application/json" } };

function chatReq(body: unknown) {
  return new Request("https://w/chat", { method: "POST", headers: origin.headers, body: JSON.stringify(body) });
}

describe("/chat", () => {
  it("returns the agent reply", async () => {
    const app = createApp(fakeDeps(new AIMessage("Hi there!")));
    const res = await app.fetch(chatReq({ messages: [{ role: "user", content: "hello" }] }), allowed);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.reply).toContain("Hi there");
    expect(body.lead_saved).toBe(false);
  });

  it("rejects a disallowed origin with 403", async () => {
    const app = createApp(fakeDeps(new AIMessage("hi")));
    const req = new Request("https://w/chat", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.fetch(req, allowed);
    expect(res.status).toBe(403);
  });

  it("rejects an over-long message with 413", async () => {
    const app = createApp(fakeDeps(new AIMessage("hi")));
    const big = "a".repeat(3000);
    const res = await app.fetch(chatReq({ messages: [{ role: "user", content: big }] }), allowed);
    expect(res.status).toBe(413);
  });

  it("rejects an empty messages array with 400", async () => {
    const app = createApp(fakeDeps(new AIMessage("hi")));
    const res = await app.fetch(chatReq({ messages: [] }), allowed);
    expect(res.status).toBe(400);
  });

  it("rejects too many turns with 429", async () => {
    const app = createApp(fakeDeps(new AIMessage("hi")));
    const many = Array.from({ length: 31 }, (_, i) => ({ role: "user", content: `m${i}` }));
    const res = await app.fetch(chatReq({ messages: many }), allowed);
    expect(res.status).toBe(429);
  });

  it("returns a 502 JSON error (with CORS) when the model call fails", async () => {
    const throwingModel = { bindTools: () => ({ invoke: async () => { throw new Error("groq timeout"); } }) };
    const deps = { buildModel: (() => throwingModel) as unknown as typeof buildModel };
    const res = await createApp(deps).fetch(chatReq({ messages: [{ role: "user", content: "hi" }] }), allowed);
    expect(res.status).toBe(502);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://devmohan.in");
    const body = await res.json() as any;
    expect(typeof body.reply).toBe("string");
  });
});
