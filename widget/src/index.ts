import { validateConfig } from "./config";
import type { WidgetConfig } from "./types";
import { mountShell, type Refs } from "./dom";
import { wireOrb } from "./orb";
import { wirePanel } from "./panel";
import { createSession, safeStore, type Store } from "./session";
import { sendChat } from "./client";
import { emit } from "./analytics";

export interface MountDeps { store?: Store; fetchImpl?: typeof fetch; }

export function mount(rawConfig: unknown, deps: MountDeps = {}): { refs: Refs } | null {
  const cfg: WidgetConfig | null = validateConfig(rawConfig);
  if (!cfg) return null;

  const store = deps.store ?? safeStore();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const session = createSession(store);
  const analytics = cfg.advanced.analyticsCallback;

  const refs = mountShell(cfg);
  const panel = wirePanel(refs);
  let greeted = false;

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

  const send = (text: string) => {
    emit(analytics, "message", { text });
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
          if (nm && cfg.behavior.rememberReturning) session.setName(nm.split(" ")[0]);
          panel.note("✓ sent to Mohan");
          emit(analytics, "lead", lead);
        },
        onDone: (reply) => { panel.endBot(line, reply); orb.setThinking(false); },
        onError: () => { line.remove(); panel.showError(); orb.setThinking(false); emit(analytics, "error"); },
        onBlocked: () => { line.remove(); orb.setThinking(false); emit(analytics, "blocked"); },
      },
      fetchImpl,
    );
  };

  panel.onSubmit((text: string) => {
    if (session.consent()) { send(text); return; }
    // First message: gate on consent, then send.
    panel.showConsent(cfg, () => { session.setConsent(cfg.privacy.consentText); send(text); });
  });

  return { refs };
}

// Auto-mount on load (skipped under test, which imports `mount` directly).
declare global { interface Window { AiVoiceBotConfig?: unknown; } }
if (typeof window !== "undefined" && window.AiVoiceBotConfig) mount(window.AiVoiceBotConfig);
