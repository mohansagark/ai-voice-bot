// Matches only when the WHOLE (trimmed) message is a farewell/stop phrase — not merely
// containing one of these words, to avoid false positives like "what's the end goal here".
const FAREWELL_RE = /^(bye( bye)?|goodbye|good bye|bye for now|see ya|see you|talk later|end|stop|quit|that'?s (all|it)|i'?m done|we'?re done)[.!\s]*$/i;

export function isFarewell(text: string): boolean {
  return FAREWELL_RE.test(text.trim());
}
