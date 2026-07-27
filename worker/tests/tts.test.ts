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
    const result = await synthesizeSpeech("hi", "hannah", "key", undefined, fake);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("audio/wav");
      expect(new Uint8Array(result.body)).toEqual(new Uint8Array([1, 2, 3]));
    }
  });

  it("forwards Groq's real status when it responds non-OK and no Deepgram key is configured", async () => {
    const fake = (async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "v", "key", undefined, fake);
    expect(result).toEqual({ ok: false, status: 500, error: "groq tts error 500" });
  });

  it("forwards a 429 rate-limit status distinctly (callers back off on this one)", async () => {
    const fake = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "v", "key", undefined, fake);
    expect(result).toEqual({ ok: false, status: 429, error: "groq tts error 429" });
  });

  it("returns a 502 failure on a network error with no Deepgram fallback configured", async () => {
    const fake = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "v", "key", undefined, fake);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("offline");
  });

  it("falls back to Deepgram when Groq fails and a Deepgram key is configured", async () => {
    let calls = 0;
    const fake = (async (url: string, init?: RequestInit) => {
      calls++;
      if (calls === 1) {
        expect(url).toBe("https://api.groq.com/openai/v1/audio/speech");
        return new Response("rate limited", { status: 429 });
      }
      expect(url).toBe("https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ text: "hi" });
      expect((init?.headers as Record<string, string>).authorization).toBe("Token dg-key");
      return new Response(new Uint8Array([4, 5]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "hannah", "groq-key", "dg-key", fake);
    expect(calls).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("audio/mpeg");
      expect(new Uint8Array(result.body)).toEqual(new Uint8Array([4, 5]));
    }
  });

  it("does not call Deepgram when Groq succeeds", async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "audio/wav" } });
    }) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "hannah", "groq-key", "dg-key", fake);
    expect(calls).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("forwards Deepgram's failure status when both providers fail", async () => {
    const fake = (async (url: string) => {
      if (String(url).includes("groq")) return new Response("bad", { status: 500 });
      return new Response("bad", { status: 503 });
    }) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "hannah", "groq-key", "dg-key", fake);
    expect(result).toEqual({ ok: false, status: 503, error: "deepgram tts error 503" });
  });

  it("uses Deepgram directly when no Groq key is configured", async () => {
    const fake = (async (url: string) => {
      expect(url).toBe("https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3");
      return new Response(new Uint8Array([7]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "hannah", undefined, "dg-key", fake);
    expect(result.ok).toBe(true);
  });

  it("fails cleanly when neither provider is configured", async () => {
    const fake = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    const result = await synthesizeSpeech("hi", "hannah", undefined, undefined, fake);
    expect(result).toEqual({ ok: false, status: 502, error: "no tts provider configured" });
  });
});
