import type { BaseMessage } from "@langchain/core/messages";
import type { Lead } from "./agent/state";
import type { buildGraph } from "./agent/graph";

export function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface GraphFinal {
  reply: string;
  leadSaved: boolean;
  lead: Lead;
  messages: BaseMessage[];
}
export interface GraphStreamRun {
  tokens: AsyncIterable<string>;
  final: Promise<GraphFinal>;
}
export type GraphRunner = (messages: BaseMessage[], consent: unknown) => GraphStreamRun;

export function streamChatSSE(
  run: GraphStreamRun,
  cors: Record<string, string>,
  persist?: (f: GraphFinal) => Promise<void>,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Ensure a rejected final (e.g. token stream error) never becomes an unhandled rejection.
      void run.final.catch(() => {});
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(sse(event, data)));
      try {
        for await (const t of run.tokens) if (t) send("token", { text: t });
        const f = await run.final;
        if (persist) {
          // Persisting this turn's memory must not abort delivery of the reply.
          try { await persist(f); } catch { /* memory of this turn lost; reply still delivered */ }
        }
        if (f.leadSaved) send("lead", { saved: true, lead: f.lead });
        send("done", { reply: f.reply, lead_saved: f.leadSaved });
      } catch (e) {
        send("error", { message: String((e as Error).message) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

// A complete, token-free SSE response: just a `done` frame carrying a fixed message.
export function blockedResponse(cors: Record<string, string>, message: string): Response {
  return new Response(sse("done", { reply: message, lead_saved: false }), {
    headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

// --- LangGraph-streaming adapter (verified by the wrangler dev smoke test, not unit-tested) ---
// Drives the compiled graph, yielding LLM token text and resolving the final graph state.
// If the installed @langchain/langgraph exposes a different streaming surface, adjust HERE
// only — the SSE contract above stays identical. Primary API: graph.stream with multi-mode
// ["messages","values"]; "messages" yields [AIMessageChunk, metadata], "values" yields state.
export function makeGraphRunner(graph: ReturnType<typeof buildGraph>): GraphRunner {
  return (messages, consent) => {
    let resolveFinal!: (f: GraphFinal) => void;
    let rejectFinal!: (e: unknown) => void;
    const final = new Promise<GraphFinal>((res, rej) => { resolveFinal = res; rejectFinal = rej; });

    async function* tokens(): AsyncIterable<string> {
      try {
        let lastState: any;
        const stream = await graph.stream(
          { messages, consent } as any,
          { streamMode: ["messages", "values"] as any },
        );
        for await (const [mode, chunk] of stream as any) {
          if (mode === "messages") {
            const msgChunk = Array.isArray(chunk) ? chunk[0] : chunk;
            const text = typeof msgChunk?.content === "string" ? msgChunk.content : "";
            if (text) yield text;
          } else if (mode === "values") {
            lastState = chunk;
          }
        }
        const msgs: BaseMessage[] = lastState?.messages ?? [];
        const last = msgs[msgs.length - 1];
        resolveFinal({
          reply: typeof last?.content === "string" ? last.content : "",
          leadSaved: !!lastState?.leadSaved,
          lead: lastState?.lead ?? {},
          messages: msgs,
        });
      } catch (e) {
        rejectFinal(e);
        throw e;
      }
    }

    return { tokens: tokens(), final };
  };
}
