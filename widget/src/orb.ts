import type { Refs } from "./dom";

type OrbState = "idle" | "thinking" | "listening" | "speaking";
const STATES: OrbState[] = ["idle", "thinking", "listening", "speaking"];

export function wireOrb(refs: Refs, onToggle?: (open: boolean) => void) {
  const setOpen = (open: boolean, focus = true) => {
    refs.panel.setAttribute("data-open", String(open));
    if (open && focus) refs.input.focus();
    onToggle?.(open);
  };
  const isOpen = () => refs.panel.getAttribute("data-open") === "true";
  refs.orb.addEventListener("click", () => setOpen(!isOpen()));
  refs.panel.querySelector(".close")!.addEventListener("click", () => setOpen(false));

  const setState = (state: OrbState) => {
    for (const s of STATES) refs.orb.classList.toggle(s, s === state);
  };

  const getCurrentState = (): OrbState => {
    for (const s of STATES) {
      if (refs.orb.classList.contains(s)) return s;
    }
    return "idle";
  };

  const makeStateToggle = (targetState: OrbState) => (on: boolean) => {
    if (on) setState(targetState);
    else if (getCurrentState() === targetState) setState("idle");
  };

  return {
    open: (opts?: { focus?: boolean }) => setOpen(true, opts?.focus ?? true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen()),
    isOpen,
    setThinking: makeStateToggle("thinking"),
    setListening: makeStateToggle("listening"),
    setSpeaking: makeStateToggle("speaking"),
  };
}
