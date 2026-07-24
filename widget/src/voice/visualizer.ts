export interface AnalyserLike {
  fftSize: number;
  frequencyBinCount: number;
  getByteFrequencyData(arr: Uint8Array): void;
}
export interface AudioContextLike {
  createMediaStreamSource(stream: MediaStream): { connect(node: AnalyserLike): void };
  createAnalyser(): AnalyserLike;
  close(): Promise<void> | void;
}
export interface VisualizerDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  AudioContextCtor?: new () => AudioContextLike;
  requestFrame?: (cb: (t: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}
export interface Visualizer {
  start(): Promise<void>;
  stop(): void;
}

export function createVisualizer(onLevel: (level: number) => void, deps: VisualizerDeps = {}): Visualizer {
  let stream: MediaStream | null = null;
  let ctx: AudioContextLike | null = null;
  let frameHandle: number | null = null;
  let running = false;

  const requestFrame = deps.requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const cancelFrame = deps.cancelFrame ?? ((h) => cancelAnimationFrame(h));

  function releaseAcquired(): void {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (ctx) { try { ctx.close(); } catch { /* ignore */ } ctx = null; }
  }

  return {
    async start(): Promise<void> {
      if (running) return;
      running = true;
      try {
        const getUserMedia = deps.getUserMedia ?? ((c) => navigator.mediaDevices.getUserMedia(c));
        stream = await getUserMedia({ audio: true });
        const AudioContextCtor = deps.AudioContextCtor
          ?? (window as unknown as { AudioContext: new () => AudioContextLike }).AudioContext;
        ctx = new AudioContextCtor();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          onLevel(data.length ? sum / data.length / 255 : 0);
          frameHandle = requestFrame(tick);
        };
        tick();
      } catch {
        releaseAcquired(); // don't orphan a partially-acquired stream/context on later-step failure
        running = false; // fail silently (never throw into host); a later start() may retry
      }
    },
    stop(): void {
      running = false;
      if (frameHandle !== null) { cancelFrame(frameHandle); frameHandle = null; }
      releaseAcquired();
    },
  };
}
