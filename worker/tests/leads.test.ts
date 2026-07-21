import { describe, it, expect, vi } from "vitest";
import { isValidEmail, postLead, type LeadPayload } from "../src/leads";

const payload: LeadPayload = {
  name: "Jane", email: "jane@example.com", message: "hi",
  phone: null, company: null, consent: { agreed: true }, meta: {},
};

describe("isValidEmail", () => {
  it("accepts a normal address", () => expect(isValidEmail("jane@example.com")).toBe(true));
  it("rejects a malformed address", () => expect(isValidEmail("nope")).toBe(false));
  it("rejects an address with no domain", () => expect(isValidEmail("a@b")).toBe(false));
});

describe("postLead", () => {
  it("POSTs JSON to the webhook and returns ok on 200", async () => {
    const fake = vi.fn<typeof fetch>(async () => new Response("ok", { status: 200 }));
    const res = await postLead("https://hook.test/x", payload, fake);
    expect(res).toEqual({ ok: true, status: 200 });
    expect(fake).toHaveBeenCalledOnce();
    const [, init] = fake.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).email).toBe("jane@example.com");
  });
  it("returns not-ok when the webhook throws", async () => {
    const fake = vi.fn(async () => { throw new Error("network"); });
    const res = await postLead("https://hook.test/x", payload, fake as any);
    expect(res).toEqual({ ok: false, status: 0 });
  });
});
