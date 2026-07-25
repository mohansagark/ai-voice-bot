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
  it("never asks the same or a similarly-worded question twice in one conversation", () => {
    expect(prompt).toMatch(/never ask the same.*question twice|similarly-worded question twice/i);
  });
  it("reads the room and backs off on a short/disinterested reply, with a matching example", () => {
    expect(prompt).toMatch(/read the room/i);
    expect(prompt).toContain(`Visitor: "nothing, stop" → You: "No worries — I'm here if you think of something."`);
  });
  it("instructs switching to pronouns after the owner's name is established", () => {
    expect(prompt).toMatch(/he\/him\/his/i);
    expect(prompt).toMatch(/don't (repeat|say) his name in every/i);
  });
  it("instructs answering the actual question instead of reciting a fact as filler", () => {
    expect(prompt).toMatch(/answer the actual question/i);
    expect(prompt).toMatch(/not.*(as|the) (a )?non-sequitur|not as the answer/i);
  });
  it("scopes the 'above my pay grade' deflection to Mohan-specific unknowns, not general knowledge", () => {
    expect(prompt).toMatch(/above my pay grade.*only for|only for.*specifically about/i);
    expect(prompt).toMatch(/don't hedge or deflect/i);
  });
});
