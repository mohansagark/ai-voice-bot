export interface LevelRefs {
  micHalo: HTMLElement;
  micBars: HTMLElement;
  waveform: HTMLElement;
}

export function barHeight(level: number, index: number, now: number, min = 4, max = 20): number {
  const phase = Math.sin(index * 0.6 + now / 200);
  const v = Math.max(0, Math.min(1, level + phase * 0.15));
  return min + v * (max - min);
}

export function applyLevel(refs: LevelRefs, level: number, now: number = performance.now()): void {
  const clamped = Math.max(0, Math.min(1, level));

  refs.micHalo.style.opacity = String(0.4 + clamped * 0.6);
  refs.micHalo.style.transform = `scale(${0.8 + clamped * 0.7})`;

  refs.micBars.querySelectorAll("span").forEach((el, i) => {
    (el as HTMLElement).style.height = `${barHeight(clamped, i, now, 4, 14)}px`;
  });

  refs.waveform.querySelectorAll("span").forEach((el, i) => {
    (el as HTMLElement).style.height = `${barHeight(clamped, i, now, 4, 30)}px`;
  });
}
