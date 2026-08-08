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
      behavior: { maxTurnsPerSession: 12 },
      widget: { branding: { botName: "Leo", greeting: "Hi" } },
      instructions: "Stay brief.",
    });
    expect(next.allowedOrigins).toEqual(["https://www.example.com", "https://blog.example.com"]);
    expect(next.persona.owner.name).toBe("Sam");
    expect(next.maxTurnsPerSession).toBe(12);
    expect(next.configSource).toBe("kv");
    expect(next.widget).toEqual({ branding: { botName: "Leo", greeting: "Hi" } });
    expect(next.persona.instructions).toBe("Stay brief.");
  });

  it("prefers top-level instructions over persona.instructions", () => {
    const base = loadConfig({} as Env);
    const next = applyKvAppConfig(base, {
      instructions: "From top-level",
      persona: { instructions: "From persona" },
    });
    expect(next.persona.instructions).toBe("From top-level");
  });

  it("never lets KV override mode — it is the master enforcement switch", () => {
    const base = loadConfig({ MODE: "prod" } as Env);
    const next = applyKvAppConfig(base, { behavior: { mode: "dev" } } as never);
    expect(next.mode).toBe("prod");
  });

  it("coerces CMS-authored numeric strings and ignores unusable values", () => {
    const base = loadConfig({} as Env);
    const next = applyKvAppConfig(base, {
      behavior: { maxMessageChars: "500" as unknown as number, maxTurnsPerSession: 0, maxTtsChars: NaN },
    });
    expect(next.maxMessageChars).toBe(500);
    expect(next.maxTurnsPerSession).toBe(base.maxTurnsPerSession);
    expect(next.maxTtsChars).toBe(base.maxTtsChars);
  });

  it("strips trailing slashes from KV origins so they can match an Origin header", () => {
    const base = loadConfig({} as Env);
    expect(applyKvAppConfig(base, { allowedOrigins: ["https://a.test/", " https://b.test "] }).allowedOrigins)
      .toEqual(["https://a.test", "https://b.test"]);
  });

  it("keeps base config when KV overlay is empty", () => {
    const base = loadConfig({ ALLOWED_ORIGINS: "https://a.test" } as Env);
    // null = nothing read, still bootstrap. {} = a real read that carried no overrides.
    expect(applyKvAppConfig(base, null)).toEqual(base);
    expect(applyKvAppConfig(base, {})).toEqual({ ...base, configSource: "kv" });
  });

  it("marks env-only config as bootstrap so /health can flag an unsynced deploy", () => {
    expect(loadConfig({} as Env).configSource).toBe("bootstrap");
  });

  it("mergePersona deep-merges owner", () => {
    expect(mergePersona(defaultPersona, { owner: { name: "Sam" } }).owner).toEqual({
      name: "Sam",
      role: defaultPersona.owner.role,
    });
  });
});
