import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../src/prompts";
import { defaultPersona } from "../src/config";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(defaultPersona);
  it("names the owner and role", () => {
    expect(prompt).toContain("Mohan Sagar K");
    expect(prompt).toContain("Software Engineer");
  });
  it("introduces itself by the configured bot name", () => {
    expect(prompt).toContain("Leo");
  });
  it("includes every allowed fact", () => {
    for (const fact of defaultPersona.facts) expect(prompt).toContain(fact);
  });
  it("states the never-quote/commit/schedule rule", () => {
    expect(prompt).toMatch(/never quote prices|commit to timelines|schedule/i);
  });
  it("instructs to call save_lead", () => {
    expect(prompt).toContain("save_lead");
  });
});
