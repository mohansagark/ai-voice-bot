import { DurableObject } from "cloudflare:workers";
import { SessionStore, storageToKv, type SessionState, type DOStorageLike } from "./session-store";

// One instance per session_id (via idFromName). Storage only — no agent logic here.
export class SessionDO extends DurableObject {
  private store = new SessionStore(storageToKv(this.ctx.storage as unknown as DOStorageLike));

  async load(): Promise<SessionState> {
    return this.store.load();
  }
  async save(state: SessionState): Promise<void> {
    return this.store.save(state);
  }
}
