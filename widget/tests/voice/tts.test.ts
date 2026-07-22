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
});
