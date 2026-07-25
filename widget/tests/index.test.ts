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

  it("speaks the greeting on a manual orb click when sound is on", async () => {
    const cfg = { ...baseCfg, voice: { enabled: true, ttsVoice: "hannah", speakByDefault: true } };
    const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith("/tts")) return new Response("audio", { status: 200 });
      throw new Error("chat should not be called just from opening the panel");
    }) as unknown as typeof fetch;
    const app = mount(cfg, { store: memoryStore(), fetchImpl, makeAudio: () => audio })!;
    app.refs.orb.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(app.refs.list.textContent).toContain("Hi there!");
    expect(audio.played).toBe(true);
  });

  it("does not speak the greeting on a manual orb click when sound is off (muted)", async () => {
    const cfg = { ...baseCfg, voice: { enabled: true, ttsVoice: "hannah", speakByDefault: false } };
    const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith("/tts")) return new Response("audio", { status: 200 });
      throw new Error("chat should not be called just from opening the panel");
    }) as unknown as typeof fetch;
    const app = mount(cfg, { store: memoryStore(), fetchImpl, makeAudio: () => audio })!;
    app.refs.orb.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(app.refs.list.textContent).toContain("Hi there!");
    expect(audio.played).toBe(false);
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

  it("tap-to-talk: a second mic tap while listening turns conversation mode off (stops the recognizer)", () => {
    class FakeRecognition {
      static last: FakeRecognition | null = null;
      lang = ""; continuous = true; interimResults = true;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      startCalls = 0; stopCalls = 0;
      constructor() { FakeRecognition.last = this; }
      start() { this.startCalls++; }
      stop() { this.stopCalls++; }
    }
    (window as any).SpeechRecognition = FakeRecognition;
    try {
      const app = mount(baseCfg, { store: memoryStore(), fetchImpl: fetch })!;
      app.refs.mic.click(); // first tap — conversation mode on, starts listening
      expect(FakeRecognition.last!.startCalls).toBe(1);
      expect(app.refs.orb.classList.contains("listening")).toBe(true);
      app.refs.mic.click(); // second tap — turns conversation mode off
      expect(FakeRecognition.last!.stopCalls).toBe(1);
      expect(FakeRecognition.last!.startCalls).toBe(1); // still just the one start
    } finally {
      delete (window as any).SpeechRecognition;
    }
  });

  it("backgrounding the tab while listening releases the mic (avoids starving other tabs of the one active recognition session)", () => {
    class FakeRecognition {
      static last: FakeRecognition | null = null;
      lang = ""; continuous = true; interimResults = true;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      startCalls = 0; stopCalls = 0;
      constructor() { FakeRecognition.last = this; }
      start() { this.startCalls++; }
      stop() { this.stopCalls++; }
    }
    (window as any).SpeechRecognition = FakeRecognition;
    try {
      const app = mount(baseCfg, { store: memoryStore(), fetchImpl: fetch })!;
      app.refs.mic.click(); // conversation mode on, starts listening
      expect(app.refs.mic.getAttribute("aria-pressed")).toBe("true");
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(FakeRecognition.last!.stopCalls).toBe(1);
      expect(app.refs.mic.getAttribute("aria-pressed")).toBe("false");
      expect(app.refs.orb.classList.contains("listening")).toBe(false);
    } finally {
      delete (window as any).SpeechRecognition;
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
    }
  });

  it("conversation mode: after Leo's reply is generated and spoken, listening restarts automatically (no new tap)", async () => {
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
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/tts")) return new Response("audio", { status: 200 });
        return streamRes([sse("done", { reply: "Hey there", lead_saved: false })]);
      }) as unknown as typeof fetch;
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const app = mount(baseCfg, { store: memoryStore(), fetchImpl, makeAudio: () => audio })!;
      app.refs.orb.click();
      app.refs.mic.click(); // conversation mode on — tap 1
      const rec = FakeRecognition.last!;
      expect(rec.startCalls).toBe(1);
      rec.onresult!({ results: [[{ transcript: "what do you do" }]] });
      (app.refs.list.querySelector(".consent button") as HTMLButtonElement).click(); // first message still gates on consent
      await new Promise((r) => setTimeout(r, 0));
      expect(audio.played).toBe(true); // Leo is "speaking" the reply
      expect(rec.startCalls).toBe(1); // not yet restarted — still waiting for speech to finish
      audio.onended!(); // playback finishes -> speaker's onState fires "idle"
      expect(rec.startCalls).toBe(2); // listening restarted automatically, no new tap
    } finally {
      delete (window as any).SpeechRecognition;
    }
  });

  it("conversation mode: tapping the mic off before the reply finishes speaking prevents the auto-restart", async () => {
    class FakeRecognition {
      static last: FakeRecognition | null = null;
      lang = ""; continuous = true; interimResults = true;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      startCalls = 0; stopCalls = 0;
      constructor() { FakeRecognition.last = this; }
      start() { this.startCalls++; }
      stop() { this.stopCalls++; }
    }
    (window as any).SpeechRecognition = FakeRecognition;
    try {
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/tts")) return new Response("audio", { status: 200 });
        return streamRes([sse("done", { reply: "Hey there", lead_saved: false })]);
      }) as unknown as typeof fetch;
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const app = mount(baseCfg, { store: memoryStore(), fetchImpl, makeAudio: () => audio })!;
      app.refs.orb.click();
      app.refs.mic.click(); // conversation mode on
      const rec = FakeRecognition.last!;
      rec.onresult!({ results: [[{ transcript: "what do you do" }]] });
      (app.refs.list.querySelector(".consent button") as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
      app.refs.mic.click(); // taps off while Leo is still "speaking"
      audio.onended!(); // playback finishes after the tap-off
      expect(rec.startCalls).toBe(1); // no auto-restart — conversation mode was already off
    } finally {
      delete (window as any).SpeechRecognition;
    }
  });

  it("conversation mode: a stalled speech (never reaches idle) is recovered by the watchdog after 15s", async () => {
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
    vi.useFakeTimers();
    try {
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/tts")) return new Response("audio", { status: 200 });
        return streamRes([sse("done", { reply: "Hey there", lead_saved: false })]);
      }) as unknown as typeof fetch;
      // No makeAudio and no synth injected: the neural TTS response never becomes a
      // playable audio element with onended, and there's no browser-speech fallback --
      // so speaker's onState never reaches "idle" (verified directly against voice/tts.ts).
      const app = mount(baseCfg, { store: memoryStore(), fetchImpl, synth: null })!;
      app.refs.orb.click();
      app.refs.mic.click(); // conversation mode on — tap 1
      const rec = FakeRecognition.last!;
      expect(rec.startCalls).toBe(1);
      rec.onresult!({ results: [[{ transcript: "what do you do" }]] });
      (app.refs.list.querySelector(".consent button") as HTMLButtonElement).click(); // first message still gates on consent
      await vi.advanceTimersByTimeAsync(0); // let the streamed reply's onDone fire
      expect(rec.startCalls).toBe(1); // stalled: awaitingSpeechEnd is true but onState never reaches "idle"
      await vi.advanceTimersByTimeAsync(15000); // watchdog fires
      expect(rec.startCalls).toBe(2); // watchdog recovered listening without a manual toggle
    } finally {
      vi.useRealTimers();
      delete (window as any).SpeechRecognition;
    }
  });

  it("conversation mode: an empty/no-speech result keeps listening without going through send()", () => {
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
      app.refs.mic.click();
      const rec = FakeRecognition.last!;
      expect(rec.startCalls).toBe(1);
      rec.onresult!({ results: [[{ transcript: "   " }]] }); // whitespace-only -> treated as empty
      expect(rec.startCalls).toBe(2); // restarted immediately, no send() involved
      expect(app.refs.list.children.length).toBe(0); // nothing was sent/rendered
    } finally {
      delete (window as any).SpeechRecognition;
    }
  });

  it("first-time visitor: auto-opens the panel and speaks the greeting after a delay, regardless of the mute default", async () => {
    vi.useFakeTimers();
    try {
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/tts")) return new Response("audio", { status: 200 });
        throw new Error("chat should not be called by the proactive greeting");
      }) as unknown as typeof fetch;
      const app = mount(baseCfg, {
        store: memoryStore(),
        fetchImpl,
        makeAudio: () => audio,
        userActivation: { hasBeenActive: true },
      } as any)!;
      expect(app.refs.panel.getAttribute("data-open")).toBe("false"); // not yet — delay hasn't elapsed
      await vi.advanceTimersByTimeAsync(1800);
      expect(app.refs.panel.getAttribute("data-open")).toBe("true");
      expect(app.refs.list.textContent).toContain("Hi there!"); // baseCfg's greeting text
      await vi.advanceTimersByTimeAsync(0); // let the queued speak()'s fetch/play chain settle
      expect(audio.played).toBe(true); // spoke despite speakByDefault:false/soundOn default being off
    } finally {
      vi.useRealTimers();
    }
  });

  it("first-time visitor with sound already on: speaks the greeting exactly once, not twice (proactive + manual-open paths must not both fire)", async () => {
    vi.useFakeTimers();
    try {
      const cfg = { ...baseCfg, voice: { enabled: true, ttsVoice: "hannah", speakByDefault: true } };
      let ttsCalls = 0;
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/tts")) { ttsCalls++; return new Response("audio", { status: 200 }); }
        throw new Error("chat should not be called by the proactive greeting");
      }) as unknown as typeof fetch;
      mount(cfg, {
        store: memoryStore(),
        fetchImpl,
        makeAudio: () => audio,
        userActivation: { hasBeenActive: true },
      } as any)!;
      await vi.advanceTimersByTimeAsync(1800);
      await vi.advanceTimersByTimeAsync(0);
      expect(ttsCalls).toBe(1); // not 2 — the panel-opening path and the proactive path share one greeting event
    } finally {
      vi.useRealTimers();
    }
  });

  it("returning visitor: does not auto-open (avb_visited already set), but still proactively speaks", async () => {
    vi.useFakeTimers();
    try {
      const store = memoryStore();
      store.set("avb_visited", "1");
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/tts")) return new Response("audio", { status: 200 });
        throw new Error("chat should not be called by the proactive greeting");
      }) as unknown as typeof fetch;
      const app = mount(baseCfg, { store, fetchImpl, makeAudio: () => audio, userActivation: { hasBeenActive: true } } as any)!;
      await vi.advanceTimersByTimeAsync(5000); // well past the 1800ms delay
      expect(app.refs.panel.getAttribute("data-open")).toBe("false"); // panel-open is still a one-time-ever thing
      expect(audio.played).toBe(true); // but the voice greeting plays on this visit too
    } finally {
      vi.useRealTimers();
    }
  });

  it("speaks a greeting on every visit, not just the first-ever one (mounting twice against the same persisted store)", async () => {
    vi.useFakeTimers();
    try {
      const store = memoryStore();
      const speakCalls: string[] = [];
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const fetchImpl = (async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/tts")) { speakCalls.push(String(init?.body)); return new Response("audio", { status: 200 }); }
        throw new Error("chat should not be called by the proactive greeting");
      }) as unknown as typeof fetch;

      // First visit: fresh store — panel opens, generic greeting spoken.
      const app1 = mount(baseCfg, { store, fetchImpl, makeAudio: () => audio, userActivation: { hasBeenActive: true } } as any)!;
      await vi.advanceTimersByTimeAsync(1800);
      expect(app1.refs.panel.getAttribute("data-open")).toBe("true");
      expect(speakCalls.length).toBe(1);
      expect(speakCalls[0]).toContain("Hi there!");

      // Second visit against the same store (avb_visited now set): panel stays closed, but it speaks again.
      const app2 = mount(baseCfg, { store, fetchImpl, makeAudio: () => audio, userActivation: { hasBeenActive: true } } as any)!;
      await vi.advanceTimersByTimeAsync(1800);
      expect(app2.refs.panel.getAttribute("data-open")).toBe("false");
      expect(speakCalls.length).toBe(2);
      expect(speakCalls[1]).toContain("Hi there!");
    } finally {
      vi.useRealTimers();
    }
  });

  it("pre-existing visitor with a stored name (migration case): speaks 'Welcome back' without auto-opening the panel", async () => {
    vi.useFakeTimers();
    try {
      const store = memoryStore();
      store.set("avb_name", "Mohan"); // existing visitor from before this feature shipped — has a name, but avb_visited was never set
      let ttsBody: string | null = null;
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const fetchImpl = (async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/tts")) { ttsBody = String(init?.body); return new Response("audio", { status: 200 }); }
        throw new Error("chat should not be called by the proactive greeting");
      }) as unknown as typeof fetch;
      const app = mount(baseCfg, {
        store,
        fetchImpl,
        makeAudio: () => audio,
        userActivation: { hasBeenActive: true },
      } as any)!;
      await vi.advanceTimersByTimeAsync(1800);
      expect(app.refs.panel.getAttribute("data-open")).toBe("false"); // does NOT auto-open for a known returning visitor
      await vi.advanceTimersByTimeAsync(0);
      expect(audio.played).toBe(true); // still proactively speaks
      expect(ttsBody).toContain("Welcome back, Mohan!"); // the returning-visitor text, not the generic greeting
    } finally {
      vi.useRealTimers();
    }
  });

  it("returning visitor without a stored name (consented/chatted before, but never gave a name): speaks 'Welcome back!' with no name, without auto-opening the panel", async () => {
    vi.useFakeTimers();
    try {
      const store = memoryStore();
      // Has chatted before (consent was recorded), but never gave a name — distinct from a brand-new visitor.
      store.set("avb_consent", JSON.stringify({ agreed: true, timestamp: new Date().toISOString(), text: "ok" }));
      let ttsBody: string | null = null;
      const audio = { played: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, play: async () => { audio.played = true; }, pause: () => {} };
      const fetchImpl = (async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/tts")) { ttsBody = String(init?.body); return new Response("audio", { status: 200 }); }
        throw new Error("chat should not be called by the proactive greeting");
      }) as unknown as typeof fetch;
      const app = mount(baseCfg, {
        store,
        fetchImpl,
        makeAudio: () => audio,
        userActivation: { hasBeenActive: true },
      } as any)!;
      await vi.advanceTimersByTimeAsync(1800);
      expect(app.refs.panel.getAttribute("data-open")).toBe("false"); // does NOT auto-open for a returning visitor
      await vi.advanceTimersByTimeAsync(0);
      expect(audio.played).toBe(true); // still proactively speaks
      expect(ttsBody).toContain("Welcome back! What can I help with?"); // no name interpolated
      expect(ttsBody).not.toContain("Welcome back,"); // must not read like a name was about to follow
    } finally {
      vi.useRealTimers();
    }
  });

  it("sound toggle flips aria-pressed (muted state, not raw soundOn) and persists across remounts", () => {
    const store = memoryStore();
    const app1 = mount(baseCfg, { store, fetchImpl: fetch })!;
    // speakByDefault: false -> soundOn starts false (muted) -> aria-pressed (= muted) starts "true".
    expect(app1.refs.sound.getAttribute("aria-pressed")).toBe("true");
    app1.refs.sound.click(); // unmutes
    expect(app1.refs.sound.getAttribute("aria-pressed")).toBe("false");
    const app2 = mount(baseCfg, { store, fetchImpl: fetch })!;
    expect(app2.refs.sound.getAttribute("aria-pressed")).toBe("false");
  });

  it("aria-pressed/aria-label on the sound toggle track the muted state, not the raw soundOn flag", () => {
    const app = mount(baseCfg, { store: memoryStore(), fetchImpl: fetch })!;
    // Default (speakByDefault: false) starts muted: pressed=true, label reads "Unmute".
    expect(app.refs.sound.getAttribute("aria-pressed")).toBe("true");
    expect(app.refs.sound.getAttribute("aria-label")).toContain("Unmute");
    app.refs.sound.click(); // unmute
    expect(app.refs.sound.getAttribute("aria-pressed")).toBe("false");
    expect(app.refs.sound.getAttribute("aria-label")).toContain("Mute");
    expect(app.refs.sound.getAttribute("aria-label")).not.toContain("Unmute");
  });
});
