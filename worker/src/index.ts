import { loadConfig, providers, type Env, type AppConfig } from "./config";

export interface Deps { /* filled in Task 8 */ }

function corsHeaders(origin: string, allowed: string[]): Record<string, string> {
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    "access-control-allow-origin": ok && origin ? origin : "null",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

export function createApp(_deps: Deps = {}) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const config: AppConfig = loadConfig(env);
      const origin = request.headers.get("origin") || "";
      const cors = corsHeaders(origin, config.allowedOrigins);

      if (request.method === "OPTIONS") return new Response(null, { headers: cors });

      if (url.pathname === "/health") {
        const p = config.providers[config.defaultProvider];
        return Response.json(
          { ok: true, provider: config.defaultProvider, model: p?.model, tts: "browser", leads: env.WEBHOOK_URL ? "webhook" : "none" },
          { headers: cors },
        );
      }

      return new Response("Not found", { status: 404, headers: cors });
    },
  };
}

export default createApp();
