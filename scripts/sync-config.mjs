#!/usr/bin/env node
/**
 * Deploy-time sync: push site config + knowledge into Cloudflare, optionally
 * upsert API keys from environment variables into Worker secrets.
 *
 * Privileged — run in CI / local shell with Wrangler auth. Never call from the browser.
 *
 * Usage:
 *   node scripts/sync-config.mjs --config ./site-config.json [--context ./context.txt] [--secrets-from-env]
 *
 * Env (optional, with --secrets-from-env):
 *   GROQ_API_KEY, DEEPGRAM_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY,
 *   RESEND_API_KEY, LEAD_NOTIFY_FROM, LEAD_NOTIFY_TO, WEBHOOK_URL
 *
 * Wrangler:
 *   CLOUDFLARE_API_TOKEN (or prior `wrangler login`)
 *   --cwd defaults to ./worker relative to this repo
 */

import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const workerDir = join(repoRoot, "worker");

function parseArgs(argv) {
  const out = { config: null, context: null, secretsFromEnv: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") out.config = argv[++i];
    else if (a === "--context") out.context = argv[++i];
    else if (a === "--secrets-from-env") out.secretsFromEnv = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

function validateConfig(cfg) {
  if (!cfg || typeof cfg !== "object") throw new Error("config must be a JSON object");
  if (!Array.isArray(cfg.allowedOrigins) || cfg.allowedOrigins.length === 0) {
    throw new Error("config.allowedOrigins must be a non-empty array");
  }
  if (!cfg.persona || typeof cfg.persona !== "object") throw new Error("config.persona is required");
  for (const k of ["botName", "bio", "tone", "facts", "do_not"]) {
    if (cfg.persona[k] === undefined) throw new Error(`config.persona.${k} is required`);
  }
  if (!cfg.persona.owner?.name || !cfg.persona.owner?.role) {
    throw new Error("config.persona.owner.name and owner.role are required");
  }
}

function wrangler(args, { input } = {}) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: workerDir,
    input,
    encoding: "utf8",
    stdio: input !== undefined ? ["pipe", "pipe", "pipe"] : "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").toString();
    throw new Error(`wrangler ${args.join(" ")} failed:\n${err}`);
  }
  return result;
}

function kvPut(key, value, dryRun) {
  const dir = mkdtempSync(join(tmpdir(), "avb-sync-"));
  const path = join(dir, key.replace(/\W+/g, "_"));
  writeFileSync(path, value, "utf8");
  console.log(`→ KV put ${key} (${value.length} bytes)`);
  if (dryRun) {
    console.log(`  (dry-run) skip wrangler kv key put ${key}`);
    return;
  }
  wrangler(["kv", "key", "put", key, "--binding", "PORTFOLIO_KV", "--path", path], {});
}

function secretPut(name, value, dryRun) {
  console.log(`→ secret put ${name}`);
  if (dryRun) {
    console.log(`  (dry-run) skip wrangler secret put ${name}`);
    return;
  }
  wrangler(["secret", "put", name], { input: value });
}

const SECRET_ENV_KEYS = [
  "GROQ_API_KEY",
  "DEEPGRAM_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "RESEND_API_KEY",
  "LEAD_NOTIFY_FROM",
  "LEAD_NOTIFY_TO",
  "WEBHOOK_URL",
];

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.config) {
    console.log(`Usage: node scripts/sync-config.mjs --config <site-config.json> [--context <context.txt>] [--secrets-from-env] [--dry-run]`);
    process.exit(args.help ? 0 : 1);
  }

  const configPath = resolve(args.config);
  if (!existsSync(configPath)) throw new Error(`config not found: ${configPath}`);
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  validateConfig(cfg);

  // Strip nothing — store full app config (widget slice is public and unused by Worker).
  kvPut("app_config", JSON.stringify(cfg), args.dryRun);

  if (args.context) {
    const contextPath = resolve(args.context);
    if (!existsSync(contextPath)) throw new Error(`context not found: ${contextPath}`);
    kvPut("context", readFileSync(contextPath, "utf8"), args.dryRun);
  }

  if (args.secretsFromEnv) {
    for (const key of SECRET_ENV_KEYS) {
      const val = process.env[key];
      if (val && String(val).trim()) secretPut(key, String(val).trim(), args.dryRun);
    }
  }

  console.log("Sync complete.");
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
