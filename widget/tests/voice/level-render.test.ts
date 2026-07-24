// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { barHeight, applyLevel } from "../../src/voice/level-render";

describe("barHeight", () => {
  it("stays within [min, max] across levels, indices, and time", () => {
    for (let level = 0; level <= 1; level += 0.25) {
      for (let i = 0; i < 5; i++) {
        const h = barHeight(level, i, 12345, 4, 20);
        expect(h).toBeGreaterThanOrEqual(4);
        expect(h).toBeLessThanOrEqual(20);
      }
    }
  });

  it("is taller for a higher level at a fixed index/time (phase term cancels at index 0, time 0)", () => {
    const low = barHeight(0, 0, 0, 4, 20);
    const high = barHeight(1, 0, 0, 4, 20);
    expect(high).toBeGreaterThan(low);
    expect(low).toBe(4);
    expect(high).toBe(20);
  });
});

describe("applyLevel", () => {
  function makeRefs() {
    const micHalo = document.createElement("span");
    const micBars = document.createElement("span");
    micBars.innerHTML = "<span></span><span></span><span></span>";
    const waveform = document.createElement("div");
    waveform.innerHTML = "<span></span><span></span>";
    return { micHalo, micBars, waveform };
  }

  it("sets the halo's opacity and scale from the level", () => {
    const refs = makeRefs();
    applyLevel(refs, 1, 0);
    expect(refs.micHalo.style.opacity).toBe("1");
    expect(refs.micHalo.style.transform).toBe("scale(1.5)");
  });

  it("sets a pixel height on every mic-bar and waveform span", () => {
    const refs = makeRefs();
    applyLevel(refs, 0.5, 100);
    refs.micBars.querySelectorAll("span").forEach((el) => {
      expect((el as HTMLElement).style.height).toMatch(/px$/);
    });
    refs.waveform.querySelectorAll("span").forEach((el) => {
      expect((el as HTMLElement).style.height).toMatch(/px$/);
    });
  });

  it("clamps out-of-range levels to [0, 1]", () => {
    const refs = makeRefs();
    applyLevel(refs, 5, 0);
    expect(refs.micHalo.style.opacity).toBe("1"); // same as level=1, not >1
  });
});
