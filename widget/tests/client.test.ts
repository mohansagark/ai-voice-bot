import { describe, it, expect } from "vitest";
import { parseSSE, sendChat, type ChatEvents } from "../src/client";

function sse(event: string, data: unknown) { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } });
}
function collector() {
  const log: string[] = [];
  const events: ChatEvents = {
    onToken: (t) => log.push("token:" + t),
    onLead: () => log.push("lead"),
    onDone: (r, s) => log.push("done:" + r + ":" + s),
    onError: (m) => log.push("error:" + m),
    onBlocked: () => log.push("blocked"),
    onLimitReached: () => log.push("limitReached"),
    onComponent: (t) => log.push("component:" + t),
  };
  return { log, events };
}

describe("parseSSE", () => {
  it("splits complete frames and keeps the remainder", () => {
    const { frames, rest } = parseSSE(sse("token", { text: "hi" }) + "event: done\ndata: {");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ event: "token", data: '{"text":"hi"}' });
    expect(rest).toBe("event: done\ndata: {");
  });
});

describe("sendChat", () => {
  it("dispatches token then done from a streamed body", async () => {
    const body = streamOf([sse("token", { text: "He" }), sse("token", { text: "llo" }), sse("done", { reply: "Hello", lead_saved: false })]);
    const fake = (async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    const { log, events } = collector();
    await sendChat("https://w.test", { session_id: "s", message: "hi", consent: {} }, events, fake);
    expect(log).toEqual(["token:He", "token:llo", "done:Hello:false"]);
  });

  it("calls onBlocked for a 429 {blocked:true} without streaming", async () => {
    const fake = (async () => Response.json({ blocked: true }, { status: 429 })) as unknown as typeof fetch;
    const { log, events } = collector();
    await sendChat("https://w.test", { session_id: "s", message: "hi", consent: {} }, events, fake);
    expect(log).toEqual(["blocked"]);
  });

  it("calls onLimitReached for a 429 {limitReached:true} without streaming", async () => {
    const fake = (async () => Response.json({ error: "too many turns", limitReached: true }, { status: 429 })) as unknown as typeof fetch;
    const { log, events } = collector();
    await sendChat("https://w.test", { session_id: "s", message: "hi", consent: {} }, events, fake);
    expect(log).toEqual(["limitReached"]);
  });

  it("dispatches onComponent for a component frame", async () => {
    const body = streamOf([sse("component", { type: "time_picker" }), sse("done", { reply: "hi", lead_saved: false })]);
    const fake = (async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    const { log, events } = collector();
    await sendChat("https://w.test", { session_id: "s", message: "hi", consent: {} }, events, fake);
    expect(log).toEqual(["component:time_picker", "done:hi:false"]);
  });

  it("calls onError on a network failure", async () => {
    const fake = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const { log, events } = collector();
    await sendChat("https://w.test", { session_id: "s", message: "hi", consent: {} }, events, fake);
    expect(log[0]).toMatch(/^error:/);
  });

  it("dispatches onError for an error frame", async () => {
    const body = streamOf([sse("error", { message: "boom" })]);
    const fake = (async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    const { log, events } = collector();
    await sendChat("https://w.test", { session_id: "s", message: "hi", consent: {} }, events, fake);
    expect(log).toEqual(["error:boom"]);
  });
});
