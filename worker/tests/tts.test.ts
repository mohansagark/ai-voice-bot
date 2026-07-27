import { describe, it, expect } from "vitest";
import { synthesizeSpeech } from "../src/tts";

describe("synthesizeSpeech", () => {
  it("calls Google Cloud TTS with the expected shape and decodes the base64 audio", async () => {
    const fake = (async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://texttospeech.googleapis.com/v1/text:synthesize?key=my-key");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        input: { text: "hi" },
        voice: { languageCode: "en-US", name: "en-US-Wavenet-F" },
        audioConfig: { audioEncoding: "MP3" },
      });
      const audioContent = btoa("abc"); // stand-in bytes
      return new Response(JSON.stringify({ audioContent }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "en-US-Wavenet-F", "my-key", fake);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("audio/mpeg");
      expect(new TextDecoder().decode(result.body)).toBe("abc");
    }
  });

  it("forwards Google's real status when it responds non-OK", async () => {
    const fake = (async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "v", "key", fake);
    expect(result).toEqual({ ok: false, status: 500, error: "google tts error 500" });
  });

  it("forwards a 429 quota-exceeded status distinctly (callers back off on this one)", async () => {
    const fake = (async () => new Response("quota exceeded", { status: 429 })) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "v", "key", fake);
    expect(result).toEqual({ ok: false, status: 429, error: "google tts error 429" });
  });

  it("returns a 502 failure on a network error", async () => {
    const fake = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "v", "key", fake);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("offline");
  });

  it("returns a 502 failure when the response is OK but has no audioContent", async () => {
    const fake = (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "v", "key", fake);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(502);
  });
});
