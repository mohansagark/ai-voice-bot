# Leo Response Tone Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two concrete gaps in Leo's system prompt — repeated questions/CTAs and not backing
off when a visitor signals disengagement — found in a real local test transcript.

**Architecture:** Pure prompt-text change to `buildSystemPrompt` in `worker/src/prompts.ts`: two new
rule lines and one new example line. No new modules, no state, no model/provider changes.

**Tech Stack:** TypeScript, Vitest (existing worker test stack — no new dependencies).

## Global Constraints

- Worker-side only (`worker/src/prompts.ts` and its test). No changes to `graph.ts`, `nodes.ts`,
  `config.ts`, `providers.ts`, or any `widget/` file (spec T4).
- Prompt-only enforcement — no `maxTokens` cap, no repetition-detection code (spec T3, Approach A).
- The new no-repeat-question rule must be distinct from (not a reword of) the existing
  "never reuse the same phrase... describing Mohan" rule — it targets repeated *questions/CTAs*
  specifically, which the existing rule doesn't cover (spec T1).
- The disengagement rule must match the confirmed behavior exactly: one brief, low-pressure
  acknowledgment, then stop — no re-pitching, no further open-ended question (spec T2).
- `buildSystemPrompt(p: Persona): string`'s signature, return type, and every other existing line
  are unchanged. `Persona`/`AppConfig` types are unchanged.

---

### Task 1: Add the two prompt rules and the contrastive example

**Files:**
- Modify: `worker/src/prompts.ts`
- Test: `worker/tests/prompts.test.ts`

**Interfaces:**
- Consumes: existing `Persona` type (`worker/src/config.ts`), unchanged.
- Produces: no new exports. `buildSystemPrompt`'s output string gains 3 new lines; every existing
  caller (`worker/src/agent/nodes.ts`'s `makeAgentNode`) needs no changes.

- [ ] **Step 1: Write the failing tests**

Append to `worker/tests/prompts.test.ts`, inside the existing `describe("buildSystemPrompt", ...)`
block, after the `"forbids revealing it's an AI and forbids repeated re-saving"` test:

```ts
  it("never asks the same or a similarly-worded question twice in one conversation", () => {
    expect(prompt).toMatch(/never ask the same.*question twice|similarly-worded question twice/i);
  });
  it("reads the room and backs off on a short/disinterested reply, with a matching example", () => {
    expect(prompt).toMatch(/read the room/i);
    expect(prompt).toContain(`Visitor: "nothing, stop" → You: "No worries — I'm here if you think of something."`);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from inside `worker/`): `npm test -- tests/prompts.test.ts`
Expected: FAIL — the built prompt string doesn't yet match `/read the room/i` or contain the new
example line, and doesn't yet match the no-repeat-question pattern.

- [ ] **Step 3: Implement in `worker/src/prompts.ts`**

Change:

```ts
    `- Never reuse the same phrase, joke, or way of describing ${p.owner.name} across messages — describe him differently and freshly every time; do NOT settle into a catchphrase.`,
    `- Gentle teasing and genuine warmth are great. Do NOT be romantic or hit on the visitor — keep it classy and professional-friendly.`,
```

to:

```ts
    `- Never reuse the same phrase, joke, or way of describing ${p.owner.name} across messages — describe him differently and freshly every time; do NOT settle into a catchphrase.`,
    `- Never ask the same or a similarly-worded question twice in one conversation — if you've already asked something (even if the visitor's answer was short), do not ask it again in different clothes.`,
    `- Read the room: if a visitor gives a short, flat, or disinterested reply ("nothing", "stop", "just looking", one-word answers, or anything signaling they're done chatting), do NOT re-pitch ${p.owner.name} or ask another open-ended question. Give one brief, low-pressure line and stop there — leave space instead of filling it with more sales pitch.`,
    `- Gentle teasing and genuine warmth are great. Do NOT be romantic or hit on the visitor — keep it classy and professional-friendly.`,
```

Change:

```ts
    `EXAMPLE (shows the ATTITUDE only — NEVER copy the wording):`,
    `Visitor: "do you remember me?" → You: "Of course — good to see you back. What can I help with?"`,
    ``,
```

to:

```ts
    `EXAMPLE (shows the ATTITUDE only — NEVER copy the wording):`,
    `Visitor: "do you remember me?" → You: "Of course — good to see you back. What can I help with?"`,
    `Visitor: "nothing, stop" → You: "No worries — I'm here if you think of something."`,
    ``,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/prompts.test.ts`
Expected: PASS (9 tests: 7 existing + 2 new).

Then run the full worker suite to confirm zero regressions:

Run: `npm test`
Expected: PASS (67 tests total: 65 baseline + 2 new).

- [ ] **Step 5: Typecheck and commit**

Run (from inside `worker/`): `npx tsc --noEmit`
Expected: no errors.

```bash
git add worker/src/prompts.ts worker/tests/prompts.test.ts
git commit -m "feat(worker): teach Leo to stop repeating questions and read disengagement cues"
```

---

## Final Verification

- [ ] Run the full worker suite once more: `npm test` — all 67 tests pass.
- [ ] `npx tsc --noEmit` (from `worker/`) — clean.
- [ ] Manual smoke test (real LLM call, not unit-testable): run the worker locally
  (`npm run dev` from `worker/`, with `MODE=dev` in `.dev.vars` to bypass guards) and replay a
  conversation similar to the one that surfaced this issue — ask a couple of questions, then reply
  with something disengaged like "nothing" or "stop" — confirm Leo doesn't repeat an earlier question
  and gives a brief, low-pressure response instead of another pitch. This is inherently probabilistic
  (spec R1) — one clean run doesn't guarantee it never recurs, just that the new rules are being
  picked up at all.
