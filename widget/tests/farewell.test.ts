import { describe, it, expect } from "vitest";
import { isFarewell } from "../src/farewell";

describe("isFarewell", () => {
  it("matches common farewell/stop phrases, case-insensitively and with punctuation", () => {
    for (const t of ["bye", "Bye!", "bye bye", "BYE BYE", "goodbye", "good bye", "bye for now", "see ya", "see you", "talk later", "end", "stop", "quit", "that's all", "thats it", "i'm done", "we're done"]) {
      expect(isFarewell(t)).toBe(true);
    }
  });

  it("ignores leading/trailing whitespace", () => {
    expect(isFarewell("   bye   ")).toBe(true);
  });

  it("does not match when the word is embedded in a longer, unrelated sentence", () => {
    for (const t of [
      "what's the end goal of this project",
      "please stop asking me the same question",
      "I need to quit my current job before starting",
      "can we end the call in 10 minutes",
    ]) {
      expect(isFarewell(t)).toBe(false);
    }
  });

  it("does not match ordinary conversational messages", () => {
    for (const t of ["hello", "I want to schedule a call", "my email is a@b.com", ""]) {
      expect(isFarewell(t)).toBe(false);
    }
  });
});
