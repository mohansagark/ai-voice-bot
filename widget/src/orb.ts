import type { Refs } from "./dom";

export function wireOrb(refs: Refs, onToggle?: (open: boolean) => void) {
  const setOpen = (open: boolean) => {
    refs.panel.setAttribute("data-open", String(open));
    if (open) refs.input.focus();
    onToggle?.(open);
  };
  const isOpen = () => refs.panel.getAttribute("data-open") === "true";
  refs.orb.addEventListener("click", () => setOpen(!isOpen()));
  refs.panel.querySelector(".close")!.addEventListener("click", () => setOpen(false));
  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen()),
    isOpen,
    setThinking: (on: boolean) => {
      refs.orb.classList.toggle("thinking", on);
      refs.orb.classList.toggle("idle", !on);
    },
  };
}
