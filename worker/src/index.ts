import { loadConfig, type Env, type AppConfig, type Consent } from "./config";
import { buildModel } from "./providers";
import { buildGraph } from "./agent/graph";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

// Wrangler requires Durable Object classes referenced in wrangler.toml bindings
// to be exported from the entrypoint module so the bundler can locate them.
export { SessionDO } from "./session-do";

export interface Deps { buildModel: typeof buildModel; }

function corsHeaders(origin: string, allowed: string[]): Record<string, string> {
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    "access-control-allow-origin": ok && origin ? origin : "null",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

interface ChatBody { messages?: { role: string; content: string }[]; consent?: Consent; }

export function createApp(deps: Deps = { buildModel }) {
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

      if (url.pathname === "/chat" && request.method === "POST") {
        if (config.allowedOrigins.length && !config.allowedOrigins.includes(origin)) {
          return Response.json({ error: "origin not allowed" }, { status: 403, headers: cors });
        }
        const body = (await request.json().catch(() => null)) as ChatBody | null;
        if (!body?.messages?.length) {
          return Response.json({ error: "messages required" }, { status: 400, headers: cors });
        }
        if (body.messages.length > config.maxTurnsPerSession) {
          return Response.json({ error: "too many turns" }, { status: 429, headers: cors });
        }
        const lastMessage = body.messages[body.messages.length - 1];
        if ((lastMessage?.content?.length ?? 0) > config.maxMessageChars) {
          return Response.json({ error: "message too long" }, { status: 413, headers: cors });
        }

        let model: ReturnType<typeof deps.buildModel>;
        try { model = deps.buildModel(config, env); }
        catch (e) { return Response.json({ error: String((e as Error).message) }, { status: 500, headers: cors }); }

        try {
          const graph = buildGraph({ model, persona: config.persona, webhookUrl: env.WEBHOOK_URL || "" });
          const lcMessages = body.messages.map((m) =>
            m.role === "assistant" ? new AIMessage(m.content) : new HumanMessage(m.content));
          const result = await graph.invoke({
            messages: lcMessages,
            consent: body.consent ?? { agreed: false },
          });
          const out = result.messages[result.messages.length - 1];
          const reply = typeof out?.content === "string" ? out.content : "";
          return Response.json(
            { reply, lead_saved: result.leadSaved, lead: result.leadSaved ? result.lead : null },
            { headers: cors },
          );
        } catch (e) {
          return Response.json(
            { error: String((e as Error).message), reply: "Sorry, something went wrong on my end. Please try again." },
            { status: 502, headers: cors },
          );
        }
      }

      return new Response("Not found", { status: 404, headers: cors });
    },
  };
}

export default createApp();
