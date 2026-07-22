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
