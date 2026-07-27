export interface SpeakerConfig { workerUrl: string; voice: string; lang: string; }
export type SpeakState = "idle" | "speaking";

export interface UtteranceLike { lang: string; onend: (() => void) | null; }
export interface SynthLike { speak(u: UtteranceLike): void; cancel(): void; }
export interface AudioLike { play(): Promise<void> | void; pause(): void; onended: (() => void) | null; onerror: ((e?: unknown) => void) | null; }

export interface SpeakerDeps {
  fetchImpl?: typeof fetch;
  synth?: SynthLike | null;
  makeUtterance?(text: string, lang: string): UtteranceLike;
  makeAudio?(res: Response): AudioLike | Promise<AudioLike>;
}

export interface Speaker {
  speak(text: string): Promise<void>;
  stop(): void;
  onState(cb: (s: SpeakState) => void): void;
}

export function shouldSpeak(voiceInitiated: boolean, soundOn: boolean): boolean {
  return voiceInitiated || soundOn;
}

// After Groq's TTS endpoint rate-limits us (429), don't keep re-hitting it on every
// subsequent turn in the same session — that just adds latency before falling back
// anyway, and hammers an endpoint that's already saying "back off." Skip straight to
// browser voice until this cools down.
const RATE_LIMIT_COOLDOWN_MS = 60_000;

export function createSpeaker(cfg: SpeakerConfig, deps: SpeakerDeps = {}): Speaker {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let stateCb: ((s: SpeakState) => void) | null = null;
  let currentAudio: AudioLike | null = null;
  let rateLimitedUntil = 0;
  const setState = (s: SpeakState) => stateCb?.(s);

  // Never throws: safe to call from a try block, a catch block, or a bare
  // event-handler callback (audio.onerror) regardless of what synth/utterance
  // dependency was injected.
  const speakBrowser = (text: string) => {
    try {
      if (!deps.synth) return;
      const utter: UtteranceLike = deps.makeUtterance
        ? deps.makeUtterance(text, cfg.lang)
        : (Object.assign(new SpeechSynthesisUtterance(text), { lang: cfg.lang }) as unknown as UtteranceLike);
      utter.onend = () => setState("idle");
      setState("speaking");
      deps.synth.speak(utter);
    } catch {
      setState("idle");
    }
  };

  return {
    async speak(text: string): Promise<void> {
      // A real playback error commonly fires BOTH audio.onerror AND rejects
      // the play() promise for the same failure; this guard ensures the
      // fallback only ever runs once per speak() call.
      let fellBack = false;
      const fallback = (reason: string) => {
        if (fellBack) return;
        fellBack = true;
        console.warn(`[ai-voice-bot] neural TTS fallback → browser voice: ${reason}`);
        speakBrowser(text);
      };
      if (Date.now() < rateLimitedUntil) {
        fallback(`skipping neural TTS — rate-limited until ${new Date(rateLimitedUntil).toISOString()}`);
        return;
      }
      try {
        const res = await fetchImpl(`${cfg.workerUrl}/tts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, voice: cfg.voice }),
        });
        if (!res.ok) {
          if (res.status === 429) rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
          const body = await res.text().catch(() => "");
          fallback(`/tts responded ${res.status}${body ? ` — ${body}` : ""}`);
          return;
        }
        const audio = deps.makeAudio
          ? await deps.makeAudio(res)
          : (new Audio(URL.createObjectURL(await res.blob())) as unknown as AudioLike);
        currentAudio = audio;
        audio.onended = () => setState("idle");
        audio.onerror = (e) => { setState("idle"); fallback(`audio playback error: ${String(e)}`); };
        setState("speaking");
        await audio.play();
      } catch (e) {
        fallback(`${(e as Error)?.name ?? "error"}: ${(e as Error)?.message ?? String(e)}`);
      }
    },
    stop(): void {
      currentAudio?.pause();
      deps.synth?.cancel();
      setState("idle");
    },
    onState(cb: (s: SpeakState) => void): void { stateCb = cb; },
  };
}
