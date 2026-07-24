export interface UserActivationLike { hasBeenActive: boolean; }
export interface InteractionDeps {
  userActivation?: UserActivationLike | null;
  addEventListener?: (type: string, cb: () => void, opts: { once: boolean; capture: boolean }) => void;
}

export function speakGreetingOnInteraction(speak: () => void, deps: InteractionDeps = {}): void {
  const activation = deps.userActivation ??
    (typeof navigator !== "undefined" ? (navigator as unknown as { userActivation?: UserActivationLike }).userActivation : undefined);
  if (activation?.hasBeenActive) {
    speak();
    return;
  }
  const addEventListener = deps.addEventListener ?? ((type, cb, opts) => window.addEventListener(type, cb, opts));
  let fired = false;
  const onInteract = () => {
    if (fired) return;
    fired = true;
    speak();
  };
  (["click", "keydown", "touchstart"] as const).forEach((type) => addEventListener(type, onInteract, { once: true, capture: true }));
}
