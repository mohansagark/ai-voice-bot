import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../src/prompts";
import { defaultPersona } from "../src/config";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(defaultPersona);
  it("names the owner and role", () => {
    expect(prompt).toContain("Mohan");
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
  it("carries the human, playful voice guidance (lead with personality, not a résumé)", () => {
    expect(prompt).toMatch(/playful/i);
    expect(prompt).toMatch(/LinkedIn bio|r[eé]sum[eé]/i);
    expect(prompt).toMatch(/never sound like|not a corporate chatbot/i);
  });
  it("forbids revealing it's an AI and forbids repeated re-saving", () => {
    expect(prompt).toMatch(/never say or imply you are an AI|language model/i);
    expect(prompt).toMatch(/save_lead only ONCE|already taken their details/i);
  });
});
