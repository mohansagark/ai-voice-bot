import { describe, it, expect } from "vitest";
import { isSpam, defaultSpamConfig } from "../src/spam";

describe("isSpam", () => {
  it("does not flag before the minimum turns", () => {
    expect(isSpam(Array(7).fill("spam"))).toBe(false); // 7 < 8
  });

  it("does not flag a diverse conversation at/after the threshold", () => {
    const convo = ["hi", "who is mohan?", "what does he do?", "is he free?", "cool", "tell me more", "nice", "thanks"];
    expect(isSpam(convo)).toBe(false);
  });

  it("flags one message repeated >= 4 times (once past the threshold)", () => {
    const msgs = ["hi", "who is mohan?", "buy now", "buy now", "buy now", "buy now", "ok", "sure"];
    expect(isSpam(msgs)).toBe(true);
  });

  it("flags low-diversity flooding (few distinct cycled many times)", () => {
    const msgs = ["a", "b", "c", "a", "b", "c", "a", "b", "c"]; // 9 msgs, 3 distinct <= floor(9/3)=3
    expect(isSpam(msgs)).toBe(true);
  });

  it("normalizes case and whitespace when counting repeats", () => {
    const msgs = ["Hi", "ok", "SPAM", "spam  ", " spam", "spam", "x", "y", "spam"];
    // "spam" (normalized) appears 5 times >= 4 -> spam
    expect(isSpam(msgs)).toBe(true);
  });

  it("respects a custom config", () => {
    expect(isSpam(["x", "x", "x"], { minTurns: 3, maxRepeats: 3, diversityDivisor: 3 })).toBe(true);
  });
});
