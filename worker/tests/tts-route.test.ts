import { describe, it, expect } from "vitest";
import { createApp } from "../src/index";
import type { Env } from "../src/config";
import type { SessionState } from "../src/session-store";

// /tts never touches buildModel/getSession/makeRunner; these stubs just satisfy the Deps type.
const stubDeps = {
  buildModel: (() => ({ bindTools: () => ({ invoke: async () => ({}) }) })) as any,
  getSession: () => ({ load: async () => ({ messages: [], lead: {}, leadSaved: false, turns: 0 } as SessionState), save: async () => {} }),
  makeRunner: () => (() => ({ tokens: (async function* () {})(), final: Promise.resolve({ messages: [], leadSaved: false, lead: {} }) })) as any,
};

const env = { GROQ_API_KEY: "x", ALLOWED_ORIGINS: "https://devmohan.in" } as unknown as Env;
const ttsReq = (body: unknown, origin = "https://devmohan.in") =>
  new Request("https://w/tts", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("/tts", () => {
  it("returns audio bytes on a mocked Groq response", async () => {
    const fetchImpl = (async () => new Response(new Uint8Array([9, 9]), { status: 200, headers: { "content-type": "audio/wav" } })) as unknown as typeof fetch;
    const app = createApp({ ...stubDeps, fetchImpl });
    const res = await app.fetch(ttsReq({ text: "hi" }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
  });

  it("rejects a disallowed origin with 403 (prod)", async () => {
    const app = createApp({ ...stubDeps, fetchImpl: fetch });
    const res = await app.fetch(ttsReq({ text: "hi" }, "https://evil.example"), env);
    expect(res.status).toBe(403);
  });

  it("rejects empty text with 400", async () => {
    const app = createApp({ ...stubDeps, fetchImpl: fetch });
    const res = await app.fetch(ttsReq({ text: "" }), env);
    expect(res.status).toBe(400);
  });

  it("rejects over-cap text with 413", async () => {
    const app = createApp({ ...stubDeps, fetchImpl: fetch });
    const res = await app.fetch(ttsReq({ text: "a".repeat(1300) }), env);
    expect(res.status).toBe(413);
  });

  it("returns 502 when Groq fails", async () => {
    const fetchImpl = (async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    const app = createApp({ ...stubDeps, fetchImpl });
    const res = await app.fetch(ttsReq({ text: "hi" }), env);
    expect(res.status).toBe(502);
  });

  it("bypasses origin + length guards in dev mode", async () => {
    const devEnv = { ...env, MODE: "dev" } as unknown as Env;
    const fetchImpl = (async () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "audio/wav" } })) as unknown as typeof fetch;
    const app = createApp({ ...stubDeps, fetchImpl });
    const res = await app.fetch(ttsReq({ text: "a".repeat(1300) }, "https://evil.example"), devEnv);
    expect(res.status).toBe(200);
  });

  it("/health reports the tts provider from GROQ_API_KEY presence", async () => {
    const app = createApp({ ...stubDeps, fetchImpl: fetch });
    const withKey = await app.fetch(new Request("https://w/health"), env);
    expect((await withKey.json() as any).tts).toBe("groq");
    const noKeyEnv = { ...env, GROQ_API_KEY: undefined } as unknown as Env;
    const withoutKey = await app.fetch(new Request("https://w/health"), noKeyEnv);
    expect((await withoutKey.json() as any).tts).toBe("browser");
  });
});
