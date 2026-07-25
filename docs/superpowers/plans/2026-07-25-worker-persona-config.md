# Worker Persona Externalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Persona` loadable from a `PERSONA_JSON` environment variable, replace the shipped
`defaultPersona` with a generic placeholder, remove a hardcoded Mohan-specific phrase from the
otherwise-generic prompt template, and configure Mohan's real curated persona in his own
local/production config only.

**Architecture:** `worker/src/config.ts`'s `loadConfig(env)` gains a `loadPersona(env)` step that
parses `env.PERSONA_JSON` (shallow-merged over `defaultPersona`, fail-safe on malformed JSON).
`defaultPersona` becomes a generic example. `worker/src/prompts.ts` loses one hardcoded parenthetical
that named Mohan specifically. Mohan's real persona (curated from `portfolio-data`, already written
out in the spec) goes into his own `worker/.dev.vars` (gitignored) and `worker/wrangler.toml`'s
`[vars]` (committed, matching how `ALLOWED_ORIGINS` is already handled there).

**Tech Stack:** TypeScript, Vitest (existing worker test stack — no new dependencies).

## Global Constraints

- One new env var only: `PERSONA_JSON`, holding the entire `Persona` object as a JSON string. No
  scalar per-field env vars.
- `loadPersona` must never throw — malformed/missing `PERSONA_JSON` falls back to `defaultPersona`.
- A partial `PERSONA_JSON` override (e.g. only `facts` provided) must still produce a fully-valid
  `Persona` — merge over `defaultPersona`, don't replace wholesale (`owner` merges too, not just the
  top level).
- `defaultPersona`'s substantive content (bio, facts) becomes a generic placeholder — no real
  employer names, numbers, or achievements. `botName: "Leo"` stays, matching the widget's own
  example-default convention.
- `Persona`'s type shape, `buildSystemPrompt`'s signature, and every existing call site
  (`worker/src/agent/nodes.ts`) are unchanged.
- Mohan's real curated persona (exact JSON given in this plan, sourced from the spec) is never
  committed to `worker/.dev.vars` history in a way that contradicts it being local-only — it's
  gitignored already; only the `wrangler.toml` copy is committed (intentional, matches
  `ALLOWED_ORIGINS`).
- Implementers run `npm test` and `npx tsc --noEmit` (in `worker/`) before committing.

---

### Task 1: `config.ts` — env-driven persona + generic default

**Files:**
- Modify: `worker/src/config.ts`
- Modify: `worker/tests/prompts.test.ts` (one existing assertion depends on `defaultPersona`'s owner
  name, which changes in this task)
- Test: Create `worker/tests/config.test.ts`

**Interfaces:**
- Consumes: existing `Persona`/`Env`/`AppConfig` types (unchanged shape).
- Produces: `loadPersona(env: Env): Persona` (new, exported for testing), `Env.PERSONA_JSON?: string`
  (new optional field). `loadConfig(env)`'s `persona` field now comes from `loadPersona(env)` instead
  of the bare `defaultPersona` constant. `defaultPersona`'s exported shape/type is unchanged, only
  its values change.

- [ ] **Step 1: Write the failing tests**

Create `worker/tests/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig, loadPersona, defaultPersona, type Env } from "../src/config";

describe("loadPersona / loadConfig persona", () => {
  it("returns the default persona when PERSONA_JSON is not set", () => {
    expect(loadPersona({} as Env)).toEqual(defaultPersona);
    expect(loadConfig({} as Env).persona).toEqual(defaultPersona);
  });

  it("returns a full override merged over the default when PERSONA_JSON is valid", () => {
    const override = {
      botName: "Ari",
      owner: { name: "Sam", role: "Designer" },
      bio: "A designer who loves clean systems.",
      tone: "calm and precise",
      facts: ["Sam designs at a small studio."],
      do_not: ["quote prices"],
    };
    const persona = loadPersona({ PERSONA_JSON: JSON.stringify(override) } as Env);
    expect(persona).toEqual(override);
  });

  it("merges a partial override over the default rather than replacing it wholesale", () => {
    const persona = loadPersona({ PERSONA_JSON: JSON.stringify({ facts: ["Just one fact."] }) } as Env);
    expect(persona.facts).toEqual(["Just one fact."]);
    expect(persona.botName).toBe(defaultPersona.botName); // untouched fields fall back to the default
    expect(persona.owner).toEqual(defaultPersona.owner); // owner wasn't in the override at all
  });

  it("merges a partial owner override without dropping the other owner field", () => {
    const persona = loadPersona({ PERSONA_JSON: JSON.stringify({ owner: { name: "Sam" } }) } as Env);
    expect(persona.owner.name).toBe("Sam");
    expect(persona.owner.role).toBe(defaultPersona.owner.role); // role wasn't overridden — kept from default
  });

  it("falls back to the default persona on malformed PERSONA_JSON instead of throwing", () => {
    expect(() => loadPersona({ PERSONA_JSON: "{not valid json" } as Env)).not.toThrow();
    expect(loadPersona({ PERSONA_JSON: "{not valid json" } as Env)).toEqual(defaultPersona);
  });

  it("ships a generic default persona, not real personal/employer data", () => {
    expect(defaultPersona.owner.name).not.toBe("Mohan");
    expect(JSON.stringify(defaultPersona)).not.toMatch(/ServiceNow|Invesco|Reliance Jio|Jio Platforms/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from inside `worker/`): `npm test -- tests/config.test.ts`
Expected: FAIL — `loadPersona` is not exported yet, and `defaultPersona.owner.name` is still
`"Mohan"`.

- [ ] **Step 3: Implement in `worker/src/config.ts`**

Change:

```ts
export interface Env {
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  WEBHOOK_URL?: string;
  ALLOWED_ORIGINS?: string;
  DEFAULT_PROVIDER?: string;
  MAX_MESSAGE_CHARS?: string;
  MAX_TURNS_PER_SESSION?: string;
  MODE?: string;
  TTS_VOICE?: string;
  MAX_TTS_CHARS?: string;
  SESSION_DO: DurableObjectNamespace;
}
```

to:

```ts
export interface Env {
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  WEBHOOK_URL?: string;
  ALLOWED_ORIGINS?: string;
  DEFAULT_PROVIDER?: string;
  MAX_MESSAGE_CHARS?: string;
  MAX_TURNS_PER_SESSION?: string;
  MODE?: string;
  TTS_VOICE?: string;
  MAX_TTS_CHARS?: string;
  PERSONA_JSON?: string;
  SESSION_DO: DurableObjectNamespace;
}
```

Change:

```ts
export const defaultPersona: Persona = {
  botName: "Leo",
  owner: { name: "Mohan", role: "Software Engineer" },
  bio: "Senior software engineer specializing in AI and frontend.",
  tone: "playful, warm, and a little cheeky — a witty friend hyping Mohan up, never a corporate bio",
  facts: [
    "Mohan is a sharp, hands-on problem-solver who genuinely lights up when something is broken and needs fixing.",
    "He works across AI and full-stack development, with deep ServiceNow experience.",
    "He is open to freelance projects and full-time roles — and loves a meaty technical challenge.",
  ],
  do_not: ["quote prices", "commit to dates", "schedule meetings"],
};
```

to:

```ts
export const defaultPersona: Persona = {
  botName: "Leo",
  owner: { name: "Alex", role: "Software Engineer" },
  bio: "A software engineer who enjoys building things and solving interesting problems.",
  tone: "warm, a little playful, and genuinely curious — a friendly guide, never a corporate bio",
  facts: [
    "Alex works across full-stack development and enjoys tackling hard technical problems.",
    "Alex is open to freelance projects and full-time roles.",
  ],
  do_not: ["quote prices", "commit to dates", "schedule meetings"],
};

export function loadPersona(env: Env): Persona {
  if (!env.PERSONA_JSON) return defaultPersona;
  try {
    const parsed = JSON.parse(env.PERSONA_JSON) as Partial<Persona>;
    return {
      ...defaultPersona,
      ...parsed,
      owner: { ...defaultPersona.owner, ...(parsed.owner ?? {}) },
    };
  } catch {
    return defaultPersona;
  }
}
```

Change, in `loadConfig`:

```ts
    persona: defaultPersona,
```

to:

```ts
    persona: loadPersona(env),
```

- [ ] **Step 4: Fix the one existing test that depended on the old default owner name**

In `worker/tests/prompts.test.ts`, change:

```ts
  it("names the owner and role", () => {
    expect(prompt).toContain("Mohan");
    expect(prompt).toContain("Software Engineer");
  });
```

to:

```ts
  it("names the owner and role", () => {
    expect(prompt).toContain(defaultPersona.owner.name);
    expect(prompt).toContain("Software Engineer");
  });
```

(`defaultPersona` is already imported at the top of this file — `import { defaultPersona } from "../src/config";` — no new import needed.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/config.test.ts tests/prompts.test.ts`
Expected: PASS (6 new tests in `config.test.ts`, 9 existing in `prompts.test.ts`, all green).

Then run the full worker suite to confirm zero regressions:

Run: `npm test`
Expected: PASS (76 tests total: 70 baseline + 6 new in `config.test.ts`).

- [ ] **Step 6: Typecheck and commit**

Run (from inside `worker/`): `npx tsc --noEmit`
Expected: no errors.

```bash
git add worker/src/config.ts worker/tests/config.test.ts worker/tests/prompts.test.ts
git commit -m "feat(worker): load Persona from PERSONA_JSON env var, ship a generic default"
```

---

### Task 2: Remove the hardcoded Mohan-specific phrase; configure Mohan's real persona locally

**Files:**
- Modify: `worker/src/prompts.ts`
- Modify: `worker/.dev.vars` (gitignored — not visible in `git diff`, but still a real required edit)
- Modify: `worker/wrangler.toml`

**Interfaces:**
- Consumes: `loadPersona`/`Env.PERSONA_JSON` from Task 1.
- Produces: nothing new for later tasks — this is the last task in the plan.

- [ ] **Step 1: Write the failing test**

Append to `worker/tests/prompts.test.ts`, inside `describe("buildSystemPrompt", ...)`, after the
last existing test (`"scopes the 'above my pay grade' deflection..."`):

```ts
  it("does not hardcode a specific personality example into the generic instruction text", () => {
    expect(prompt).not.toMatch(/sharp, hands-on problem-solver who genuinely loves the hard stuff/i);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from inside `worker/`): `npm test -- tests/prompts.test.ts`
Expected: FAIL — the hardcoded phrase is still present in `buildSystemPrompt`'s output.

- [ ] **Step 3: Implement in `worker/src/prompts.ts`**

Change:

```ts
    `- Lead with personality, NOT a résumé. If someone asks "who is ${p.owner.name}?", don't recite his job title like a LinkedIn bio — talk him up warmly in your OWN fresh words (he's a sharp, hands-on problem-solver who genuinely loves the hard stuff), and only give specifics if they want them.`,
```

to:

```ts
    `- Lead with personality, NOT a résumé. If someone asks "who is ${p.owner.name}?", don't recite his job title like a LinkedIn bio — talk him up warmly in your OWN fresh words, grounded in his actual facts and tone below, and only give specifics if they want them.`,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/prompts.test.ts`
Expected: PASS (13 tests: 12 existing + 1 new).

Then run the full suite:

Run: `npm test`
Expected: PASS (77 tests total: 76 from Task 1 + 1 new).

- [ ] **Step 5: Typecheck**

Run (from inside `worker/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit the source change**

```bash
git add worker/src/prompts.ts worker/tests/prompts.test.ts
git commit -m "fix(worker): remove hardcoded personality example, let tone/facts carry it"
```

- [ ] **Step 7: Configure Mohan's real persona in `worker/.dev.vars` (local, gitignored)**

Read the current contents of `worker/.dev.vars` first (it has `GROQ_API_KEY`, `WEBHOOK_URL`, `MODE`
already — do not remove or reorder those). Append this exact line (this is the compact-JSON form of
the persona curated in the spec, `docs/superpowers/specs/2026-07-25-worker-persona-config-design.md`
§4 — copy it verbatim, do not reformat or re-indent it, and do not wrap it in quotes: dotenv-style
files take everything after the first `=` as the literal value):

```
PERSONA_JSON={"botName":"Leo","owner":{"name":"Mohan","role":"Senior Software Engineer"},"bio":"Senior Software Engineer with 9+ years building AI-powered products and high-performance frontend systems at scale — specializing in LLM integrations, agentic workflows, and real-time interfaces.","tone":"playful, warm, and a little cheeky — a witty friend hyping Mohan up, never a corporate bio","facts":["Mohan is currently at ServiceNow, leading UX architecture for AI-powered agentic platforms, including a voice-enabled layer on Amazon Connect unifying multiple CCaaS providers.","At Invesco, he led IVYGPT, an internal AI platform adopted by 8,000+ users that cut report analysis time from 30 days to 30 minutes.","At Reliance Jio (Jio Platforms), he led a team of 10 engineers on platforms serving 5M+ users, improving page load time by roughly 90% — from 5 seconds down to 500ms.","He specializes in LLM integrations, agentic workflows, prompt engineering, and RAG/semantic search, alongside deep React, React Native, Next.js, and Node.js expertise.","He holds a BTech in Mechanical Engineering from VIT, and later completed full-stack development and data science programs at Scaler and Imarticus — a self-driven pivot into software and AI.","He's earned an Engineering Excellence Award (Invesco, 2024) and an Innovation Champion award (Reliance Jio, 2023) for leading the redesign of the ResQ app, used by over a million users.","He's open to freelance projects and full-time roles, especially anything meaty involving AI/agentic systems or gnarly frontend performance problems."],"do_not":["quote prices","commit to dates","schedule meetings"]}
```

Verify the line is valid JSON after the `=` before moving on: run
`node -e "JSON.parse(require('fs').readFileSync('worker/.dev.vars','utf8').split('\n').find(l=>l.startsWith('PERSONA_JSON=')).slice('PERSONA_JSON='.length))"`
from the repo root. Expected: no output, no error (a parse error would print a stack trace).

- [ ] **Step 8: Configure Mohan's real persona in `worker/wrangler.toml`'s `[vars]` (production, committed)**

In `worker/wrangler.toml`, inside the existing `[vars]` block, add this line (same JSON as Step 7,
but as a properly-escaped TOML string — copy it verbatim, do not reformat):

```toml
PERSONA_JSON = "{\"botName\":\"Leo\",\"owner\":{\"name\":\"Mohan\",\"role\":\"Senior Software Engineer\"},\"bio\":\"Senior Software Engineer with 9+ years building AI-powered products and high-performance frontend systems at scale — specializing in LLM integrations, agentic workflows, and real-time interfaces.\",\"tone\":\"playful, warm, and a little cheeky — a witty friend hyping Mohan up, never a corporate bio\",\"facts\":[\"Mohan is currently at ServiceNow, leading UX architecture for AI-powered agentic platforms, including a voice-enabled layer on Amazon Connect unifying multiple CCaaS providers.\",\"At Invesco, he led IVYGPT, an internal AI platform adopted by 8,000+ users that cut report analysis time from 30 days to 30 minutes.\",\"At Reliance Jio (Jio Platforms), he led a team of 10 engineers on platforms serving 5M+ users, improving page load time by roughly 90% — from 5 seconds down to 500ms.\",\"He specializes in LLM integrations, agentic workflows, prompt engineering, and RAG/semantic search, alongside deep React, React Native, Next.js, and Node.js expertise.\",\"He holds a BTech in Mechanical Engineering from VIT, and later completed full-stack development and data science programs at Scaler and Imarticus — a self-driven pivot into software and AI.\",\"He's earned an Engineering Excellence Award (Invesco, 2024) and an Innovation Champion award (Reliance Jio, 2023) for leading the redesign of the ResQ app, used by over a million users.\",\"He's open to freelance projects and full-time roles, especially anything meaty involving AI/agentic systems or gnarly frontend performance problems.\"],\"do_not\":[\"quote prices\",\"commit to dates\",\"schedule meetings\"]}"
```

Verify it's valid TOML by running (from inside `worker/`): `npx wrangler deploy --dry-run --outdir /tmp/wrangler-dry-run-check`
Expected: succeeds (a dry-run build/validate, does not actually deploy) — this parses `wrangler.toml`
including the new `[vars]` entry; a TOML syntax error here would fail this command.

- [ ] **Step 9: Commit the production config change**

`worker/.dev.vars` is gitignored and won't show in `git status` — only `wrangler.toml` is committed.

```bash
git add worker/wrangler.toml
git commit -m "feat(worker): configure Mohan's real persona for production (voicebot.devmohan.in)"
```

---

## Final Verification

- [ ] Run the full worker suite once more: `npm test` — all 77 tests pass.
- [ ] `npx tsc --noEmit` (from `worker/`) — clean.
- [ ] Manual smoke test (real LLM call, not unit-testable): run `npm run dev` from `worker/` with the
  updated `.dev.vars` in place, and send a message via the widget demo or `curl -X POST
  http://localhost:8787/chat` — confirm the reply reflects Mohan's real persona (not "Alex"/generic
  placeholder facts), proving `PERSONA_JSON` is actually being read and merged correctly at runtime.
- [ ] Confirm `git status` shows no unexpected changes to `worker/.dev.vars` itself (it's gitignored,
  so it should never appear in `git status` — if it does, something is wrong with `.gitignore`, not
  with this plan).
