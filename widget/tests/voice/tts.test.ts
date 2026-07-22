import { describe, it, expect } from "vitest";
import { createSpeaker, shouldSpeak } from "../../src/voice/tts";

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

describe("createSpeaker", () => {
  const cfg = { workerUrl: "https://w.test", voice: "Fritz-PlayAI", lang: "en-US" };

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
});
