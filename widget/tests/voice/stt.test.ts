import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sttSupported, createRecognizer } from "../../src/voice/stt";

interface FakeResult { isFinal: boolean; 0: { transcript: string }; }
interface Instance {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { results: FakeResult[] }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
}

function fakeCtor() {
  let last: Instance | null = null;
  function Ctor(this: Instance) {
    this.lang = ""; this.continuous = true; this.interimResults = true;
    this.onresult = null; this.onerror = null; this.onend = null;
    this.start = () => {}; this.stop = () => { this.onend?.(); };
    last = this;
  }
  return { Ctor: Ctor as unknown as new () => Instance, last: () => last! };
}

function finalResult(transcript: string): FakeResult {
  return { isFinal: true, 0: { transcript } };
}
function interimResult(transcript: string): FakeResult {
  return { isFinal: false, 0: { transcript } };
}

describe("sttSupported", () => {
  it("is false when neither SpeechRecognition constructor exists", () => {
    expect(sttSupported({})).toBe(false);
  });
  it("is true when webkitSpeechRecognition exists", () => {
    expect(sttSupported({ webkitSpeechRecognition: function () {} })).toBe(true);
  });
  it("is true when SpeechRecognition exists", () => {
    expect(sttSupported({ SpeechRecognition: function () {} })).toBe(true);
  });
});

describe("createRecognizer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns null when unsupported", () => {
    expect(createRecognizer("en-US", { onResult() {}, onEnd() {}, onError() {} }, {})).toBeNull();
  });

  it("sets continuous + interim mode (survives mid-sentence pauses) and the requested language", () => {
    const { Ctor, last } = fakeCtor();
    createRecognizer("fr-FR", { onResult() {}, onEnd() {}, onError() {} }, { SpeechRecognition: Ctor });
    expect(last().lang).toBe("fr-FR");
    expect(last().continuous).toBe(true);
    expect(last().interimResults).toBe(true);
  });

  it("delivers the full accumulated transcript on end, not just the first fragment", () => {
    const { Ctor, last } = fakeCtor();
    const results: string[] = [];
    createRecognizer("en-US", { onResult: (t) => results.push(t), onEnd() {}, onError() {} }, { SpeechRecognition: Ctor })!.start();
    // Simulate a user pausing mid-sentence: two final segments before recognition ends.
    last().onresult!({ results: [finalResult("tell me about")] });
    last().onresult!({ results: [finalResult("tell me about"), finalResult("the expense tracker")] });
    last().onend!();
    expect(results).toEqual(["tell me about the expense tracker"]);
  });

  it("does not call onResult when nothing was ever finalized", () => {
    const { Ctor, last } = fakeCtor();
    const results: string[] = [];
    createRecognizer("en-US", { onResult: (t) => results.push(t), onEnd() {}, onError() {} }, { SpeechRecognition: Ctor })!.start();
    last().onresult!({ results: [interimResult("uh")] });
    last().onend!();
    expect(results).toEqual([]);
  });

  it("stops itself after a period of silence following the last result", () => {
    const { Ctor, last } = fakeCtor();
    let ended = false;
    const stopSpy = vi.fn();
    createRecognizer("en-US", { onResult() {}, onEnd: () => { ended = true; }, onError() {} }, { SpeechRecognition: Ctor })!.start();
    last().stop = stopSpy;
    last().onresult!({ results: [finalResult("hi there")] });
    expect(ended).toBe(false);
    vi.advanceTimersByTime(1600);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("resets the silence timer on every new result instead of stopping early", () => {
    const { Ctor, last } = fakeCtor();
    const stopSpy = vi.fn();
    createRecognizer("en-US", { onResult() {}, onEnd() {}, onError() {} }, { SpeechRecognition: Ctor })!.start();
    last().stop = stopSpy;
    last().onresult!({ results: [interimResult("tell")] });
    vi.advanceTimersByTime(1000);
    last().onresult!({ results: [interimResult("tell me")] }); // more speech before the 1600ms timeout
    vi.advanceTimersByTime(1000);
    expect(stopSpy).not.toHaveBeenCalled(); // total silence since last activity is only 1000ms
    vi.advanceTimersByTime(600);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("forwards onerror and clears the pending silence timer", () => {
    const { Ctor, last } = fakeCtor();
    let errMsg = "";
    createRecognizer("en-US", { onResult() {}, onEnd() {}, onError: (m) => { errMsg = m; } }, { SpeechRecognition: Ctor })!.start();
    last().onresult!({ results: [interimResult("hi")] });
    last().onerror!({ error: "not-allowed" });
    expect(errMsg).toBe("not-allowed");
  });

  it("forwards onend even with no result", () => {
    const { Ctor, last } = fakeCtor();
    let ended = false;
    createRecognizer("en-US", { onResult() {}, onEnd: () => { ended = true; }, onError() {} }, { SpeechRecognition: Ctor })!.start();
    last().onend!();
    expect(ended).toBe(true);
  });

  it("start()/stop() delegate to the underlying instance", () => {
    const { Ctor, last } = fakeCtor();
    let started = false, stopped = false;
    const wrapper = createRecognizer("en-US", { onResult() {}, onEnd() {}, onError() {} }, { SpeechRecognition: Ctor })!;
    last().start = () => { started = true; };
    last().stop = () => { stopped = true; };
    wrapper.start();
    wrapper.stop();
    expect(started).toBe(true);
    expect(stopped).toBe(true);
  });

  it("returns null when constructor throws", () => {
    function throwingCtor() {
      throw new Error("Construction forbidden by browser policy");
    }
    const result = createRecognizer("en-US", { onResult() {}, onEnd() {}, onError() {} }, { SpeechRecognition: throwingCtor as unknown as new () => Instance });
    expect(result).toBeNull();
  });
});
