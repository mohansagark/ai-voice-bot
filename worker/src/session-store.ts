import type { StoredMessage } from "./agent/serialize";
import type { Lead } from "./agent/state";

export interface KvLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, val: T): Promise<void>;
}

export interface SessionState {
  messages: StoredMessage[];
  lead: Lead;
  leadSaved: boolean;
  turns: number;
}

const KEY = "session";
const emptyState = (): SessionState => ({ messages: [], lead: {}, leadSaved: false, turns: 0 });

export class SessionStore {
  constructor(private kv: KvLike) {}
  async load(): Promise<SessionState> {
    return (await this.kv.get<SessionState>(KEY)) ?? emptyState();
  }
  async save(state: SessionState): Promise<void> {
    await this.kv.put(KEY, state);
  }
}

// A Durable Object's `ctx.storage` exposes get/put; adapt it to KvLike.
export interface DOStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}
export function storageToKv(storage: DOStorageLike): KvLike {
  return { get: (k) => storage.get(k), put: (k, v) => storage.put(k, v) };
}
