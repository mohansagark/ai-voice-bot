# AI Voice Bot v0.2d — Widget Visual Redesign — Technical Specification

**Version:** 1.0 (design/spec — no implementation yet)
**Date:** 2026-07-24
**Author:** Mohan Sagar K
**Status:** Approved design, ready for implementation

> Visual/interaction refinement slice, requested before finishing v0.3's "embed on devmohan.in"
> step. No backend changes, no new agent capability — purely the widget's look and feel. Builds
> on `main` (`efc0538`).

---

## 1. Goal

The widget works (v0.2a–c, published to npm, backend deployed to `voicebot.devmohan.in`) but looks
and feels generic: a plain emoji orb, a flat white panel, static message bubbles, no typing
feedback. This slice gives it a distinctive "modern chat-app" visual identity (Card & Avatar /
Intercom-style direction) and adds the interaction feedback a real chat product has — without
touching the backend, the agent, or the widget's public config contract in a breaking way.

---

## 2. Locked Decisions

| # | Area | Decision |
|---|------|----------|
| D1 | Visual direction | **Card & Avatar** (Intercom-style): dark card panel, gradient banner header, avatar badge overlapping the banner, rounded-square orb. Chosen over "Glass & Bubble" and "iMessage Classic" via mockup review. |
| D2 | Orb icon | Custom inline SVG **bot-face glyph**, replacing the `💬` emoji. Chosen over an initial-letter avatar and over reusing the site's own logo mark (rejected — conflates site branding with Leo-the-assistant's identity). |
| D3 | Theming | Panel/orb move from a single `themeColor` to a **two-color gradient**, via a new optional `branding.themeColorSecondary` config field. Defaults to `themeColor` itself (solid color) when omitted — fully backwards compatible for existing embeds. |
| D4 | Avatar placement | **Header only** — no per-message avatar. Keeps message width maximized; avatar establishes identity once. |
| D5 | Typing indicator | Animated 3-dot bounce bubble in the message list, shown from send until the first streamed token. |
| D6 | Message animation | New messages fade + slide up ~8px on append. Respects `prefers-reduced-motion` (existing pattern from orb animations). |
| D7 | Timestamps | Small muted text under every message bubble, always visible (no hover/tap-to-reveal). |
| D8 | Auto-scroll | Eased scroll-to-bottom on new content; **pins off** if the visitor has manually scrolled up, resuming on their own scroll-to-bottom or on sending a new message. |
| D9 | Mobile | No mobile-specific redesign, but the result **must not regress** existing small-screen behavior (panel `max-width`/`max-height` clamping) — verified by manual smoke test at a mobile viewport, not a new feature. |
| D10 | Out of scope | Light/dark adaptive theming (panel stays dark-card regardless of host page theme), per-message avatars — see §6. |

---

## 3. Orb (`orb.ts` / `styles.ts` / `dom.ts`)

- Shape: rounded-square, ~22px corner radius (was a circle).
- Icon: new inline SVG bot-face glyph (rounded rect "head", two dot "eyes", small antenna), replacing the `orb.textContent = "💬"` in `dom.ts`. Rendered as an `<svg>` child instead of text content — the existing `.orb.thinking` state (which currently does `font-size: 0` to hide text and show a spinner via `::after`) needs its selector to instead hide/show the SVG (e.g. `.orb.thinking svg { display: none }`), since there's no longer a text glyph to collapse.
- Background: `linear-gradient(120deg, ${themeColor}, ${themeColorSecondary})` — identical visual to today when the two colors are equal (default).
- All existing animation states (idle pulse, thinking spinner, listening pulse, speaking scale) carry over unchanged; they're independent of shape/icon/background.

## 4. Panel (`dom.ts` / `styles.ts`)

- Panel background becomes a dark card tone (`#17151f`-family) instead of `#fff` / `#17151f` text-on-white. Text color inverts to a light tone accordingly.
- Header (`.hd`) becomes a gradient banner (`linear-gradient(120deg, ${themeColor}, ${themeColorSecondary})`) with extra bottom padding to make room for the avatar badge, which overlaps the banner's bottom edge (a white/light circular badge containing the bot-glyph SVG, smaller than the orb's version).
- Message bubbles restyled for the dark panel: bot bubbles as a slightly-lighter-than-background card tone with a soft shadow; user bubbles keep the theme gradient/primary color. Rounded corners increase slightly (14px) versus today's mixed 4px/14px "tail" corners — the tail-corner detail is dropped in favor of a plain rounded-rect bubble (simpler, still clearly groups by sender via alignment + color).
- Avatar appears only in the header (D4) — no change to `.msg.bot`/`.msg.user` structure beyond color/shadow.

## 5. Theming config (`config.ts` / `types.ts`)

```ts
// types.ts — WidgetConfig["branding"]
branding: {
  botName: string;
  themeColor: string;
  themeColorSecondary: string; // NEW
  position: "bottom-right" | "bottom-left";
  greeting: string;
}
```
```ts
// config.ts — DEFAULTS + validateConfig
branding: { botName: "Leo", themeColor: "#6C5CE7", themeColorSecondary: "#6C5CE7", position: "bottom-right", greeting: "..." }
// validateConfig: if the caller supplies themeColor but not themeColorSecondary, resolve
// themeColorSecondary to the supplied themeColor (not the default), so a custom single-color
// embed still renders as a solid color, not a gradient toward the *default* purple.
```
`styles.ts`'s `css(theme: string)` becomes `css(theme: string, theme2: string)`, threading the second color into the orb/header gradients. Every existing call site (`dom.ts`'s `mountShell`) updates its one call.

## 6. Interaction & feedback (`panel.ts`, new `panel` internals)

- **Typing indicator**: a dedicated `.msg.bot.typing` bubble (three animated dots, matching the mockup's bounce keyframes) inserted into `.list` immediately on send, removed when the first token arrives (`onToken`) or replaced by the real bot line — reuses the existing `panel.startBot()`/`appendBot()` flow; the indicator is just the visual state of that line before its first token.
- **Message entrance animation**: a CSS class (`.msg-enter`) applied on append, animating `opacity`/`transform` over ~200ms. The class is left in place after the transition completes — it's a one-shot `@keyframes` animation, not a persistent state, so leaving it costs nothing and needs no cleanup timer. Gated behind `@media (prefers-reduced-motion: reduce)` like the orb's existing animations.
- **Timestamps**: `panel.addUser`/`startBot`/`endBot` capture `Date.now()` at creation and render a small muted `<span class="ts">` under the bubble content, formatted locale-aware (`toLocaleTimeString` with `hour`/`minute` only).
- **Smooth auto-scroll**: `.list` gets `scroll-behavior: smooth` (CSS-level easing, no JS animation loop needed) plus a pinned-to-bottom check before each append: if `list.scrollHeight - list.scrollTop - list.clientHeight <= 32` (px) before the new content is added, scroll to bottom after; otherwise leave the visitor's scroll position alone. Re-check/re-pin on send (visitor's own message always scrolls to bottom).

## 7. Mobile / responsiveness (D9)

No new mobile-specific layout. The existing `max-width: calc(100vw - 32px)` / `max-height: calc(100vh - 120px)` clamping on `.panel` must continue to keep the widget usable after the header grows (avatar badge overlap) and timestamps/typing-indicator add vertical content. Verified manually (§8), not unit-tested (no viewport simulation in happy-dom).

---

## 8. Testing

| Layer | Approach |
|-------|----------|
| Config | Unit test: `themeColorSecondary` resolution — omitted → equals `themeColor`; explicit single `themeColor` override → secondary follows it, not the default; both explicit → both honored independently. |
| Timestamps | Unit test: formatter output shape (locale time string), attached to user/bot message render. |
| Auto-scroll pin logic | Unit test (happy-dom, stubbed `scrollHeight`/`scrollTop`/`clientHeight`): near-bottom → scrolls after append; scrolled-up → does not force-scroll; sending own message → always scrolls. |
| Typing indicator | Unit test (happy-dom): indicator bubble present immediately after `send()`, removed/replaced once the bot line receives its first token. |
| Orb icon/shape | Unit test: SVG present in orb markup; `.orb.thinking` hides the SVG (existing spinner still shows). |
| Manual/browser smoke | `demo-embed.html`: visual review of orb/panel/gradient/avatar; typing indicator appears then resolves; message fade-in; timestamps render; scroll pin behaves (scroll up mid-conversation, confirm no forced jump; send a message, confirm it scrolls); resize to a mobile viewport (~375px) and confirm the panel still fits/scrolls without breaking; `prefers-reduced-motion` disables the new entrance animation. |

---

## 9. Out of Scope (→ later)

- Light/dark **adaptive** theming (matching host page's own light/dark mode) — panel stays a fixed dark-card style regardless of host page theme.
- Per-message avatars (Slack/Discord-style) — header-only avatar only, per D4.
- Mobile-specific layout/redesign — only non-regression is in scope (D9).
- "Online" status text under the bot name in the header — not requested, skipped to avoid implying real-time human presence.
- Any backend, agent, or config-breaking changes — this slice is widget-visual-only.
- Finishing v0.3's embed step (adding the script tag to `devmohan.in`'s `layout.js` for real) — resumes after this slice ships, per the original plan.

---

## 10. Risks

| # | Item | Mitigation |
|---|------|------------|
| R1 | `themeColorSecondary` default change could visually alter existing embeds that only set `themeColor` | Resolution logic explicitly follows the *caller's* `themeColor`, not the module default, when only one color is given — existing single-color embeds render identically (solid, no gradient). |
| R2 | Dark panel may clash with some host pages' expectations (v0.2b assumed a light panel) | No known existing production embeds other than `devmohan.in` (which is dark-themed already); documented in `widget/README.md` as the new default look. |
| R3 | Timestamp/typing-indicator/avatar-badge markup growth could overflow the panel on very small screens | Manual mobile-viewport smoke test (§8) before calling this done; existing `max-height` clamp plus `.list { overflow-y: auto }` already handles vertical overflow. |
| R4 | Removing the "tail" corner detail on bubbles is a visible behavior change from v0.2b | Deliberate simplification for the new dark-card look; flagged here so it's not mistaken for an oversight. |

---

*End of v0.2d specification. After this ships, resume v0.3: embed the widget on `devmohan.in` for real (the `layout.js` change discarded earlier in favor of "more refinement first").*
