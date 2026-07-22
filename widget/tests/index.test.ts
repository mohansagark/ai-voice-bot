// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { mount } from "../src/index";
import { memoryStore } from "../src/session";
import { sttSupported } from "../src/voice/stt";

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

  it("stores the visitor's first name and shows a note on a lead event", async () => {
    const store = memoryStore();
    const fetchImpl = (async () => streamRes([sse("lead", { lead: { name: "Alex Rivera" } }), sse("done", { reply: "Thanks!", lead_saved: true })])) as unknown as typeof fetch;
    const app = mount(baseCfg, { store, fetchImpl })!;
    app.refs.orb.click();
    app.refs.input.value = "hi";
    app.refs.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    (app.refs.list.querySelector(".consent button") as HTMLButtonElement).click(); // agree -> sends
    await new Promise((r) => setTimeout(r, 0));
    expect(store.get("avb_name")).toBe("Alex");
    expect(app.refs.list.textContent).toContain("✓ sent");
  });

  it("disables the mic when SpeechRecognition is unsupported (default test env)", () => {
    const app = mount(baseCfg, { store: memoryStore(), fetchImpl: fetch })!;
    expect(sttSupported()).toBe(false); // sanity: no SpeechRecognition in this test env
    expect(app.refs.mic.disabled).toBe(true);
  });

  it("tap-to-talk: mic result fills + sends, and the reply is spoken (voice-initiated)", async () => {
    class FakeRecognition {
      static last: FakeRecognition | null = null;
      lang = ""; continuous = true; interimResults = true;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { FakeRecognition.last = this; }
      start() {}
      stop() {}
    }
    (window as any).SpeechRecognition = FakeRecognition;
    try {
      const ttsCalls: string[] = [];
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/tts")) { ttsCalls.push(String(url)); return new Response("audio", { status: 200 }); }
        return streamRes([sse("done", { reply: "Hey there", lead_saved: false })]);
      }) as unknown as typeof fetch;
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const app = mount(baseCfg, { store: memoryStore(), fetchImpl, makeAudio: () => audio })!;
      expect(app.refs.mic.disabled).toBe(false);
      app.refs.orb.click(); // open panel so the input/consent flow is visible
      app.refs.mic.click(); // start listening — createRecognizer() constructed FakeRecognition.last at mount time
      expect(app.refs.orb.classList.contains("listening")).toBe(true);
      // Simulate the browser delivering a transcript on the actual recognizer instance index.ts is holding.
      FakeRecognition.last!.onresult!({ results: [[{ transcript: "what do you do" }]] });
      expect(app.refs.input.value).toBe(""); // panel's submit handler already cleared it
      const consentBtn = app.refs.list.querySelector(".consent button") as HTMLButtonElement;
      expect(consentBtn).toBeTruthy(); // first message still gates on consent, even from voice
      consentBtn.click();
      await new Promise((r) => setTimeout(r, 0));
      expect(app.refs.list.textContent).toContain("what do you do");
      expect(app.refs.list.textContent).toContain("Hey there");
      expect(ttsCalls.length).toBeGreaterThan(0);
      expect(audio.played).toBe(true);
    } finally {
      delete (window as any).SpeechRecognition;
    }
  });

  it("tap-to-talk: a second mic tap while still listening does not call start() again", () => {
    class FakeRecognition {
      static last: FakeRecognition | null = null;
      lang = ""; continuous = true; interimResults = true;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      startCalls = 0;
      constructor() { FakeRecognition.last = this; }
      start() { this.startCalls++; }
      stop() {}
    }
    (window as any).SpeechRecognition = FakeRecognition;
    try {
      const app = mount(baseCfg, { store: memoryStore(), fetchImpl: fetch })!;
      expect(app.refs.mic.disabled).toBe(false);
      app.refs.mic.click(); // first tap — starts listening
      expect(FakeRecognition.last!.startCalls).toBe(1);
      expect(app.refs.orb.classList.contains("listening")).toBe(true);
      // second tap before onresult/onend/onerror fires — the first session is still "running"
      app.refs.mic.click();
      expect(FakeRecognition.last!.startCalls).toBe(1); // guarded: start() was not called again
    } finally {
      delete (window as any).SpeechRecognition;
    }
  });

  it("sound toggle flips aria-pressed and persists across remounts", () => {
    const store = memoryStore();
    const app1 = mount(baseCfg, { store, fetchImpl: fetch })!;
    expect(app1.refs.sound.getAttribute("aria-pressed")).toBe("false");
    app1.refs.sound.click();
    expect(app1.refs.sound.getAttribute("aria-pressed")).toBe("true");
    const app2 = mount(baseCfg, { store, fetchImpl: fetch })!;
    expect(app2.refs.sound.getAttribute("aria-pressed")).toBe("true");
  });
});
