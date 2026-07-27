import { describe, it, expect } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { sse, streamChatSSE, type GraphStreamRun, type GraphFinal } from "../src/stream";

const cors = { "access-control-allow-origin": "https://devmohan.in" };

async function bodyText(res: Response): Promise<string> {
  return await res.text();
}

function runFrom(tokens: string[], final: GraphFinal, throwAfter = false): GraphStreamRun {
  async function* gen() {
    for (const t of tokens) yield t;
    if (throwAfter) throw new Error("stream boom");
  }
  return { tokens: gen(), final: Promise.resolve(final) };
}

describe("sse", () => {
  it("formats an event frame", () => {
    expect(sse("token", { text: "hi" })).toBe(`event: token\ndata: {"text":"hi"}\n\n`);
  });
});

describe("streamChatSSE", () => {
  it("streams token frames then a done frame, and sets SSE + CORS headers", async () => {
    const final: GraphFinal = { reply: "Hi there", leadSaved: false, lead: {}, messages: [new AIMessage("Hi there")], uiComponent: null };
    const res = streamChatSSE(runFrom(["Hi ", "there"], final), cors);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://devmohan.in");
    const body = await bodyText(res);
    expect(body).toContain(`event: token\ndata: {"text":"Hi "}`);
    expect(body).toContain(`event: token\ndata: {"text":"there"}`);
    expect(body).toContain(`event: done`);
    expect(body).toContain(`"reply":"Hi there"`);
  });

  it("emits a lead frame when the lead was saved, and calls persist", async () => {
    const final: GraphFinal = { reply: "Saved!", leadSaved: true, lead: { email: "a@b.com" }, messages: [new AIMessage("Saved!")], uiComponent: null };
    let persisted: GraphFinal | null = null;
    const res = streamChatSSE(runFrom(["Saved!"], final), cors, async (f) => void (persisted = f));
    const body = await bodyText(res);
    expect(body).toContain(`event: lead`);
    expect(body).toContain(`"email":"a@b.com"`);
    // Cast works around a TS control-flow-narrowing quirk: `persisted` is only ever
    // reassigned inside the `persist` closure, which TS over-narrows to `never` here.
    expect((persisted as GraphFinal | null)?.leadSaved).toBe(true);
  });

  it("emits an error frame (with CORS) when the token stream throws", async () => {
    const final: GraphFinal = { reply: "", leadSaved: false, lead: {}, messages: [], uiComponent: null };
    const res = streamChatSSE(runFrom(["partial"], final, true), cors);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://devmohan.in");
    const body = await bodyText(res);
    expect(body).toContain(`event: error`);
    expect(body).toContain(`stream boom`);
  });

  it("emits a component frame when the agent triggers a UI component", async () => {
    const final: GraphFinal = { reply: "Sure, pick a time!", leadSaved: false, lead: {}, messages: [new AIMessage("Sure, pick a time!")], uiComponent: "time_picker" };
    const res = streamChatSSE(runFrom(["Sure, pick a time!"], final), cors);
    const body = await bodyText(res);
    expect(body).toContain(`event: component`);
    expect(body).toContain(`"type":"time_picker"`);
  });

  it("omits the component frame when uiComponent is null", async () => {
    const final: GraphFinal = { reply: "hi", leadSaved: false, lead: {}, messages: [new AIMessage("hi")], uiComponent: null };
    const res = streamChatSSE(runFrom(["hi"], final), cors);
    const body = await bodyText(res);
    expect(body).not.toContain(`event: component`);
  });

  it("still delivers done when persist rejects (non-fatal)", async () => {
    const final: GraphFinal = { reply: "ok", leadSaved: false, lead: {}, messages: [new AIMessage("ok")], uiComponent: null };
    const res = streamChatSSE(runFrom(["ok"], final), cors, async () => { throw new Error("save failed"); });
    const body = await bodyText(res);
    expect(body).toContain(`event: done`);
    expect(body).toContain(`"reply":"ok"`);
  });
});
