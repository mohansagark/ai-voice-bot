export interface SpamConfig {
  minTurns: number;       // don't evaluate until this many user messages exist
  maxRepeats: number;     // block if one normalized message appears >= this many times
  diversityDivisor: number; // block if distinct <= floor(count / divisor)
}

export const defaultSpamConfig: SpamConfig = { minTurns: 8, maxRepeats: 4, diversityDivisor: 3 };

function normalize(msg: string): string {
  return msg.trim().toLowerCase().replace(/\s+/g, " ");
}

// userMessages = every user-turn text this session, INCLUDING the current one.
// Pure + token-free: this is what lets us stop a spammer without calling the model.
export function isSpam(userMessages: string[], cfg: SpamConfig = defaultSpamConfig): boolean {
  const norm = userMessages.map(normalize).filter((m) => m.length > 0);
  if (norm.length < cfg.minTurns) return false;

  const counts = new Map<string, number>();
  for (const m of norm) counts.set(m, (counts.get(m) ?? 0) + 1);

  // (a) one message repeated too many times (copy-paste flooding)
  for (const c of counts.values()) if (c >= cfg.maxRepeats) return true;

  // (b) low diversity: only a few distinct messages cycled many times
  if (counts.size <= Math.floor(norm.length / cfg.diversityDivisor)) return true;

  return false;
}
