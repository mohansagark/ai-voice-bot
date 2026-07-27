import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTypewriter } from "../src/typewriter";

describe("createTypewriter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reveals pushed text gradually, not all at once", () => {
    const revealed: string[] = [];
    const tw = createTypewriter((c) => revealed.push(c), { charsPerTick: 2, intervalMs: 10 });
    tw.push("hello world");
    expect(revealed.join("")).toBe(""); // nothing revealed synchronously
    vi.advanceTimersByTime(10);
    expect(revealed.join("")).toBe("he");
    vi.advanceTimersByTime(10);
    expect(revealed.join("")).toBe("hell");
    vi.advanceTimersByTime(100); // drain the rest
    expect(revealed.join("")).toBe("hello world");
  });

  it("keeps revealing newly-pushed text without restarting the timer", () => {
    const revealed: string[] = [];
    const tw = createTypewriter((c) => revealed.push(c), { charsPerTick: 3, intervalMs: 10 });
    tw.push("abc");
    vi.advanceTimersByTime(10); // reveals "abc" fully in one tick
    expect(revealed.join("")).toBe("abc");
    tw.push("def"); // arrives after the queue had drained and the timer stopped
    vi.advanceTimersByTime(10);
    expect(revealed.join("")).toBe("abcdef");
  });

  it("tracks total pushed text for reconciliation against the true final reply", () => {
    const tw = createTypewriter(() => {});
    tw.push("Hello");
    tw.push(", world");
    expect(tw.pushed()).toBe("Hello, world");
  });

  it("stop() clears the queue and halts further reveals", () => {
    const revealed: string[] = [];
    const tw = createTypewriter((c) => revealed.push(c), { charsPerTick: 1, intervalMs: 10 });
    tw.push("hello");
    vi.advanceTimersByTime(20); // reveals "he"
    tw.stop();
    vi.advanceTimersByTime(1000);
    expect(revealed.join("")).toBe("he"); // nothing more revealed after stop
  });

  it("a fresh push after stop() starts revealing again", () => {
    const revealed: string[] = [];
    const tw = createTypewriter((c) => revealed.push(c), { charsPerTick: 1, intervalMs: 10 });
    tw.push("ab");
    tw.stop();
    tw.push("cd");
    vi.advanceTimersByTime(20);
    expect(revealed.join("")).toBe("cd");
  });
});
