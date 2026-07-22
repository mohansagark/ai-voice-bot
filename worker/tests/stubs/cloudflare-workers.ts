// Test-only stub for the "cloudflare:workers" built-in module.
// Vitest runs in Node, which has no workerd runtime, so it can't resolve this
// specifier natively. wrangler (dry-run/deploy) resolves the real module at
// bundle time; this stub only exists so unit tests that transitively import
// src/session-do.ts (via src/index.ts, for the DO export wrangler requires)
// don't fail to resolve the import. No test exercises SessionDO's behavior
// here — DOs need the workers runtime (see session-do.ts / task brief).
export abstract class DurableObject<Env = unknown> {
  protected ctx: unknown;
  protected env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
