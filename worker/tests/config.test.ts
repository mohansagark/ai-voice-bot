import { describe, it, expect } from "vitest";
import {
  loadConfig,
  loadPersona,
  defaultPersona,
  applyKvAppConfig,
  mergePersona,
  type Env,
} from "../src/config";

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

describe("applyKvAppConfig", () => {
  it("overlays persona and allowedOrigins from KV app_config", () => {
    const base = loadConfig({} as Env);
    const next = applyKvAppConfig(base, {
      allowedOrigins: ["https://www.example.com", "https://blog.example.com"],
      persona: {
        botName: "Leo",
        owner: { name: "Sam", role: "Engineer" },
        bio: "Builder.",
        tone: "warm",
        facts: ["Sam builds things."],
        do_not: ["quote prices"],
      },
      behavior: { maxTurnsPerSession: 12, mode: "prod" },
    });
    expect(next.allowedOrigins).toEqual(["https://www.example.com", "https://blog.example.com"]);
    expect(next.persona.owner.name).toBe("Sam");
    expect(next.maxTurnsPerSession).toBe(12);
    expect(next.mode).toBe("prod");
  });

  it("keeps base config when KV overlay is empty", () => {
    const base = loadConfig({ ALLOWED_ORIGINS: "https://a.test" } as Env);
    expect(applyKvAppConfig(base, null)).toEqual(base);
    expect(applyKvAppConfig(base, {})).toEqual(base);
  });

  it("mergePersona deep-merges owner", () => {
    expect(mergePersona(defaultPersona, { owner: { name: "Sam" } }).owner).toEqual({
      name: "Sam",
      role: defaultPersona.owner.role,
    });
  });
});
