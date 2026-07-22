export interface RecognitionHandlers {
  onResult(text: string): void;
  onEnd(): void;
  onError(message: string): void;
}

interface MinimalRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
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

export function createRecognizer(
  lang: string,
  handlers: RecognitionHandlers,
  w: unknown = typeof window !== "undefined" ? window : {},
): { start(): void; stop(): void } | null {
  const Ctor = getCtor(w);
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = false;
  rec.onresult = (e) => handlers.onResult(e.results[0]?.[0]?.transcript ?? "");
  rec.onerror = (e) => handlers.onError(e.error ?? "recognition error");
  rec.onend = () => handlers.onEnd();
  return { start: () => rec.start(), stop: () => rec.stop() };
}
