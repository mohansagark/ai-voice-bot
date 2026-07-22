import { describe, it, expect } from "vitest";
import { createSession, memoryStore } from "../src/session";

describe("session", () => {
  it("creates and reuses a stable session id", () => {
    const store = memoryStore();
    const a = createSession(store).id();
    const b = createSession(store).id();
    expect(a).toBe(b);
    expect(a).toMatch(/[0-9a-f-]{10,}/);
  });

  it("stores and reads the visitor name", () => {
    const store = memoryStore();
    const s = createSession(store);
    expect(s.name()).toBeNull();
    s.setName("Alex");
    expect(createSession(store).name()).toBe("Alex");
  });

  it("records consent with a timestamp and text", () => {
    const s = createSession(memoryStore());
    expect(s.consent()).toBeNull();
    const c = s.setConsent("I agree");
    expect(c.agreed).toBe(true);
    expect(c.text).toBe("I agree");
    expect(typeof c.timestamp).toBe("string");
    expect(s.consent()?.agreed).toBe(true);
  });

  it("forget() clears id, name and consent", () => {
    const store = memoryStore();
    const s = createSession(store);
    s.setName("Alex"); s.setConsent("ok"); const first = s.id();
    s.forget();
    expect(s.name()).toBeNull();
    expect(s.consent()).toBeNull();
    expect(s.id()).not.toBe(first);   // a fresh id after forget
  });

  it("returns null (does not throw) on corrupted consent data", () => {
    const store = memoryStore();
    store.set("avb_consent", "{not valid json");
    expect(() => createSession(store).consent()).not.toThrow();
    expect(createSession(store).consent()).toBeNull();
  });
});
