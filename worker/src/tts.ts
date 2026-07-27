export interface TtsSuccess { ok: true; body: ArrayBuffer; contentType: string; }
export interface TtsFailure { ok: false; status: number; error: string; }
export type TtsResult = TtsSuccess | TtsFailure;

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function synthesizeSpeech(
  text: string,
  voice: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<TtsResult> {
  try {
    const res = await fetchImpl(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: "en-US", name: voice },
          audioConfig: { audioEncoding: "MP3" },
        }),
      },
    );
    // Forward Google's real status (esp. 429 quota-exceeded) instead of collapsing
    // every upstream failure into a generic 502 — the caller needs to tell "out of
    // quota, back off" apart from "actually broken."
    if (!res.ok) return { ok: false, status: res.status, error: `google tts error ${res.status}` };
    const data = (await res.json()) as { audioContent?: string };
    if (!data.audioContent) return { ok: false, status: 502, error: "google tts: no audioContent in response" };
    return { ok: true, body: base64ToArrayBuffer(data.audioContent), contentType: "audio/mpeg" };
  } catch (e) {
    return { ok: false, status: 502, error: String((e as Error).message) };
  }
}
