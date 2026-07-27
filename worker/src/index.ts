// MUST be the very first import. The `openai` SDK (pulled in transitively by
// @langchain/openai) auto-detects its runtime on first import of its shims and locks
// that choice in permanently. Under this project's `nodejs_compat` flag, that
// auto-detection resolves to the Node.js shim, which attaches a real `https.Agent` to
// every fetch() call — something Cloudflare Workers' fetch() can't service, causing the
// LLM call to hang forever with no error. Importing the web shim first forces the
// correct (agent-free) runtime before anything else gets a chance to auto-detect wrong.
import "openai/shims/web";
import { loadConfig, type Env, type AppConfig, type Consent } from "./config";
import { buildModel } from "./providers";
import { buildGraph } from "./agent/graph";
import { HumanMessage } from "@langchain/core/messages";
import { serializeMessages, deserializeMessages } from "./agent/serialize";
import type { SessionState } from "./session-store";
import { SessionDO } from "./session-do";
import { isSpam } from "./spam";
import { streamChatSSE, makeGraphRunner, blockedResponse, type GraphRunner, type GraphFinal } from "./stream";
import { synthesizeSpeech } from "./tts";
import { isValidEmail } from "./leads";
import { saveLead as persistLeadToD1, notifyLeadByEmail, type LeadRow } from "./leads-store";

export interface SessionHandle {
  load(): Promise<SessionState>;
  save(state: SessionState): Promise<void>;
}

// Default session accessor: a Durable Object per session_id (RPC methods load/save).
function doGetSession(env: Env, sessionId: string): SessionHandle {
  const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId)) as unknown as SessionHandle;
  return { load: () => stub.load(), save: (s) => stub.save(s) };
}

// Default portfolio-context accessor: reads the "context" key from the (optional) KV
// namespace. Absent binding or a lookup failure both just mean "no extra context" —
// Leo still works fine on the abridged persona facts alone.
async function getPortfolioContext(env: Env): Promise<string> {
  if (!env.PORTFOLIO_KV) return "";
  try { return (await env.PORTFOLIO_KV.get("context")) ?? ""; }
  catch (e) { console.error("PORTFOLIO_KV read failed (continuing without it):", String((e as Error).message)); return ""; }
}

export interface Deps {
  buildModel: typeof buildModel;
  getSession: (env: Env, sessionId: string) => SessionHandle;
  makeRunner: (graph: ReturnType<typeof buildGraph>) => GraphRunner;
  fetchImpl?: typeof fetch;
  persistLead?: (row: LeadRow) => Promise<void>;
  getPortfolioContext?: (env: Env) => Promise<string>;
}

function corsHeaders(origin: string, allowed: string[], allowAll = false): Record<string, string> {
  const ok = allowAll || allowed.length === 0 || allowed.includes(origin);
  return {
    "access-control-allow-origin": ok && origin ? origin : "null",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

interface ChatBody { session_id?: string; message?: string; consent?: Consent; }

export function createApp(
  deps: Deps = {
    buildModel,
    getSession: doGetSession,
    makeRunner: makeGraphRunner,
  },
) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const config: AppConfig = loadConfig(env);
      const origin = request.headers.get("origin") || "";
      const enforce = config.mode === "prod";
      const cors = corsHeaders(origin, config.allowedOrigins, !enforce);

      if (request.method === "OPTIONS") return new Response(null, { headers: cors });

      if (url.pathname === "/health") {
        const p = config.providers[config.defaultProvider];
        return Response.json(
          { ok: true, provider: config.defaultProvider, model: p?.model, tts: env.GROQ_API_KEY ? "groq" : "browser", leads: env.DB ? "d1" : "none", mode: config.mode },
          { headers: cors },
        );
      }

      if (url.pathname === "/chat" && request.method === "POST") {
        if (enforce && config.allowedOrigins.length && !config.allowedOrigins.includes(origin)) {
          return Response.json({ error: "origin not allowed" }, { status: 403, headers: cors });
        }
        const body = (await request.json().catch(() => null)) as ChatBody | null;
        if (!body?.session_id || !body?.message) {
          return Response.json({ error: "session_id and message are required" }, { status: 400, headers: cors });
        }
        if (enforce && body.message.length > config.maxMessageChars) {
          return Response.json({ error: "message too long" }, { status: 413, headers: cors });
        }

        const handle = deps.getSession(env, body.session_id);
        let state: SessionState;
        try { state = await handle.load(); }
        catch (e) { return Response.json({ error: String((e as Error).message) }, { status: 500, headers: cors }); }

        const BLOCK_MSG = `Looks like we're going in circles — I'm going to pause here. If you've got a real question, please reach out to ${config.persona.owner.name} directly.`;
        // Already blocked earlier this session → go silent (no message, no LLM). Cheapest possible.
        if (enforce && state.blocked) return Response.json({ blocked: true }, { status: 429, headers: cors });
        // Fresh spam trip: deliver the pause line ONCE, then the session is silent from here on.
        const userMsgs = [...state.messages.filter((m) => m.role === "human").map((m) => m.content), body.message];
        if (enforce && isSpam(userMsgs)) {
          try { await handle.save({ ...state, blocked: true }); } catch { /* best-effort */ }
          return blockedResponse(cors, BLOCK_MSG);
        }

        if (enforce && state.turns + 1 > config.maxTurnsPerSession) {
          return Response.json({ error: "too many turns" }, { status: 429, headers: cors });
        }
        const turns = state.turns + 1;

        let model: ReturnType<typeof deps.buildModel>;
        try { model = deps.buildModel(config, env); }
        catch (e) { return Response.json({ error: String((e as Error).message) }, { status: 500, headers: cors }); }

        const persistLeadFn = deps.persistLead ?? (async (row: LeadRow) => {
          try { await persistLeadToD1(env as any, row); }
          catch (e) { console.error("saveLead (D1) failed:", String((e as Error).message)); throw e; }
          try { await notifyLeadByEmail(env as any, row, deps.fetchImpl ?? fetch); } catch { /* swallowed inside */ }
        });

        let portfolioContext = "";
        try { portfolioContext = await (deps.getPortfolioContext ?? getPortfolioContext)(env); }
        catch (e) { console.error("getPortfolioContext failed (continuing without it):", String((e as Error).message)); }
        const graph = buildGraph({ model, persona: config.persona, portfolioContext, persistLead: persistLeadFn });
        const history = deserializeMessages(state.messages);
        const messages = [...history, new HumanMessage(body.message)];
        const run = deps.makeRunner(graph)(
          messages,
          body.consent ?? { agreed: false },
          { leadSaved: state.leadSaved ?? false, lead: state.lead },
        );

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

      if (url.pathname === "/lead" && request.method === "POST") {
        if (enforce && config.allowedOrigins.length && !config.allowedOrigins.includes(origin)) {
          return Response.json({ error: "origin not allowed" }, { status: 403, headers: cors });
        }
        const body = (await request.json().catch(() => null)) as {
          email?: string; name?: string; question?: string; sessionId?: string;
        } | null;
        const email = (body?.email ?? "").trim().toLowerCase();
        const name = (body?.name ?? "").trim().slice(0, 100) || null;
        const question = (body?.question ?? "").trim();
        const sessionId = (body?.sessionId ?? "").trim() || null;
        if (!email || !isValidEmail(email)) return Response.json({ error: "valid email required" }, { status: 400, headers: cors });
        if (!question || question.length < 4) return Response.json({ error: "question required" }, { status: 400, headers: cors });
        if (question.length > 2000) return Response.json({ error: "question too long" }, { status: 400, headers: cors });
        const row: LeadRow = {
          email, name, question, sessionId,
          userAgent: request.headers.get("user-agent") || null,
          referer: request.headers.get("referer") || null,
          source: "direct",
        };
        try {
          await persistLeadToD1(env as any, row);
        } catch (e) {
          console.error("/lead D1 insert failed:", String((e as Error).message));
          return Response.json({ error: "could not save lead" }, { status: 500, headers: cors });
        }
        // Email notify is best-effort and async.
        try { await notifyLeadByEmail(env as any, row); } catch { /* swallowed inside */ }
        return Response.json({ ok: true }, { status: 200, headers: cors });
      }

      if (url.pathname === "/tts" && request.method === "POST") {
        if (enforce && config.allowedOrigins.length && !config.allowedOrigins.includes(origin)) {
          return Response.json({ error: "origin not allowed" }, { status: 403, headers: cors });
        }
        const body = (await request.json().catch(() => null)) as { text?: string; voice?: string } | null;
        if (!body?.text || !body.text.trim()) {
          return Response.json({ error: "text is required" }, { status: 400, headers: cors });
        }
        if (enforce && body.text.length > config.maxTtsChars) {
          return Response.json({ error: "text too long" }, { status: 413, headers: cors });
        }
        if (!env.GROQ_API_KEY) {
          return Response.json({ error: "tts not configured" }, { status: 502, headers: cors });
        }
        const voice = body.voice || config.ttsVoice;
        const result = await synthesizeSpeech(body.text, voice, env.GROQ_API_KEY, deps.fetchImpl ?? fetch);
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status, headers: cors });
        return new Response(result.body, { status: 200, headers: { ...cors, "content-type": result.contentType } });
      }

      return new Response("Not found", { status: 404, headers: cors });
    },
  };
}

export { SessionDO };
export default createApp();
