# Widget Panel Open/Close Animation — Technical Specification

**Version:** 1.0 (design/spec — no implementation yet)
**Date:** 2026-07-25
**Author:** Mohan Sagar K
**Status:** Approved design, ready for implementation

> Deferred from earlier in this session ("save this for later" — smooth animations for chat window
> open/close and message entry). Message entry already has an animation (`.msg-enter`, added in the
> v0.2d redesign) — this slice covers the one real gap: the panel itself currently opens/closes as an
> instant `display: none`/`flex` snap, with zero transition.

---

## 1. Goal

Give the chat panel a smooth open/close transition instead of the current instant snap, using the
same lightweight, dependency-free, pure-CSS approach as every other animation already in this widget
(`.msg-enter`, the orb's idle/thinking/listening/speaking animations) — no JS timing logic, no new
runtime dependency, consistent with the widget's zero-runtime-deps design.

---

## 2. Locked Decisions

| # | Area | Decision |
|---|------|----------|
| A1 | Scope | Panel open/close only. The existing message-entrance animation (`.msg-enter`) is untouched. |
| A2 | Motion | Fade (opacity 0→1) + scale (0.96→1) + slide (`translateY` 14px→0), 220ms, `ease` timing — mirrors the character of the existing `.msg-enter` animation (`opacity` + `translateY`, `.2s ease-out`) for visual consistency across the widget, with a touch of scale added since the panel is a much larger surface than a single message line. |
| A3 | Symmetry | Close reverses the same transition, same 220ms duration — no separate faster/slower close timing (kept simple; revisit only if it feels wrong in practice). |
| A4 | Transform origin | Anchored at the corner nearest the orb (`bottom right` for `pos-right`, `bottom left` for `pos-left`) rather than the panel's center — the panel visually "grows from" the orb it's attached to, matching where the visitor's attention already is. |
| A5 | Mechanism | Pure CSS, no JS changes. The panel stays `display: flex` at all times (dropping the current `display: none` default); closed/open state is instead driven by `opacity` + `transform` + `visibility` + `pointer-events`, with `visibility` transitioning with a `0s` delay timed to the animation duration — a standard, well-established pattern (used by Bootstrap, MUI, etc.) for animating an element that also needs to be fully non-interactive and hidden from assistive tech when "closed". `orb.ts`'s `setOpen`/`data-open` attribute logic is completely unchanged — this is a CSS-only reinterpretation of the same attribute. |
| A6 | Reduced motion | `prefers-reduced-motion: reduce` disables the transition entirely (instant open/close), extending the existing media query block in `styles.ts` that already handles this for `.orb`/`.msg-enter`/`.typing`. |
| A7 | Out of scope | No change to `.msg-enter`, the orb's own state animations, or any JS in `orb.ts`/`index.ts`/`dom.ts`. No asymmetric open-vs-close timing. No "slide up like a mobile sheet" alternative treatment — rejected in favor of the fade+scale+slide direction above. |

---

## 3. `widget/src/styles.ts` — the only file touched

Current:

```ts
  .panel {
    position: fixed; bottom: 88px; width: 360px; max-width: calc(100vw - 32px);
    height: 520px; max-height: calc(100vh - 120px); z-index: 2147483000;
    background: #17151f; color: #eae7f2; border-radius: 16px; overflow: hidden;
    box-shadow: 0 12px 48px rgba(0,0,0,.24); display: none; flex-direction: column;
  }
  .panel.pos-right { right: 20px; } .panel.pos-left { left: 20px; }
  .panel[data-open="true"] { display: flex; }
```

Becomes:

```ts
  .panel {
    position: fixed; bottom: 88px; width: 360px; max-width: calc(100vw - 32px);
    height: 520px; max-height: calc(100vh - 120px); z-index: 2147483000;
    background: #17151f; color: #eae7f2; border-radius: 16px; overflow: hidden;
    box-shadow: 0 12px 48px rgba(0,0,0,.24); display: flex; flex-direction: column;
    opacity: 0; transform: translateY(14px) scale(0.96); visibility: hidden; pointer-events: none;
    transition: opacity .22s ease, transform .22s ease, visibility 0s linear .22s;
  }
  .panel.pos-right { right: 20px; transform-origin: bottom right; }
  .panel.pos-left { left: 20px; transform-origin: bottom left; }
  .panel[data-open="true"] {
    opacity: 1; transform: translateY(0) scale(1); visibility: visible; pointer-events: auto;
    transition: opacity .22s ease, transform .22s ease, visibility 0s;
  }
```

The existing `prefers-reduced-motion` media query block gains one more entry:

```ts
  @media (prefers-reduced-motion: reduce) { .orb.idle { animation: none; } .orb.thinking::after { animation-duration: 1.6s; } .orb.listening, .orb.speaking { animation: none; } .msg-enter { animation: none; } .typing span { animation: none; } }
```
becomes:
```ts
  @media (prefers-reduced-motion: reduce) { .orb.idle { animation: none; } .orb.thinking::after { animation-duration: 1.6s; } .orb.listening, .orb.speaking { animation: none; } .msg-enter { animation: none; } .typing span { animation: none; } .panel { transition: none; } }
```

No other file changes. `orb.ts`, `dom.ts`, `index.ts`, and every test that toggles `data-open` via
`orb.open()`/`orb.close()`/`orb.toggle()` are unaffected — this is purely a CSS reinterpretation of
the same `data-open="true"|"false"` attribute the JS already sets.

---

## 4. Testing

| Layer | Approach |
|-------|----------|
| `dom.test.ts` / `orb.test.ts` | No new tests needed for the animation itself — CSS transitions aren't meaningfully unit-testable in happy-dom (no real layout/paint engine), and the existing tests already assert `data-open` toggles correctly, which is the only JS-observable contract here and is unchanged. |
| Manual/browser smoke | Real browser: open the panel — confirm it fades/scales/slides in smoothly rather than snapping; close it — confirm the reverse; confirm no layout jump/flash while closed (panel now stays `display: flex` at all times, verify it's genuinely invisible and non-interactive, e.g. can't tab into its inputs while closed); toggle `prefers-reduced-motion` in DevTools and confirm open/close becomes instant. |

---

## 5. Risks

| # | Item | Mitigation |
|---|------|------------|
| R1 | Switching from `display: none` to always-`display: flex` (visibility-driven instead) means the panel is now always present in the layout tree, not removed from it | `position: fixed` already takes it out of normal document flow regardless of `display` value, so there's no layout-shift risk for the rest of the page. `visibility: hidden` + `pointer-events: none` correctly keep it non-interactive and out of the accessibility tree while closed. |
| R2 | A visitor could theoretically inspect the DOM while "closed" and see panel content that used to be fully absent via `display: none` | The content (greeting text, etc.) was never sensitive, and `visibility: hidden` already hides it from assistive tech and normal viewing — no real exposure change from `display: none`'s behavior. |

---

*End of specification.*
