import { loadConfig, type Env, type AppConfig, type Consent } from "./config";
import { buildModel } from "./providers";
import { buildGraph } from "./agent/graph";
import { HumanMessage } from "@langchain/core/messages";
import { serializeMessages, deserializeMessages } from "./agent/serialize";
import type { SessionState } from "./session-store";
import { SessionDO } from "./session-do";
import { streamChatSSE, makeGraphRunner, type GraphRunner, type GraphFinal } from "./stream";

export interface SessionHandle {
  load(): Promise<SessionState>;
  save(state: SessionState): Promise<void>;
}

// Default session accessor: a Durable Object per session_id (RPC methods load/save).
function doGetSession(env: Env, sessionId: string): SessionHandle {
  const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId)) as unknown as SessionHandle;
  return { load: () => stub.load(), save: (s) => stub.save(s) };
}

export interface Deps {
  buildModel: typeof buildModel;
  getSession: (env: Env, sessionId: string) => SessionHandle;
  makeRunner: (graph: ReturnType<typeof buildGraph>) => GraphRunner;
}

function corsHeaders(origin: string, allowed: string[]): Record<string, string> {
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    "access-control-allow-origin": ok && origin ? origin : "null",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

interface ChatBody { session_id?: string; message?: string; consent?: Consent; }

export function createApp(
  deps: Deps = { buildModel, getSession: doGetSession, makeRunner: makeGraphRunner },
) {
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
        if (!body?.session_id || !body?.message) {
          return Response.json({ error: "session_id and message are required" }, { status: 400, headers: cors });
        }
        if (body.message.length > config.maxMessageChars) {
          return Response.json({ error: "message too long" }, { status: 413, headers: cors });
        }

        const handle = deps.getSession(env, body.session_id);
        let state: SessionState;
        try { state = await handle.load(); }
        catch (e) { return Response.json({ error: String((e as Error).message) }, { status: 500, headers: cors }); }

        if (state.turns + 1 > config.maxTurnsPerSession) {
          return Response.json({ error: "too many turns" }, { status: 429, headers: cors });
        }
        const turns = state.turns + 1;

        let model: ReturnType<typeof deps.buildModel>;
        try { model = deps.buildModel(config, env); }
        catch (e) { return Response.json({ error: String((e as Error).message) }, { status: 500, headers: cors }); }

        const graph = buildGraph({ model, persona: config.persona, webhookUrl: env.WEBHOOK_URL || "" });
        const history = deserializeMessages(state.messages);
        const messages = [...history, new HumanMessage(body.message)];
        const run = deps.makeRunner(graph)(messages, body.consent ?? { agreed: false });

        const persist = async (f: GraphFinal): Promise<void> => {
          await handle.save({
            messages: serializeMessages(f.messages),
            lead: f.leadSaved ? f.lead : state.lead,          // sticky: keep prior lead if none saved this turn
            leadSaved: state.leadSaved || f.leadSaved,          // sticky across the session
            turns,
          });
        };

        return streamChatSSE(run, cors, persist);
      }

      return new Response("Not found", { status: 404, headers: cors });
    },
  };
}

export { SessionDO };
export default createApp();
