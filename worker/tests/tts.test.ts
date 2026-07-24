import { describe, it, expect } from "vitest";
import { synthesizeSpeech } from "../src/tts";

describe("synthesizeSpeech", () => {
  it("returns audio bytes + content-type on a successful Groq response", async () => {
    const fake = (async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.groq.com/openai/v1/audio/speech");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ model: "canopylabs/orpheus-v1-english", voice: "hannah", input: "hi", response_format: "wav" });
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer key");
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/wav" } });
    }) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "hannah", "key", fake);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("audio/wav");
      expect(new Uint8Array(result.body)).toEqual(new Uint8Array([1, 2, 3]));
    }
  });

  it("returns a 502 failure when Groq responds non-OK", async () => {
    const fake = (async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "v", "key", fake);
    expect(result).toEqual({ ok: false, status: 502, error: "groq tts error 500" });
  });

  it("returns a 502 failure on a network error", async () => {
    const fake = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "v", "key", fake);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("offline");
  });
});
