export interface Typewriter {
  // Queue newly-arrived stream text to be revealed gradually rather than all at once.
  push(text: string): void;
  // Total text ever pushed, in order — lets the caller diff against the true final
  // reply once the stream ends (network chunking can occasionally diverge slightly).
  pushed(): string;
  // Cancel immediately: clears the queue and stops the reveal timer.
  stop(): void;
}

export interface TypewriterOpts {
  charsPerTick?: number;
  intervalMs?: number;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
}

const DEFAULT_CHARS_PER_TICK = 2;
const DEFAULT_INTERVAL_MS = 20;

export function createTypewriter(onReveal: (chunk: string) => void, opts: TypewriterOpts = {}): Typewriter {
  const charsPerTick = opts.charsPerTick ?? DEFAULT_CHARS_PER_TICK;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const setIntervalImpl = opts.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = opts.clearIntervalImpl ?? clearInterval;

  let queue = "";
  let allPushed = "";
  let timer: ReturnType<typeof setInterval> | null = null;

  const stopTimer = () => {
    if (timer !== null) { clearIntervalImpl(timer); timer = null; }
  };

  const tick = () => {
    if (!queue) { stopTimer(); return; }
    const chunk = queue.slice(0, charsPerTick);
    queue = queue.slice(charsPerTick);
    onReveal(chunk);
  };

  return {
    push(text: string) {
      if (!text) return;
      queue += text;
      allPushed += text;
      if (timer === null) timer = setIntervalImpl(tick, intervalMs);
    },
    pushed: () => allPushed,
    stop() {
      stopTimer();
      queue = "";
    },
  };
}
