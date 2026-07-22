import { describe, it, expect } from "vitest";
import { buildModel } from "../src/providers";
import { loadConfig, type Env } from "../src/config";

describe("buildModel", () => {
  const config = loadConfig({} as Env);
  it("throws for an unknown provider", () => {
    expect(() => buildModel(config, { GROQ_API_KEY: "x" } as Env, "nope")).toThrow(/Unknown provider/);
  });
  it("throws when the provider key is missing", () => {
    expect(() => buildModel(config, {} as Env, "groq")).toThrow(/Missing key/);
  });
  it("builds a model exposing bindTools when the key is present", () => {
    const m = buildModel(config, { GROQ_API_KEY: "x" } as Env, "groq");
    expect(typeof m.bindTools).toBe("function");
  });
});
