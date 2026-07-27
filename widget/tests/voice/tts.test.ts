import { describe, it, expect } from "vitest";
import { createSpeaker, shouldSpeak, stripEmoji } from "../../src/voice/tts";

function fakeAudio() {
  const a = { played: false, paused: false, onended: null as (() => void) | null, onerror: null as (() => void) | null,
    play: async () => { a.played = true; }, pause: () => { a.paused = true; } };
  return a;
}

describe("shouldSpeak", () => {
  it("speaks when voice-initiated OR sound is on", () => {
    expect(shouldSpeak(true, false)).toBe(true);
    expect(shouldSpeak(false, true)).toBe(true);
    expect(shouldSpeak(true, true)).toBe(true);
    expect(shouldSpeak(false, false)).toBe(false);
  });
});

describe("stripEmoji", () => {
  const SMILE = String.fromCodePoint(0x1f604);
  const ROCKET = String.fromCodePoint(0x1f680);
  const HEART = String.fromCodePoint(0x2764) + String.fromCodePoint(0xfe0f); // base + variation selector-16
  const MAN_TECHNOLOGIST = String.fromCodePoint(0x1f468) + String.fromCharCode(0x200d) + String.fromCodePoint(0x1f4bb); // ZWJ-joined compound

  it("removes a simple emoji and trims resulting whitespace", () => {
    expect(stripEmoji(`Great to meet you ${SMILE}`)).toBe("Great to meet you");
  });

  it("removes multiple emoji anywhere in the text", () => {
    expect(stripEmoji(`${ROCKET} Let's go ${ROCKET}`)).toBe("Let's go");
  });

  it("removes emoji with a variation selector (e.g. heart)", () => {
    expect(stripEmoji(`I love this ${HEART} project`)).toBe("I love this project");
  });

  it("removes ZWJ-joined compound emoji fully, not just the first component", () => {
    expect(stripEmoji(`He's a ${MAN_TECHNOLOGIST} at heart`)).toBe("He's a at heart");
  });

  it("leaves plain text with no emoji untouched", () => {
    expect(stripEmoji("Hey there, happy to help!")).toBe("Hey there, happy to help!");
  });
});

describe("createSpeaker", () => {
  const cfg = { workerUrl: "https://w.test", voice: "hannah", lang: "en-US" };

  it("strips emoji before sending text to the neural TTS endpoint", async () => {
    const audio = fakeAudio();
    let sentText = "";
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sentText = JSON.parse(String(init?.body)).text;
      return new Response("bytes", { status: 200 });
    }) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, { fetchImpl, makeAudio: () => audio });
    await speaker.speak(`Great, all set! ${String.fromCodePoint(0x1f60a)}`);
    expect(sentText).toBe("Great, all set!");
  });

  it("strips emoji before the browser-synth fallback too", async () => {
    let utteranceText = "";
    const fakeSynth = { speak: (u: { onend: (() => void) | null }) => { u.onend?.(); }, cancel: () => {} };
    const fetchImpl = (async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, {
      fetchImpl,
      synth: fakeSynth,
      makeUtterance: (text) => { utteranceText = text; return { lang: "en-US", onend: null }; },
    });
    await speaker.speak(`Sounds good! ${String.fromCodePoint(0x1f680)}`);
    expect(utteranceText).toBe("Sounds good!");
  });

  it("plays the neural audio and reports speaking then idle", async () => {
    const audio = fakeAudio();
    const states: string[] = [];
    const fetchImpl = (async () => new Response("bytes", { status: 200 })) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, { fetchImpl, makeAudio: () => audio });
    speaker.onState((s) => states.push(s));
    await speaker.speak("Hi there");
    expect(audio.played).toBe(true);
    expect(states).toEqual(["speaking"]);
    audio.onended!();
    expect(states).toEqual(["speaking", "idle"]);
  });

  it("falls back to browser synth when /tts responds non-OK", async () => {
    const states: string[] = [];
    const spoken: string[] = [];
    const utterances: { lang: string; onend: (() => void) | null }[] = [];
    const synth = { speak: (u: { lang: string; onend: (() => void) | null }) => { spoken.push(u.lang); utterances.push(u); }, cancel: () => {} };
    const fetchImpl = (async () => new Response("bad", { status: 502 })) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, { fetchImpl, synth, makeUtterance: (text, lang) => ({ text, lang, onend: null } as any) });
    speaker.onState((s) => states.push(s));
    await speaker.speak("Hi there");
    expect(spoken).toEqual(["en-US"]);
    expect(states).toEqual(["speaking"]);
    utterances[0].onend!();
    expect(states).toEqual(["speaking", "idle"]);
  });

  it("stays silent (never 'speaking') when neither neural nor synth is available", async () => {
    const states: string[] = [];
    const fetchImpl = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, { fetchImpl });
    speaker.onState((s) => states.push(s));
    await speaker.speak("Hi there");
    expect(states).toEqual([]);
  });

  it("stop() pauses current audio and cancels synth", async () => {
    const audio = fakeAudio();
    const cancelled: boolean[] = [];
    const synth = { speak: () => {}, cancel: () => cancelled.push(true) };
    const fetchImpl = (async () => new Response("bytes", { status: 200 })) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, { fetchImpl, synth, makeAudio: () => audio });
    await speaker.speak("Hi there");
    speaker.stop();
    expect(audio.paused).toBe(true);
    expect(cancelled).toEqual([true]);
  });

  it("stop() reports idle after reaching speaking, so an observer (e.g. the orb) clears its 'speaking' state on mute-mid-playback", async () => {
    const audio = fakeAudio();
    const states: string[] = [];
    const fetchImpl = (async () => new Response("bytes", { status: 200 })) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, { fetchImpl, makeAudio: () => audio });
    speaker.onState((s) => states.push(s));
    await speaker.speak("Hi there");
    expect(states).toEqual(["speaking"]);
    speaker.stop();
    expect(states).toEqual(["speaking", "idle"]);
  });

  it("stop() is a safe no-op when nothing was ever speaking (still reports idle, no throw)", () => {
    const states: string[] = [];
    const speaker = createSpeaker(cfg, {});
    speaker.onState((s) => states.push(s));
    expect(() => speaker.stop()).not.toThrow();
    expect(states).toEqual(["idle"]);
  });

  it("never throws/rejects when the injected synth.speak() itself throws, and settles at idle", async () => {
    const states: string[] = [];
    const synth = {
      speak: () => { throw new Error("synth exploded"); },
      cancel: () => {},
    };
    const fetchImpl = (async () => new Response("bad", { status: 502 })) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, {
      fetchImpl,
      synth,
      makeUtterance: (text, lang) => ({ text, lang, onend: null } as any),
    });
    speaker.onState((s) => states.push(s));
    await expect(speaker.speak("Hi there")).resolves.toBeUndefined();
    expect(states[states.length - 1]).toBe("idle");
  });

  it("only falls back once when audio.onerror fires AND play() rejects for the same call", async () => {
    const spoken: string[] = [];
    const synth = { speak: (u: { lang: string }) => { spoken.push(u.lang); }, cancel: () => {} };
    const audio = {
      onended: null as (() => void) | null,
      onerror: null as ((e?: unknown) => void) | null,
      play: async () => { audio.onerror?.(); throw new Error("playback failed"); },
      pause: () => {},
    };
    const fetchImpl = (async () => new Response("bytes", { status: 200 })) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, {
      fetchImpl,
      synth,
      makeAudio: () => audio,
      makeUtterance: (text, lang) => ({ text, lang, onend: null } as any),
    });
    await speaker.speak("Hi there");
    expect(spoken).toEqual(["en-US"]);
  });

  it("after a 429, skips calling /tts on the next turn and goes straight to browser voice", async () => {
    const synth = { speak: () => {}, cancel: () => {} };
    let ttsCalls = 0;
    const fetchImpl = (async () => {
      ttsCalls++;
      return new Response("rate limited", { status: 429 });
    }) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, { fetchImpl, synth, makeUtterance: (text, lang) => ({ text, lang, onend: null } as any) });
    await speaker.speak("first");
    expect(ttsCalls).toBe(1); // first call still hits the network and discovers the 429
    await speaker.speak("second");
    expect(ttsCalls).toBe(1); // second call is skipped — still in cooldown
  });

  it("a non-429 failure does not trigger the rate-limit cooldown", async () => {
    const synth = { speak: () => {}, cancel: () => {} };
    let ttsCalls = 0;
    const fetchImpl = (async () => { ttsCalls++; return new Response("bad", { status: 500 }); }) as unknown as typeof fetch;
    const speaker = createSpeaker(cfg, { fetchImpl, synth, makeUtterance: (text, lang) => ({ text, lang, onend: null } as any) });
    await speaker.speak("first");
    await speaker.speak("second");
    expect(ttsCalls).toBe(2); // a plain 500 doesn't suppress the next attempt
  });
});
