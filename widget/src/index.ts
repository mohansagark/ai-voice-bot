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
import { createVisualizer, type VisualizerDeps } from "./voice/visualizer";
import { applyLevel } from "./voice/level-render";
import { speakGreetingOnInteraction, type InteractionDeps } from "./voice/greet-on-interaction";

export interface MountDeps {
  store?: Store;
  fetchImpl?: typeof fetch;
  synth?: SynthLike | null;
  makeAudio?: (res: Response) => AudioLike | Promise<AudioLike>;
  getUserMedia?: VisualizerDeps["getUserMedia"];
  AudioContextCtor?: VisualizerDeps["AudioContextCtor"];
  requestFrame?: VisualizerDeps["requestFrame"];
  cancelFrame?: VisualizerDeps["cancelFrame"];
  userActivation?: InteractionDeps["userActivation"];
  interactionAddEventListener?: InteractionDeps["addEventListener"];
}

const PROACTIVE_OPEN_DELAY_MS = 1800;

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
    let spokenGreeting = false;
    let consentPending = false;
    let pendingVoice = false;
    let listening = false;
    let conversationMode = false;
    let awaitingReply = false;
    let awaitingSpeechEnd = false;
    let speechWatchdog: ReturnType<typeof setTimeout> | null = null;
    let soundOn = session.soundOn(cfg.voice.speakByDefault);

    const clearSpeechWatchdog = () => {
      if (speechWatchdog !== null) {
        clearTimeout(speechWatchdog);
        speechWatchdog = null;
      }
    };

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

    const visualizer = createVisualizer(
      (level) => applyLevel(refs, level),
      { getUserMedia: deps.getUserMedia, AudioContextCtor: deps.AudioContextCtor, requestFrame: deps.requestFrame, cancelFrame: deps.cancelFrame },
    );

    // A visitor who has consented/chatted before but never gave a name is still a
    // returning visitor, distinct from a brand-new one — just not one we can greet by name.
    const isReturningVisitor = cfg.behavior.rememberReturning && session.consent() !== null;
    const greetingTextFor = (name: string | null): string =>
      name ? `Welcome back, ${name}! What can I help with?`
        : isReturningVisitor ? "Welcome back! What can I help with?"
        : cfg.branding.greeting;

    // The panel-open path and the proactive path can both want to speak the same greeting
    // (e.g. the proactive trigger opens the panel for a first-time visitor, which itself fires
    // the open-triggered greet-and-speak logic below) — this guard makes sure it's spoken once.
    const speakGreetingOnce = (text: string) => {
      if (spokenGreeting || !speaker) return;
      spokenGreeting = true;
      void speaker.speak(text);
    };

    const orb = wireOrb(refs, (open) => {
      if (open) {
        emit(analytics, "open");
        if (!greeted && cfg.behavior.autoGreet) {
          const name = cfg.behavior.rememberReturning ? session.name() : null;
          const text = greetingTextFor(name);
          panel.startBotText(text);
          greeted = true;
          if (cfg.voice.enabled && shouldSpeak(false, soundOn)) speakGreetingOnce(text);
        }
      }
    });
    if (cfg.behavior.autoGreet && cfg.behavior.proactiveGreet) {
      // The panel auto-opens at most once, ever, on a visitor's true first encounter with the
      // site — but the proactive spoken greeting happens on every visit, first or returning.
      const isFirstEverVisit = !session.hasVisitedBefore();
      session.markVisited();
      const knownName = cfg.behavior.rememberReturning ? session.name() : null;
      setTimeout(() => {
        if (isFirstEverVisit && !knownName && !isReturningVisitor) orb.open({ focus: false });
        if (cfg.voice.enabled && speaker) {
          speakGreetingOnInteraction(() => speakGreetingOnce(greetingTextFor(knownName)), {
            userActivation: deps.userActivation,
            addEventListener: deps.interactionAddEventListener,
          });
        }
      }, PROACTIVE_OPEN_DELAY_MS);
    }
    speaker?.onState((s) => {
      orb.setSpeaking(s === "speaking");
      if (s === "idle" && awaitingSpeechEnd) {
        clearSpeechWatchdog();
        awaitingSpeechEnd = false;
        if (conversationMode) startListening();
      }
    });

    const renderSound = () => {
      refs.sound.textContent = soundOn ? "🔊" : "🔇";
      refs.sound.setAttribute("aria-pressed", String(!soundOn));
      refs.sound.setAttribute(
        "aria-label",
        soundOn ? `Mute ${cfg.branding.botName}'s voice` : `Unmute ${cfg.branding.botName}'s voice`,
      );
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
      awaitingSpeechEnd = false; // cancel any pending restart tied to a previous, now-stale turn
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
            panel.note("✓ sent");
            emit(analytics, "lead", lead);
          },
          onDone: (reply) => {
            panel.endBot(line, reply);
            orb.setThinking(false);
            awaitingReply = false;
            if (shouldSpeak(voiceInitiated, soundOn) && speaker) {
              awaitingSpeechEnd = true;
              clearSpeechWatchdog();
              // Watchdog: if speaker's onState never reaches "idle" (e.g. neural TTS
              // failed AND the browser speechSynthesis fallback is unavailable), don't
              // let conversation mode stall forever waiting for a signal that never comes.
              speechWatchdog = setTimeout(() => {
                clearSpeechWatchdog();
                if (awaitingSpeechEnd) {
                  awaitingSpeechEnd = false;
                  if (conversationMode) startListening();
                }
              }, 15000);
              speaker.speak(reply); // fire-and-forget; onState("idle") above triggers the restart
            } else if (conversationMode) {
              startListening();
            }
          },
          onError: () => {
            line.remove(); panel.showError(); orb.setThinking(false); emit(analytics, "error");
            awaitingReply = false;
            if (conversationMode) startListening();
          },
          onBlocked: () => {
            line.remove(); orb.setThinking(false); emit(analytics, "blocked");
            awaitingReply = false;
            if (conversationMode) startListening();
          },
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

    const setListeningVisual = (on: boolean) => {
      orb.setListening(on);
      refs.form.classList.toggle("listening", on);
      refs.mic.classList.toggle("listening", on);
    };

    let recognizer: { start(): void; stop(): void } | null = null;

    const startListening = () => {
      if (listening || !recognizer) return;
      listening = true;
      setListeningVisual(true);
      visualizer.start();
      try {
        recognizer.start();
      } catch {
        listening = false;
        setListeningVisual(false);
        visualizer.stop();
      }
    };

    const stopListeningVisual = () => {
      listening = false;
      setListeningVisual(false);
      visualizer.stop();
    };

    const canUseMic = cfg.voice.enabled && sttSupported();
    if (canUseMic) {
      try {
        recognizer = createRecognizer(cfg.behavior.language, {
          onResult: (text) => {
            stopListeningVisual();
            const t = text.trim();
            if (!t) { if (conversationMode) startListening(); return; }
            awaitingReply = true;
            refs.input.value = t;
            pendingVoice = true;
            refs.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
          },
          onEnd: () => {
            stopListeningVisual();
            if (conversationMode && !awaitingReply) startListening();
          },
          onError: () => {
            stopListeningVisual();
            if (conversationMode && !awaitingReply) startListening();
          },
        });
      } catch {
        recognizer = null;
      }
    }
    const stopConversationMode = () => {
      conversationMode = false;
      refs.mic.setAttribute("aria-pressed", "false");
      if (listening) {
        try { recognizer!.stop(); } catch { /* onEnd still fires and cleans up */ }
        stopListeningVisual(); // don't rely solely on onEnd to stop the mic visualizer
      }
    };

    if (!recognizer) {
      refs.mic.disabled = true;
      refs.mic.title = "voice input isn't available in this browser — type instead";
    } else {
      refs.mic.setAttribute("aria-pressed", "false");
      refs.mic.addEventListener("click", () => {
        if (conversationMode) { stopConversationMode(); return; }
        conversationMode = true;
        refs.mic.setAttribute("aria-pressed", String(conversationMode));
        startListening();
      });
      // A backgrounded tab left in conversation mode holds the mic (Chrome's
      // SpeechRecognition only supports one active session per browser process),
      // silently starving any other tab's attempt to listen. Release it on hide.
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && conversationMode) stopConversationMode();
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
