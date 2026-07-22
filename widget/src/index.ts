import { validateConfig } from "./config";
import type { WidgetConfig } from "./types";
import { mountShell, type Refs } from "./dom";
import { wireOrb } from "./orb";
import { wirePanel } from "./panel";
import { createSession, safeStore, type Store } from "./session";
import { sendChat } from "./client";
import { emit } from "./analytics";
import { sttSupported, createRecognizer } from "./voice/stt";
import { createSpeaker, shouldSpeak, type SynthLike, type AudioLike } from "./voice/tts";

export interface MountDeps {
  store?: Store;
  fetchImpl?: typeof fetch;
  synth?: SynthLike | null;
  makeAudio?: (res: Response) => AudioLike | Promise<AudioLike>;
}

export function mount(rawConfig: unknown, deps: MountDeps = {}): { refs: Refs } | null {
  const cfg: WidgetConfig | null = validateConfig(rawConfig);
  if (!cfg) return null;

  try {
    const store = deps.store ?? safeStore();
    const fetchImpl = deps.fetchImpl ?? fetch;
    const session = createSession(store);
    const analytics = cfg.advanced.analyticsCallback;

    const refs = mountShell(cfg);
    const panel = wirePanel(refs);
    let greeted = false;
    let consentPending = false;
    let pendingVoice = false;
    let listening = false;
    let soundOn = session.soundOn(cfg.voice.speakByDefault);

    const speaker = cfg.voice.enabled
      ? createSpeaker(
          { workerUrl: cfg.workerUrl, voice: cfg.voice.ttsVoice, lang: cfg.behavior.language },
          {
            fetchImpl,
            synth: "synth" in deps ? deps.synth : (typeof window !== "undefined" && "speechSynthesis" in window ? (window.speechSynthesis as unknown as SynthLike) : null),
            makeAudio: deps.makeAudio,
          },
        )
      : null;

    const orb = wireOrb(refs, (open) => {
      if (open) {
        emit(analytics, "open");
        if (!greeted && cfg.behavior.autoGreet) {
          const name = cfg.behavior.rememberReturning ? session.name() : null;
          panel.startBotText(name ? `Welcome back, ${name}! What can I help with?` : cfg.branding.greeting);
          greeted = true;
        }
      }
    });
    speaker?.onState((s) => orb.setSpeaking(s === "speaking"));

    const renderSound = () => {
      refs.sound.textContent = soundOn ? "🔊" : "🔇";
      refs.sound.setAttribute("aria-pressed", String(soundOn));
    };
    renderSound();
    if (!cfg.voice.enabled) refs.sound.style.display = "none";
    refs.sound.addEventListener("click", () => {
      soundOn = !soundOn;
      session.setSoundOn(soundOn);
      renderSound();
      if (!soundOn) speaker?.stop();
    });

    const send = (text: string, voiceInitiated = false) => {
      emit(analytics, "message", { text, voiceInitiated });
      speaker?.stop();
      panel.addUser(text);
      orb.setThinking(true);
      const line = panel.startBot();
      sendChat(
        cfg.workerUrl,
        { session_id: session.id(), message: text, consent: session.consent() ?? { agreed: false } },
        {
          onToken: (t) => panel.appendBot(line, t),
          onLead: (lead) => {
            const nm = (lead as { name?: string })?.name;
            if (nm && typeof nm === "string" && cfg.behavior.rememberReturning) session.setName(nm.split(" ")[0]);
            panel.note("✓ sent to Mohan");
            emit(analytics, "lead", lead);
          },
          onDone: (reply) => {
            panel.endBot(line, reply);
            orb.setThinking(false);
            if (shouldSpeak(voiceInitiated, soundOn)) speaker?.speak(reply);
          },
          onError: () => { line.remove(); panel.showError(); orb.setThinking(false); emit(analytics, "error"); },
          onBlocked: () => { line.remove(); orb.setThinking(false); emit(analytics, "blocked"); },
        },
        fetchImpl,
      );
    };

    panel.onSubmit((text: string) => {
      const voiceInitiated = pendingVoice;
      pendingVoice = false;
      if (session.consent()) { send(text, voiceInitiated); return; }
      if (consentPending) return;
      consentPending = true;
      panel.showConsent(cfg, () => { consentPending = false; session.setConsent(cfg.privacy.consentText); send(text, voiceInitiated); });
    });

    let recognizer: { start(): void; stop(): void } | null = null;
    const canUseMic = cfg.voice.enabled && sttSupported();
    if (canUseMic) {
      try {
        recognizer = createRecognizer(cfg.behavior.language, {
          onResult: (text) => {
            const t = text.trim();
            orb.setListening(false);
            if (!t) return;
            refs.input.value = t;
            pendingVoice = true;
            refs.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
          },
          onEnd: () => { listening = false; orb.setListening(false); },
          onError: () => { listening = false; orb.setListening(false); },
        });
      } catch {
        recognizer = null;
      }
    }
    if (!recognizer) {
      refs.mic.disabled = true;
      refs.mic.title = "voice input isn't available in this browser — type instead";
    } else {
      refs.mic.addEventListener("click", () => {
        if (listening) return; // already listening — ignore the repeat tap
        listening = true;
        orb.setListening(true);
        try {
          recognizer!.start();
        } catch {
          listening = false;
          orb.setListening(false);
        }
      });
    }

    return { refs };
  } catch (e) {
    console.error("[ai-voice-bot]", e);
    return null;
  }
}

// Auto-mount on load (skipped under test, which imports `mount` directly).
declare global { interface Window { AiVoiceBotConfig?: unknown; } }
if (typeof window !== "undefined" && window.AiVoiceBotConfig) mount(window.AiVoiceBotConfig);
