import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../src/prompts";
import { defaultPersona } from "../src/config";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(defaultPersona);
  it("names the owner and role", () => {
    expect(prompt).toContain(defaultPersona.owner.name);
    expect(prompt).toContain("Software Engineer");
  });
  it("introduces itself by the configured bot name", () => {
    expect(prompt).toContain("Leo");
  });
  it("includes every allowed fact", () => {
    for (const fact of defaultPersona.facts) expect(prompt).toContain(fact);
  });
  it("states the never-quote/commit-timelines rule and allows meeting capture", () => {
    expect(prompt).toMatch(/never quote prices/i);
    expect(prompt).toMatch(/commit to delivery timelines/i);
    expect(prompt).toMatch(/DO help visitors who want to meet/i);
    expect(prompt).toMatch(/do NOT check his calendar/i);
  });
  it("defaults to minimal reply length and expands only when asked about the owner", () => {
    expect(prompt).toMatch(/DEFAULT LENGTH: keep every reply minimal/i);
    expect(prompt).toMatch(/EXPAND ONLY when the visitor clearly wants to know/i);
  });
  it("includes configured do_not rules from the persona", () => {
    for (const rule of defaultPersona.do_not) expect(prompt).toContain(rule);
  });
  it("includes the owner bio when present", () => {
    expect(prompt).toContain("Owner bio (from site config):");
    expect(prompt).toContain(defaultPersona.bio);
  });
  it("appends SITE INSTRUCTIONS when persona.instructions is set", () => {
    const withInstr = buildSystemPrompt({
      ...defaultPersona,
      instructions: "Always mention the portfolio blog when relevant.",
    });
    expect(withInstr).toContain("SITE INSTRUCTIONS");
    expect(withInstr).toContain("Always mention the portfolio blog when relevant.");
  });
  it("omits SITE INSTRUCTIONS when instructions are empty", () => {
    expect(buildSystemPrompt({ ...defaultPersona, instructions: "  " })).not.toContain("SITE INSTRUCTIONS");
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
  it("does not hardcode a specific personality example into the generic instruction text", () => {
    expect(prompt).not.toMatch(/sharp, hands-on problem-solver who genuinely loves the hard stuff/i);
  });
  it("omits the portfolio knowledge block entirely when no portfolioContext is configured", () => {
    expect(prompt).not.toContain("PORTFOLIO KNOWLEDGE");
  });
  it("includes the full portfolio knowledge block when portfolioContext is configured", () => {
    const withContext = buildSystemPrompt(defaultPersona, "=== PROJECTS ===\n- Widget Thing: a thing.");
    expect(withContext).toContain("PORTFOLIO KNOWLEDGE");
    expect(withContext).toContain("=== PROJECTS ===");
    expect(withContext).toContain("Widget Thing");
  });
  it("instructs against mashing two real things together into a fabricated answer", () => {
    expect(prompt).toMatch(/don't guess/i);
    expect(prompt).toMatch(/mashing two real things together/i);
  });
  it("allows one clarifying guess for a likely mis-transcribed term, without assuming", () => {
    expect(prompt).toMatch(/did you mean/i);
    expect(prompt).toMatch(/never just assume and answer/i);
  });
  it("instructs asking for the visitor's first name early, separate from the save_lead flow", () => {
    expect(prompt).toMatch(/within your first reply or two/i);
    expect(prompt).toMatch(/separate from.*save_lead/i);
  });
  it("instructs treating 'email him' requests as save_lead, not drafting a message for the visitor", () => {
    expect(prompt).toMatch(/not write an email\/message draft/i);
    expect(prompt).toMatch(/capture their note via save_lead/i);
  });
  it("instructs recognizing the [Preferred time: ...] marker and passing it to save_lead without scheduling", () => {
    expect(prompt).toMatch(/\[Preferred time: \.\.\.\]/);
    expect(prompt).toMatch(/preferredTime field verbatim/i);
    expect(prompt).toMatch(/do NOT confirm availability|treat it as a booking/i);
  });
  it("instructs actually calling show_time_picker rather than just describing it in text", () => {
    expect(prompt).toMatch(/actually CALL the show_time_picker tool/i);
    expect(prompt).toMatch(/never just describe it in words/i);
  });
  it("instructs never inventing a specific date/time itself", () => {
    expect(prompt).toMatch(/NEVER state, invent, or imply a specific date\/time/i);
    expect(prompt).toMatch(/call show_time_picker instead of guessing or making one up/i);
  });
  it("instructs not overusing the visitor's own name", () => {
    expect(prompt).toMatch(/same goes for the visitor's own name/i);
    expect(prompt).toMatch(/not as a "Hey \[Name\]!" opener on every single reply/i);
  });
  it("instructs never insisting on optional phone/company fields or suggesting a placeholder", () => {
    expect(prompt).toMatch(/Phone and company are OPTIONAL on save_lead/i);
    expect(prompt).toMatch(/never ask for them, insist on them, or suggest a "placeholder" value/i);
  });
  it("instructs not looping on a categorization question for what the visitor wants", () => {
    expect(prompt).toMatch(/Don't ask the visitor to categorize what they want/i);
    expect(prompt).toMatch(/accept whatever you get.*as their save_lead message/i);
  });
  it("instructs not fully solving the visitor's stated need instead of capturing it as their message", () => {
    expect(prompt).toMatch(/don't fully solve or advise on it yourself/i);
    expect(prompt).toMatch(/keep moving toward save_lead/i);
  });
  it("instructs never giving out an email address (his or the visitor's) as a contact method", () => {
    expect(prompt).toMatch(/NEVER give out an email address as "the way to reach him"/i);
    expect(prompt).toMatch(/not the visitor's own either/i);
  });
  it("instructs never confirming a visitor-proposed time stated in plain text as booked", () => {
    expect(prompt).toMatch(/is NOT a confirmed booking/i);
    expect(prompt).toMatch(/never say "works for me," "I'll lock it in," "consider it booked,"/i);
  });
});
