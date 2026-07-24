# AI Voice Bot v0.2f — Proactive First-Visit Greeting — Technical Specification

**Version:** 1.0 (design/spec — no implementation yet)
**Date:** 2026-07-24
**Author:** Mohan Sagar K
**Status:** Approved design, ready for implementation

> Requested after local testing of v0.2e's conversation mode. Today the widget is entirely
> reactive — Leo only appears once the visitor taps the orb. This slice makes the first visit
> proactive: the panel auto-opens itself and Leo introduces itself out loud, without waiting for
> a click. Returning visitors are unaffected. No backend/agent changes; the separate concern of
> Leo's conversational tone/verbosity is explicitly deferred to its own future spec.

---

## 1. Goal

A first-time visitor currently has to notice the orb and click it before Leo says anything. This
slice makes Leo proactively open its own chat panel a short moment after page load and greet the
visitor — by voice, not just text — the first time (and only the first time) a given visitor lands
on the page. Every visit after that behaves exactly as today: the panel stays closed until the
visitor opens it themselves, and the existing "Welcome back" flow (v0.2b) covers that case.

---

## 2. Locked Decisions

| # | Area | Decision |
|---|------|----------|
| F1 | Trigger scope | Auto-open + speak fires **once per visitor, on their first-ever visit only** (tracked via a new persisted flag, §4). Every subsequent visit/reload behaves exactly as today — no auto-open, existing manual-open + "Welcome back" greeting (v0.2b) is unchanged. |
| F2 | Open timing | Not instant on load. A short delay (~1.8s) after mount, so the panel doesn't pop before the visitor has even seen the page. |
| F3 | Text vs. voice timing | The greeting **text** appears immediately when the delayed auto-open fires (reuses the existing `autoGreet` text-render path as-is, §5). The **spoken audio** is handled separately (§6) because browsers block unrequested audio playback until the visitor has interacted with the page at least once — text is not blocked by this, voice is. |
| F4 | Speak-by-default override | This one greeting **always speaks**, regardless of `voice.speakByDefault`/the mute toggle — showing off voice is the point of a proactive intro. Every reply after that continues to respect the existing mute/`speakByDefault` setting exactly as today; this override applies to this one utterance only. |
| F5 | Mic/conversation mode | Never auto-started. Only the panel opens and Leo talks; the visitor must still tap the mic themselves to reply by voice. Consistent with the existing rule that mic access always requires a direct user gesture. |
| F6 | Config surface | New `behavior.proactiveGreet: boolean`, default `true`. Auto-open only fires when **both** `autoGreet` and `proactiveGreet` are true, so an adopter who disables greeting text entirely can't end up with an auto-opened, empty-looking panel. |
| F7 | Focus behavior | The programmatic open does **not** steal focus into the text input (unlike a manual orb click, which still does, unchanged). Avoids yanking a mobile keyboard open or shifting scroll position for something the visitor didn't ask for. |
| F8 | Out of scope | Leo's conversational tone/verbosity (raised during design, explicitly deferred to a separate future spec). Any change to the greeting **text** itself. Any backend/agent change. |

---

## 3. `session.ts` — first-visit tracking

New persisted key, following the existing `avb_session`/`avb_name`/`avb_consent`/`avb_sound` pattern:

```ts
const K_VISITED = "avb_visited";
```

New `createSession()` methods:

```ts
hasVisitedBefore: (): boolean => store.get(K_VISITED) === "1",
markVisited: (): void => store.set(K_VISITED, "1"),
```

`forget()` is extended to also `store.remove(K_VISITED)`, so resetting a visitor's local data resets
this too. This flag is intentionally independent of `session.id()` (which lazily creates and persists
a session id the first time anything reads it) — checking `hasVisitedBefore()` at mount time, before
anything else touches the store, is what makes "first-ever visit" detectable at all.

---

## 4. Config (`types.ts`, `config.ts`)

```ts
behavior: { autoGreet: boolean; rememberReturning: boolean; language: string; proactiveGreet: boolean };
```

`DEFAULTS.behavior.proactiveGreet = true`. Merged into the raw config the same way every other
`behavior` field already is (`{ ...DEFAULTS.behavior, ...(r.behavior ?? {}) }` in `validateConfig` —
no new merge logic needed).

---

## 5. `orb.ts` — optional non-focusing open

```ts
open: (opts?: { focus?: boolean }) => setOpen(true, opts?.focus ?? true),
```

`setOpen` gains a second parameter (default `true`) that gates the existing
`if (open) refs.input.focus();` line. Every existing call site (`refs.orb.addEventListener("click", ...)`,
every current test calling `orb.open()`) passes no second argument and keeps focusing exactly as
today — this is additive and backward-compatible, not a behavior change for manual opens.

---

## 6. `voice/greet-on-interaction.ts` (new module) — speak-on-first-interaction

Mirrors the existing small-module pattern (`stt.ts`, `visualizer.ts`): real browser API behind
injectable deps, so it's unit-testable without a real page interaction.

```ts
export interface UserActivationLike { hasBeenActive: boolean; }
export interface InteractionDeps {
  userActivation?: UserActivationLike | null;
  addEventListener?: (type: string, cb: () => void, opts: { once: boolean; capture: boolean }) => void;
}

export function speakGreetingOnInteraction(speak: () => void, deps: InteractionDeps = {}): void;
```

- Reads `navigator.userActivation.hasBeenActive` (feature-detected; `deps.userActivation` overrides it
  for tests). This is a real, standard flag reporting whether the visitor has had **any** "sticky
  activation" on the page yet — if `true`, the visitor already interacted with the page (e.g. scrolled)
  before the ~1.8s delay elapsed, so `speak()` is called immediately, no need to wait further.
- If `false` or the API is unsupported (older/other browsers — treated the same as `false`, the safe
  default), attaches one-time `click`/`keydown`/`touchstart` listeners on `window` (capture phase,
  `{ once: true }` each). Whichever fires first calls `speak()`; a local `fired` guard makes the
  triple-listener setup safe even though all three are independently `once: true` (no double-speak,
  no leaked listeners).
- **Why not "try `speaker.speak()`, catch the rejection, then wait"** (the literal reading of the
  originally-discussed approach): `Speaker.speak()` (`voice/tts.ts`) never actually rejects — on a
  blocked/failed `audio.play()` it silently falls back to browser `speechSynthesis` internally and
  still resolves. There's no rejection to catch, so detecting "blocked by autoplay" has to happen
  *before* calling `speak()`, via `userActivation`, not by attempting and catching. Achieves the same
  intent (don't make the visitor wait for a fresh interaction if one already happened) without
  touching `tts.ts`'s existing, already-tested error/fallback handling.

---

## 7. `index.ts` — wiring

```ts
const PROACTIVE_OPEN_DELAY_MS = 1800;

if (cfg.behavior.autoGreet && cfg.behavior.proactiveGreet && !session.hasVisitedBefore()) {
  session.markVisited();
  setTimeout(() => {
    orb.open({ focus: false }); // reuses the existing !greeted && autoGreet text-render path for free
    if (cfg.voice.enabled && speaker) {
      speakGreetingOnInteraction(() => { void speaker!.speak(cfg.branding.greeting); });
    }
  }, PROACTIVE_OPEN_DELAY_MS);
}
```

Placed after `orb`/`speaker`/`session` are constructed. `orb.open({ focus: false })` triggers the
*existing* `wireOrb` `onToggle` callback unchanged — `emit(analytics, "open")`, then
`if (!greeted && cfg.behavior.autoGreet) { ...panel.startBotText(cfg.branding.greeting); greeted = true; }`
— no duplication of that text-selection logic. Since this path is only reachable on a guaranteed
first-ever visit, `session.name()` is guaranteed null, so the greeting text is always
`cfg.branding.greeting` (the "Welcome back" branch cannot apply here) — this is also why the spoken
text passed to `speakGreetingOnInteraction` can safely be `cfg.branding.greeting` directly rather than
re-deriving the panel's branch logic.

`session.markVisited()` is called synchronously at mount (not inside the `setTimeout`), so a visitor
who closes the tab within the 1.8s window still counts as "visited" and won't be re-prompted on their
next load — this is a deliberate one-shot-ever semantic (F1), not "retry until it successfully fires."

---

## 8. Testing

| Layer | Approach |
|-------|----------|
| `session.ts` | `hasVisitedBefore()` is `false` until `markVisited()` is called; `forget()` clears it. |
| `greet-on-interaction.ts` | With `userActivation: { hasBeenActive: true }` (injected), `speak()` is called synchronously, no listeners attached. With `hasBeenActive: false` (or omitted), `speak()` is not called until a fake `click`/`keydown`/`touchstart` event fires via the injected `addEventListener`; firing a second event after the first does not call `speak()` again. |
| `orb.ts` | `open()` with no args still focuses the input (existing behavior, regression check); `open({ focus: false })` opens the panel but does not call `refs.input.focus()`. |
| `index.ts` | Using fake timers (`vi.useFakeTimers()`): a fresh (never-visited) session auto-opens the panel and shows the greeting text after the delay elapses, without needing a click; a session with `avb_visited` already set does not auto-open. Voice path: with a fake `speaker` and `userActivation.hasBeenActive: true` injected, `speaker.speak()` is called with `cfg.branding.greeting` once the delay elapses — regardless of `soundOn`/`speakByDefault` (F4). |
| Manual/browser smoke | Clear site data, load the page fresh: panel opens on its own after a beat, greeting text appears, and (after any click/scroll/keypress if it didn't already happen) Leo's voice plays. Reload: panel stays closed until manually opened. |

---

## 9. Out of Scope (→ later)

- Leo's conversational tone/verbosity — separate future spec.
- Changing the greeting text itself.
- Auto-starting the mic/conversation mode on the proactive open.
- Any backend/agent change.

---

## 10. Risks

| # | Item | Mitigation |
|---|------|------------|
| R1 | `navigator.userActivation` isn't supported in every browser (notably older Safari) | Treated identically to `hasBeenActive: false` — falls back to waiting for a real interaction event, which works everywhere `addEventListener` does. Never blocks the text greeting either way (F3). |
| R2 | A visitor who never interacts with the page at all (rare, but possible — e.g. leaves the tab open unfocused) never hears the voice greeting | Acceptable: the text greeting already showed (F3); the voice greeting is a bonus, not the only signal Leo has spoken. No timeout/forced fallback added, to avoid ever autoplaying against the browser's own policy (which would just fail anyway). |
| R3 | Multiple tabs opened by the same first-time visitor in quick succession could each independently pass the `!session.hasVisitedBefore()` check before any of them calls `markVisited()` (a race on `localStorage`) | Low-impact: worst case is more than one tab proactively greets once each on that same first visit, not a repeat on later visits (each tab's synchronous `markVisited()` call still lands, so the *next* visit is correctly suppressed everywhere). Not worth cross-tab locking for a one-time cosmetic case. |

---

*End of v0.2f specification. Continues on `feat/v0.2d`, same as v0.2e.*
