export function css(theme: string, theme2: string): string {
  return `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .orb {
    position: fixed; bottom: 20px; z-index: 2147483000;
    width: 56px; height: 56px; border-radius: 22px; border: none; cursor: pointer;
    background: linear-gradient(120deg, ${theme}, ${theme2}); color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.28);
    display: grid; place-items: center; transition: transform .15s ease;
  }
  .orb:hover { transform: scale(1.05); }
  .orb:focus-visible { outline: 3px solid ${theme}; outline-offset: 3px; }
  .orb.pos-right { right: 20px; } .orb.pos-left { left: 20px; }
  @keyframes avb-pulse { 0%,100% { box-shadow: 0 6px 24px rgba(0,0,0,.28); } 50% { box-shadow: 0 6px 30px ${theme}66; } }
  .orb.idle { animation: avb-pulse 2.4s ease-in-out infinite; }
  @keyframes avb-spin { to { transform: rotate(360deg); } }
  .orb.thinking::after { content:""; width:22px; height:22px; border:3px solid #ffffff55; border-top-color:#fff; border-radius:50%; animation: avb-spin .8s linear infinite; }
  .orb.thinking svg { display: none; }
  @keyframes avb-listen { 0%,100% { box-shadow: 0 6px 24px rgba(0,0,0,.28); } 50% { box-shadow: 0 0 0 8px ${theme}33; } }
  .orb.listening { animation: avb-listen 1.2s ease-in-out infinite; }
  @keyframes avb-speak { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
  .orb.speaking { animation: avb-speak .6s ease-in-out infinite; }

  .panel {
    position: fixed; bottom: 88px; width: 360px; max-width: calc(100vw - 32px);
    height: 520px; max-height: calc(100vh - 120px); z-index: 2147483000;
    background: #17151f; color: #eae7f2; border-radius: 16px; overflow: hidden;
    box-shadow: 0 12px 48px rgba(0,0,0,.24); display: none; flex-direction: column;
  }
  .panel.pos-right { right: 20px; } .panel.pos-left { left: 20px; }
  .panel[data-open="true"] { display: flex; }
  .hd { position: relative; background: linear-gradient(120deg, ${theme}, ${theme2}); padding: 14px 16px 26px; }
  .hd-top { display: flex; align-items: center; justify-content: space-between; }
  .hd-top span { color: #fff; font-weight: 600; }
  .hd button { background: transparent; border: none; color: #fff; font-size: 20px; cursor: pointer; line-height: 1; }
  .hd-actions { display: flex; align-items: center; gap: 2px; }
  .avatar { position: absolute; left: 16px; bottom: -16px; width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(120deg, ${theme}, ${theme2}); box-shadow: 0 4px 10px rgba(0,0,0,.35); display: grid; place-items: center; }
  .avatar svg { width: 20px; height: 20px; }
  form .mic { background: transparent; border: 1px solid #332d42; color: #eae7f2; border-radius: 10px; padding: 8px 10px; cursor: pointer; font-size: 16px; }
  form .mic:disabled { opacity: .4; cursor: not-allowed; }
  form .mic.listening { border-color: ${theme}; }
  .list { flex: 1; overflow-y: auto; padding: 26px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: 82%; padding: 9px 12px; border-radius: 14px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
  .msg.bot { background: #241f30; align-self: flex-start; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
  .msg.user { background: linear-gradient(120deg, ${theme}, ${theme2}); color: #fff; align-self: flex-end; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
  .msg.note { align-self: center; background: transparent; color: #8a85a0; font-size: 12px; padding: 2px; }
  .msg-text { display: block; }
  .ts { display: block; margin-top: 4px; font-size: 11px; color: #756e8a; }
  .msg.user .ts { text-align: right; color: rgba(255,255,255,.75); }
  .typing { display: inline-flex; gap: 4px; padding: 2px 0; }
  .typing span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .5; animation: avb-bounce 1s infinite ease-in-out; }
  .typing span:nth-child(2) { animation-delay: .15s; }
  .typing span:nth-child(3) { animation-delay: .3s; }
  @keyframes avb-bounce { 0%,60%,100% { transform: translateY(0); opacity:.5; } 30% { transform: translateY(-4px); opacity:1; } }
  @keyframes avb-msg-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .msg-enter { animation: avb-msg-in .2s ease-out; }
  .consent { align-self: stretch; background: #f7f6fb; border: 1px solid #e2dff0; border-radius: 12px; padding: 12px; font-size: 13px; color: #4a4560; }
  .consent a { color: ${theme}; }
  .consent button { margin-top: 8px; background: ${theme}; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
  form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #2a2638; }
  input { flex: 1; padding: 10px 12px; border: 1px solid #332d42; background: #241f30; color: #eae7f2; border-radius: 10px; font-size: 14px; }
  input::placeholder { color: #756e8a; }
  input:focus-visible { outline: 2px solid ${theme}; outline-offset: 1px; }
  form button { background: linear-gradient(120deg, ${theme}, ${theme2}); color: #fff; border: none; border-radius: 10px; padding: 10px 14px; cursor: pointer; }
  @media (prefers-reduced-motion: reduce) { .orb.idle { animation: none; } .orb.thinking::after { animation-duration: 1.6s; } .orb.listening, .orb.speaking { animation: none; } .msg-enter { animation: none; } .typing span { animation: none; } }
  `;
}
