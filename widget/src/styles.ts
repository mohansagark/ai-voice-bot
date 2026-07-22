export function css(theme: string): string {
  return `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .orb {
    position: fixed; bottom: 20px; z-index: 2147483000;
    width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
    background: ${theme}; color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.28);
    display: grid; place-items: center; font-size: 24px; transition: transform .15s ease;
  }
  .orb:hover { transform: scale(1.05); }
  .orb:focus-visible { outline: 3px solid ${theme}; outline-offset: 3px; }
  .orb.pos-right { right: 20px; } .orb.pos-left { left: 20px; }
  @keyframes avb-pulse { 0%,100% { box-shadow: 0 6px 24px rgba(0,0,0,.28); } 50% { box-shadow: 0 6px 30px ${theme}66; } }
  .orb.idle { animation: avb-pulse 2.4s ease-in-out infinite; }
  @keyframes avb-spin { to { transform: rotate(360deg); } }
  .orb.thinking::after { content:""; width:22px; height:22px; border:3px solid #ffffff55; border-top-color:#fff; border-radius:50%; animation: avb-spin .8s linear infinite; }
  .orb.thinking { font-size: 0; }

  .panel {
    position: fixed; bottom: 88px; width: 360px; max-width: calc(100vw - 32px);
    height: 520px; max-height: calc(100vh - 120px); z-index: 2147483000;
    background: #fff; color: #17151f; border-radius: 16px; overflow: hidden;
    box-shadow: 0 12px 48px rgba(0,0,0,.24); display: none; flex-direction: column;
  }
  .panel.pos-right { right: 20px; } .panel.pos-left { left: 20px; }
  .panel[data-open="true"] { display: flex; }
  .hd { background: ${theme}; color: #fff; padding: 14px 16px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }
  .hd button { background: transparent; border: none; color: #fff; font-size: 20px; cursor: pointer; line-height: 1; }
  .list { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: 82%; padding: 9px 12px; border-radius: 14px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
  .msg.bot { background: #f0eef7; align-self: flex-start; border-bottom-left-radius: 4px; }
  .msg.user { background: ${theme}; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
  .msg.note { align-self: center; background: transparent; color: #8a85a0; font-size: 12px; padding: 2px; }
  .consent { align-self: stretch; background: #f7f6fb; border: 1px solid #e2dff0; border-radius: 12px; padding: 12px; font-size: 13px; color: #4a4560; }
  .consent a { color: ${theme}; }
  .consent button { margin-top: 8px; background: ${theme}; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
  form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #eee; }
  input { flex: 1; padding: 10px 12px; border: 1px solid #ddd; border-radius: 10px; font-size: 14px; }
  input:focus-visible { outline: 2px solid ${theme}; outline-offset: 1px; }
  form button { background: ${theme}; color: #fff; border: none; border-radius: 10px; padding: 10px 14px; cursor: pointer; }
  @media (prefers-reduced-motion: reduce) { .orb.idle { animation: none; } .orb.thinking::after { animation-duration: 1.6s; } }
  `;
}
