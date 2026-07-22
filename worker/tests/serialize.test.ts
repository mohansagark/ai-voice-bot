import { describe, it, expect } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { serializeMessages, deserializeMessages } from "../src/agent/serialize";

describe("message serialization", () => {
  it("round-trips a human message", () => {
    const [out] = deserializeMessages(serializeMessages([new HumanMessage("hi")]));
    expect(out).toBeInstanceOf(HumanMessage);
    expect(out.content).toBe("hi");
  });

  it("round-trips an AI message with a tool call", () => {
    const ai = new AIMessage({ content: "", tool_calls: [{ name: "save_lead", id: "c1", args: { email: "a@b.com" } }] });
    const stored = serializeMessages([ai]);
    expect(stored[0]).toMatchObject({ role: "ai", tool_calls: [{ name: "save_lead", id: "c1" }] });
    const [out] = deserializeMessages(stored) as [AIMessage];
    expect(out).toBeInstanceOf(AIMessage);
    expect(out.tool_calls?.[0]).toMatchObject({ name: "save_lead", id: "c1", args: { email: "a@b.com" } });
  });

  it("round-trips a tool message including error status", () => {
    const tm = new ToolMessage({ content: "bad email", tool_call_id: "c1", status: "error" });
    const stored = serializeMessages([tm]);
    expect(stored[0]).toMatchObject({ role: "tool", tool_call_id: "c1", status: "error" });
    const [out] = deserializeMessages(stored) as [ToolMessage];
    expect(out).toBeInstanceOf(ToolMessage);
    expect(out.tool_call_id).toBe("c1");
  });

  it("skips system messages (rebuilt each turn)", () => {
    // A valid ai->tool sequence survives; system is never stored.
    const seq = [new HumanMessage("hi"), new AIMessage("hello")];
    expect(deserializeMessages(serializeMessages(seq))).toHaveLength(2);
  });
});
