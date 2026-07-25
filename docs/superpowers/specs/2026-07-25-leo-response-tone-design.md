# Leo Response Tone Fixes — Technical Specification

**Version:** 1.0 (design/spec — no implementation yet)
**Date:** 2026-07-25
**Author:** Mohan Sagar K
**Status:** Approved design, ready for implementation

> Prompted by a real local test transcript (captured 2026-07-25) where Leo asked a close variant of
> "what brings you here today?" three times across four replies, and kept pitching Mohan even after
> the visitor typed "nothing stop." Worker-side only (`worker/src/prompts.ts`) — no widget changes.
> Persona externalization (making the hardcoded `defaultPersona` in `worker/src/config.ts`
> configurable for other users of the published package) is a separate, deliberately deferred spec.

---

## 1. Goal

Leo's system prompt (`worker/src/prompts.ts`) already instructs brevity and variety ("Keep replies
short and snappy," "Never reuse the same phrase... describing Mohan"), but a real transcript showed
both rules being violated: Leo repeated a near-identical question three times, and kept pushing a
sales pitch after the visitor clearly signaled they were done ("nothing stop"). This slice tightens
the prompt with two concrete, previously-uncovered rules and a contrastive example, so Leo reads
disengagement and stops re-asking things it already asked — without adding any new infrastructure
(no token caps, no repetition-detection code, no model/provider changes).

---

## 2. Locked Decisions

| # | Area | Decision |
|---|------|----------|
| T1 | Root cause | The existing anti-repetition rule ("never reuse the same phrase... describing Mohan") is scoped to *descriptions of Mohan* only — it never covered repeated *questions/CTAs* ("what brings you here today?"), which is the exact failure observed. Fix is a dedicated rule for that gap, not a rewording of the existing one. |
| T2 | Disengagement handling | On a short/flat/disinterested reply ("nothing", "stop", "just looking", a one-word answer, or anything else signaling the visitor is done), Leo gives one brief, low-pressure acknowledgment and stops there — no re-pitching Mohan, no further open-ended question. |
| T3 | Enforcement mechanism | Prompt-only (Approach A from design discussion). No hard token cap on the model call, no programmatic repetition detection/regeneration. Accepted tradeoff: still probabilistic, not a hard guarantee — if this recurs, a token cap (`providers.ts`) is the next lever, not in this slice. |
| T4 | Scope boundary | `worker/src/prompts.ts` and its test only. No changes to `graph.ts`, `nodes.ts`, `config.ts`, `providers.ts`, or any widget file. Persona externalization (config-driven facts/bio/tone instead of hardcoded `defaultPersona`) is explicitly a separate future spec, not folded in here. |

---

## 3. `worker/src/prompts.ts` — `buildSystemPrompt` changes

Two new rules added to the `HARD RULES`/`VOICE & STYLE` block (exact placement: after the existing
"Never reuse the same phrase..." line, so the two anti-repetition rules sit together):

```ts
`- Never ask the same or a similarly-worded question twice in one conversation — if you've already asked something (even if the visitor's answer was short), do not ask it again in different clothes.`,
`- Read the room: if a visitor gives a short, flat, or disinterested reply ("nothing", "stop", "just looking", one-word answers, or anything signaling they're done chatting), do NOT re-pitch ${p.owner.name} or ask another open-ended question. Give one brief, low-pressure line and stop there — leave space instead of filling it with more sales pitch.`,
```

The existing `EXAMPLE` block gains a second line, directly encoding T2's confirmed behavior:

```ts
`Visitor: "nothing, stop" → You: "No worries — I'm here if you think of something."`,
```

placed immediately after the existing `Visitor: "do you remember me?"` example line, under the same
`EXAMPLE (shows the ATTITUDE only — NEVER copy the wording)` heading (no new heading needed).

No other line in `buildSystemPrompt` changes. `Persona`, `AppConfig`, and every call site
(`nodes.ts`'s `makeAgentNode`) are unaffected — `buildSystemPrompt(p: Persona)`'s signature and
return type (`string`) are unchanged.

---

## 4. Testing

`worker/tests/prompts.test.ts` — two new cases, matching the existing suite's plain string-assertion
style (`buildSystemPrompt(defaultPersona)` then `.toContain`/`.toMatch`):

| Test | Assertion |
|------|-----------|
| States the no-repeat-question rule | `prompt` matches something like `/never ask the same.*question twice|similarly-worded question twice/i` |
| States the disengagement rule and its example | `prompt` matches `/read the room/i` and contains the "nothing, stop" example line |

No behavioral/integration test against a real or mocked LLM call — this is a prompt-content change,
consistent with how every other existing `prompts.test.ts` case is a static content assertion, not a
model-output assertion (the model's actual adherence can't be unit-tested; T3 already accepts this
is probabilistic).

---

## 5. Out of Scope (→ later)

- Persona externalization (config-driven `facts`/`bio`/`tone`/`owner` instead of hardcoded
  `defaultPersona` in `worker/src/config.ts`) — separate future spec, raised in the same conversation
  but deliberately deferred (confirmed: tone/behavior work goes first).
- A hard `maxTokens` cap on the model call (`providers.ts`) — the rejected alternative (Approach B);
  revisit only if prompt-only tightening proves insufficient in further real-world testing.
- Programmatic repetition detection/regeneration (Approach C) — rejected as disproportionate
  complexity for this use case.
- Any change to `refuseNode`'s or `makeConfirmNode`'s hardcoded message strings in `nodes.ts` — not
  implicated by the observed transcript.

---

## 6. Risks

| # | Item | Mitigation |
|---|------|------------|
| R1 | Prompt-only enforcement has no hard guarantee — the model could still occasionally repeat a question or over-pitch, since this depends on instruction-following rather than code | Accepted per T3. If it recurs, the next lever is a `maxTokens` cap (Approach B, already scoped and ready to revisit) rather than more prompt tweaking. |
| R2 | Adding more rules to an already-long system prompt could dilute emphasis on existing rules (prompt bloat) | Only two new lines plus one example line added; placed adjacent to the existing, closely-related anti-repetition rule rather than as a scattered new section, keeping related guidance grouped. |

---

*End of specification. Worker-side only — no widget/branch versioning implications; can land directly
on `main` given the prior widget work (v0.2d/e/f) is already merged there.*
