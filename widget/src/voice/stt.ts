export interface RecognitionHandlers {
  onResult(text: string): void;
  onEnd(): void;
  onError(message: string): void;
}

interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string };
}
interface RecognitionResultList {
  length: number;
  [index: number]: RecognitionResult;
}
interface MinimalRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => MinimalRecognition;

function getCtor(w: unknown): RecognitionCtor | undefined {
  const obj = (w ?? {}) as Record<string, unknown>;
  return (obj.SpeechRecognition as RecognitionCtor | undefined) ?? (obj.webkitSpeechRecognition as RecognitionCtor | undefined);
}

export function sttSupported(w: unknown = typeof window !== "undefined" ? window : {}): boolean {
  return !!getCtor(w);
}

// How long to wait after the last speech activity (interim OR final) before we
// consider the user done talking and stop the recognizer ourselves. Without this,
// `continuous` mode never stops on its own, and single-shot mode cuts the user off
// at the first brief pause — truncating anything longer than a short phrase.
const SILENCE_TIMEOUT_MS = 1600;

export function createRecognizer(
  lang: string,
  handlers: RecognitionHandlers,
  w: unknown = typeof window !== "undefined" ? window : {},
  silenceMs = SILENCE_TIMEOUT_MS,
): { start(): void; stop(): void } | null {
  const Ctor = getCtor(w);
  if (!Ctor) return null;
  try {
    const rec = new Ctor();
    rec.lang = lang;
    // Continuous + interim so a mid-sentence pause doesn't truncate the utterance;
    // we decide when the user is "done" ourselves via the silence timer below.
    rec.continuous = true;
    rec.interimResults = true;

    let finalTranscript = "";
    let finalizedCount = 0;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    const clearSilenceTimer = () => {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    };

    rec.onresult = (e) => {
      for (let i = finalizedCount; i < e.results.length; i++) {
        const result = e.results[i];
        if (result?.isFinal) {
          finalTranscript += (finalTranscript ? " " : "") + (result[0]?.transcript ?? "");
          finalizedCount = i + 1;
        }
      }
      clearSilenceTimer();
      silenceTimer = setTimeout(() => { try { rec.stop(); } catch { /* already stopped */ } }, silenceMs);
    };
    rec.onerror = (e) => { clearSilenceTimer(); handlers.onError(e.error ?? "recognition error"); };
    rec.onend = () => {
      clearSilenceTimer();
      const text = finalTranscript.trim();
      finalTranscript = "";
      finalizedCount = 0;
      if (text) handlers.onResult(text);
      handlers.onEnd();
    };
    return {
      start: () => { finalTranscript = ""; finalizedCount = 0; rec.start(); },
      stop: () => { clearSilenceTimer(); rec.stop(); },
    };
  } catch {
    return null;
  }
}
