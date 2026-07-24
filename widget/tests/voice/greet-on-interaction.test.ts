import { describe, it, expect, vi } from "vitest";
import { speakGreetingOnInteraction } from "../../src/voice/greet-on-interaction";

describe("speakGreetingOnInteraction", () => {
  it("speaks immediately when the visitor already interacted with the page (userActivation.hasBeenActive)", () => {
    const speak = vi.fn();
    speakGreetingOnInteraction(speak, { userActivation: { hasBeenActive: true } });
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("waits for the first click/keydown/touchstart when there's no prior activation", () => {
    const speak = vi.fn();
    const listeners: Record<string, () => void> = {};
    const addEventListener = vi.fn((type: string, cb: () => void) => { listeners[type] = cb; });
    speakGreetingOnInteraction(speak, { userActivation: { hasBeenActive: false }, addEventListener });
    expect(speak).not.toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalledWith("click", expect.any(Function), { once: true, capture: true });
    expect(addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function), { once: true, capture: true });
    expect(addEventListener).toHaveBeenCalledWith("touchstart", expect.any(Function), { once: true, capture: true });
    listeners.click();
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("treats a missing/unsupported userActivation the same as false — waits for interaction", () => {
    const speak = vi.fn();
    const listeners: Record<string, () => void> = {};
    const addEventListener = vi.fn((type: string, cb: () => void) => { listeners[type] = cb; });
    speakGreetingOnInteraction(speak, { addEventListener }); // no userActivation provided at all
    expect(speak).not.toHaveBeenCalled();
    listeners.keydown();
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("only speaks once even if more than one interaction listener fires", () => {
    const speak = vi.fn();
    const listeners: Record<string, () => void> = {};
    const addEventListener = vi.fn((type: string, cb: () => void) => { listeners[type] = cb; });
    speakGreetingOnInteraction(speak, { userActivation: { hasBeenActive: false }, addEventListener });
    listeners.click();
    listeners.keydown();
    listeners.touchstart();
    expect(speak).toHaveBeenCalledTimes(1);
  });
});
