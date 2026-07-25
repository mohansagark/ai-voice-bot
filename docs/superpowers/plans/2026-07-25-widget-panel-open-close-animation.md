# Widget Panel Open/Close Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the chat panel a smooth fade+scale+slide open/close transition instead of the current
instant `display: none`/`flex` snap.

**Architecture:** Pure CSS change to the `.panel` rule (and its `prefers-reduced-motion` override) in
`widget/src/styles.ts`. No JS, no new files, no test changes — this codebase's established
convention (see prior ledger notes) is not to unit-test raw CSS string content, only DOM
structure/attributes, and this change touches neither.

**Tech Stack:** CSS-in-JS template string (existing `css(theme, theme2)` function in `styles.ts`) —
no new dependencies.

## Global Constraints

- Only `widget/src/styles.ts` changes. `orb.ts`'s `setOpen`/`data-open` attribute logic is completely
  unchanged — this is a CSS-only reinterpretation of the same attribute.
- Motion: fade (opacity 0→1) + scale (0.96→1) + slide (`translateY` 14px→0), 220ms, `ease` timing.
  Close reverses the same transition, same duration (no asymmetric timing).
- Transform origin anchored at the corner nearest the orb (`bottom right` for `.pos-right`,
  `bottom left` for `.pos-left`), not the panel's center.
- `prefers-reduced-motion: reduce` must disable the panel transition entirely (instant), extending
  the existing media query block that already covers `.orb`/`.msg-enter`/`.typing`.
- The panel must remain fully non-interactive and hidden from assistive tech while "closed" — achieved
  via `opacity`/`transform`/`visibility`/`pointer-events`, with `visibility` switching on a delay
  timed to the animation duration (the standard pattern for animating an element that also needs a
  true hidden state).

---

### Task 1: Animate `.panel` open/close in `widget/src/styles.ts`

**Files:**
- Modify: `widget/src/styles.ts`

**Interfaces:**
- Consumes: nothing new — the existing `data-open="true"|"false"` attribute that `orb.ts` already
  sets via `setOpen`.
- Produces: nothing new for other tasks — this is the only task in this plan.

- [ ] **Step 1: Make the change**

In `widget/src/styles.ts`, change:

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

to:

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

And change:

```ts
  @media (prefers-reduced-motion: reduce) { .orb.idle { animation: none; } .orb.thinking::after { animation-duration: 1.6s; } .orb.listening, .orb.speaking { animation: none; } .msg-enter { animation: none; } .typing span { animation: none; } }
```

to:

```ts
  @media (prefers-reduced-motion: reduce) { .orb.idle { animation: none; } .orb.thinking::after { animation-duration: 1.6s; } .orb.listening, .orb.speaking { animation: none; } .msg-enter { animation: none; } .typing span { animation: none; } .panel { transition: none; } }
```

- [ ] **Step 2: Run the full widget test suite to confirm zero regressions**

Run (from inside `widget/`): `npm test`
Expected: PASS, same count as before this change (102/102) — no test asserts raw CSS string content
in this codebase (confirmed by inspecting `dom.test.ts`/`orb.test.ts`, which only assert
`data-open`/DOM structure), so a CSS-only change to `.panel` cannot break any existing test; this
step is a regression guard, not a TDD cycle.

- [ ] **Step 3: Typecheck and build**

Run (from inside `widget/`): `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: `built dist/ai-voice-bot.min.js`.

- [ ] **Step 4: Commit**

```bash
git add widget/src/styles.ts
git commit -m "feat(widget): smooth fade+scale+slide transition for panel open/close"
```

---

## Final Verification

- [ ] `npm test` (from `widget/`) — 102/102 (unchanged count, confirming no regression).
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run build` — succeeds.
- [ ] Manual smoke test (real browser, not unit-testable): open `widget/demo-embed.html` with the
  worker running — click the orb, confirm the panel fades/scales/slides in smoothly (not an instant
  snap); click close, confirm the reverse; confirm there's no flash/jump while closed (the panel now
  stays `display: flex` at all times — verify pressing Tab while closed does not focus anything
  inside it, confirming `pointer-events: none`/`visibility: hidden` are working); in DevTools, enable
  "Emulate CSS prefers-reduced-motion: reduce" and confirm open/close becomes instant.
