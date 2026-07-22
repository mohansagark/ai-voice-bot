export function emit(cb: ((e: string, p?: unknown) => void) | null, event: string, payload?: unknown): void {
  try { cb?.(event, payload); } catch { /* never let analytics break the widget */ }
}
