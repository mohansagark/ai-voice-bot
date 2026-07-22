// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { mount } from "../src/index";
import { memoryStore } from "../src/session";

function sse(event: string, data: unknown) { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
function streamRes(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const baseCfg = { workerUrl: "https://w.test", branding: { greeting: "Hi there!" } };

describe("mount", () => {
  it("stays dormant (no host element) when workerUrl is missing", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mount({}, { store: memoryStore(), fetchImpl: fetch });
    expect(app).toBeNull();
    expect(document.querySelector("[data-ai-voice-bot]")).toBeNull();
    err.mockRestore();
  });

  it("greets on open, then streams a reply after a consented send", async () => {
    const fetchImpl = (async () => streamRes([sse("token", { text: "He" }), sse("token", { text: "y" }), sse("done", { reply: "Hey", lead_saved: false })])) as unknown as typeof fetch;
    const app = mount(baseCfg, { store: memoryStore(), fetchImpl })!;
    app.refs.orb.click(); // open
    expect(app.refs.list.textContent).toContain("Hi there!"); // greeting
    // First send shows the consent gate; agree, then the message goes.
    app.refs.input.value = "hello";
    app.refs.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    const consentBtn = app.refs.list.querySelector(".consent button") as HTMLButtonElement;
    expect(consentBtn).toBeTruthy();
    consentBtn.click();
    // the user message is rendered immediately; wait a tick for the stream
    await new Promise((r) => setTimeout(r, 0));
    expect(app.refs.list.textContent).toContain("hello");
    expect(app.refs.list.textContent).toContain("Hey");
  });

  it("greets a returning visitor by stored name", () => {
    const store = memoryStore(); store.set("avb_name", "Alex");
    const app = mount(baseCfg, { store, fetchImpl: fetch })!;
    app.refs.orb.click();
    expect(app.refs.list.textContent).toContain("Welcome back, Alex");
  });
});
