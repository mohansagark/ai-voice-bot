import { describe, it, expect } from "vitest";
import { sttSupported, createRecognizer } from "../../src/voice/stt";

interface Instance {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
}

function fakeCtor() {
  let last: Instance | null = null;
  function Ctor(this: Instance) {
    this.lang = ""; this.continuous = true; this.interimResults = true;
    this.onresult = null; this.onerror = null; this.onend = null;
    this.start = () => {}; this.stop = () => {};
    last = this;
  }
  return { Ctor: Ctor as unknown as new () => Instance, last: () => last! };
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
  it("returns null when unsupported", () => {
    expect(createRecognizer("en-US", { onResult() {}, onEnd() {}, onError() {} }, {})).toBeNull();
  });

  it("sets single-utterance mode and the requested language", () => {
    const { Ctor, last } = fakeCtor();
    createRecognizer("fr-FR", { onResult() {}, onEnd() {}, onError() {} }, { SpeechRecognition: Ctor });
    expect(last().lang).toBe("fr-FR");
    expect(last().continuous).toBe(false);
  });

  it("forwards a recognition result's transcript", () => {
    const { Ctor, last } = fakeCtor();
    const results: string[] = [];
    createRecognizer("en-US", { onResult: (t) => results.push(t), onEnd() {}, onError() {} }, { SpeechRecognition: Ctor });
    last().onresult!({ results: [[{ transcript: "hello there" }]] });
    expect(results).toEqual(["hello there"]);
  });

  it("forwards onend and onerror", () => {
    const { Ctor, last } = fakeCtor();
    let ended = false, errMsg = "";
    createRecognizer("en-US", { onResult() {}, onEnd: () => { ended = true; }, onError: (m) => { errMsg = m; } }, { SpeechRecognition: Ctor });
    last().onend!();
    last().onerror!({ error: "not-allowed" });
    expect(ended).toBe(true);
    expect(errMsg).toBe("not-allowed");
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
