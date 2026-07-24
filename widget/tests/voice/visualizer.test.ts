import { describe, it, expect, vi } from "vitest";
import { createVisualizer } from "../../src/voice/visualizer";

function fakeAnalyser(byteValue: number) {
  return {
    fftSize: 64,
    frequencyBinCount: 32,
    getByteFrequencyData(arr: Uint8Array) { arr.fill(byteValue); },
  };
}
function fakeCtx(byteValue: number) {
  const analyser = fakeAnalyser(byteValue);
  return {
    createMediaStreamSource: () => ({ connect: () => {} }),
    createAnalyser: () => analyser,
    close: () => {},
  };
}

describe("createVisualizer", () => {
  it("invokes onLevel with a normalized level derived from analyser data, once per frame", async () => {
    const levels: number[] = [];
    let frameCb: ((t: number) => void) | null = null;
    const requestFrame = (cb: (t: number) => void) => { frameCb = cb; return 1; };
    const cancelFrame = vi.fn();
    const getUserMedia = async () => ({ getTracks: () => [] }) as unknown as MediaStream;
    const AudioContextCtor = vi.fn(() => fakeCtx(255)) as unknown as new () => any;

    const v = createVisualizer((l) => levels.push(l), { getUserMedia, AudioContextCtor, requestFrame, cancelFrame });
    await v.start();
    expect(levels).toEqual([1]); // byte value 255 -> normalized level 1
    frameCb!(0); // simulate the next animation frame firing
    expect(levels).toEqual([1, 1]);
    v.stop();
    expect(cancelFrame).toHaveBeenCalled();
  });

  it("never rejects/throws when getUserMedia rejects — fails silently", async () => {
    const getUserMedia = async () => { throw new Error("denied"); };
    const v = createVisualizer(() => {}, { getUserMedia });
    await expect(v.start()).resolves.toBeUndefined();
  });

  it("stop() is a safe no-op when called before start() ever ran", () => {
    const v = createVisualizer(() => {});
    expect(() => v.stop()).not.toThrow();
  });

  it("stop() releases every track on the acquired media stream", async () => {
    const stopCalls: boolean[] = [];
    const getUserMedia = async () => ({ getTracks: () => [{ stop: () => stopCalls.push(true) }, { stop: () => stopCalls.push(true) }] }) as unknown as MediaStream;
    const AudioContextCtor = vi.fn(() => fakeCtx(0)) as unknown as new () => any;
    const v = createVisualizer(() => {}, { getUserMedia, AudioContextCtor, requestFrame: () => 1, cancelFrame: () => {} });
    await v.start();
    v.stop();
    expect(stopCalls).toEqual([true, true]);
  });

  it("start() is idempotent — a second call while already running does not re-acquire the mic", async () => {
    let calls = 0;
    const getUserMedia = async () => { calls++; return { getTracks: () => [] } as unknown as MediaStream; };
    const AudioContextCtor = vi.fn(() => fakeCtx(0)) as unknown as new () => any;
    const v = createVisualizer(() => {}, { getUserMedia, AudioContextCtor, requestFrame: () => 1, cancelFrame: () => {} });
    await v.start();
    await v.start();
    expect(calls).toBe(1);
  });
});
