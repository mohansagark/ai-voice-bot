export interface Store { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void; }
export interface Consent { agreed: true; timestamp: string; text: string; }

const K_ID = "avb_session", K_NAME = "avb_name", K_CONSENT = "avb_consent";

export function memoryStore(): Store {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}

export function safeStore(): Store {
  try {
    const t = "__avb__"; localStorage.setItem(t, "1"); localStorage.removeItem(t);
    return { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
  } catch { return memoryStore(); }
}

function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function createSession(store: Store) {
  const id = () => {
    let v = store.get(K_ID);
    if (!v) { v = uuid(); store.set(K_ID, v); }
    return v;
  };
  return {
    id,
    name: () => store.get(K_NAME),
    setName: (n: string) => store.set(K_NAME, n),
    consent: (): Consent | null => { const raw = store.get(K_CONSENT); return raw ? (JSON.parse(raw) as Consent) : null; },
    setConsent: (text: string): Consent => {
      const c: Consent = { agreed: true, timestamp: new Date().toISOString(), text };
      store.set(K_CONSENT, JSON.stringify(c));
      return c;
    },
    forget: () => { store.remove(K_ID); store.remove(K_NAME); store.remove(K_CONSENT); },
  };
}
