export interface TtsSuccess { ok: true; body: ArrayBuffer; contentType: string; }
export interface TtsFailure { ok: false; status: number; error: string; }
export type TtsResult = TtsSuccess | TtsFailure;

export async function synthesizeSpeech(
  text: string,
  voice: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<TtsResult> {
  try {
    const res = await fetchImpl("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "playai-tts", voice, input: text, response_format: "wav" }),
    });
    if (!res.ok) return { ok: false, status: 502, error: `groq tts error ${res.status}` };
    const body = await res.arrayBuffer();
    return { ok: true, body, contentType: res.headers.get("content-type") || "audio/wav" };
  } catch (e) {
    return { ok: false, status: 502, error: String((e as Error).message) };
  }
}
