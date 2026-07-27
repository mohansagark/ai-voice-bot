export interface TtsSuccess { ok: true; body: ArrayBuffer; contentType: string; }
export interface TtsFailure { ok: false; status: number; error: string; }
export type TtsResult = TtsSuccess | TtsFailure;

const DEEPGRAM_VOICE = "aura-2-thalia-en";

async function synthesizeGroq(
  text: string,
  voice: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<TtsResult> {
  try {
    const res = await fetchImpl("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "canopylabs/orpheus-v1-english", voice, input: text, response_format: "wav" }),
    });
    if (!res.ok) return { ok: false, status: res.status, error: `groq tts error ${res.status}` };
    const body = await res.arrayBuffer();
    return { ok: true, body, contentType: res.headers.get("content-type") || "audio/wav" };
  } catch (e) {
    return { ok: false, status: 502, error: String((e as Error).message) };
  }
}

async function synthesizeDeepgram(
  text: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<TtsResult> {
  try {
    const res = await fetchImpl(`https://api.deepgram.com/v1/speak?model=${DEEPGRAM_VOICE}&encoding=mp3`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Token ${apiKey}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return { ok: false, status: res.status, error: `deepgram tts error ${res.status}` };
    const body = await res.arrayBuffer();
    return { ok: true, body, contentType: res.headers.get("content-type") || "audio/mpeg" };
  } catch (e) {
    return { ok: false, status: 502, error: String((e as Error).message) };
  }
}

// Groq is primary (validated voice/tone for the persona). If it fails for any reason —
// rate limit, outage, network error — and a Deepgram key is configured, retry there rather
// than surfacing the failure straight to the visitor.
export async function synthesizeSpeech(
  text: string,
  voice: string,
  groqApiKey: string | undefined,
  deepgramApiKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<TtsResult> {
  if (groqApiKey) {
    const result = await synthesizeGroq(text, voice, groqApiKey, fetchImpl);
    if (result.ok || !deepgramApiKey) return result;
    return synthesizeDeepgram(text, deepgramApiKey, fetchImpl);
  }
  if (deepgramApiKey) return synthesizeDeepgram(text, deepgramApiKey, fetchImpl);
  return { ok: false, status: 502, error: "no tts provider configured" };
}
