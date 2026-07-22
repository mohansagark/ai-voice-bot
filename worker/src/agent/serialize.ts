import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

export type StoredMessage =
  | { role: "human"; content: string }
  | { role: "ai"; content: string; tool_calls?: { name: string; id: string; args: unknown }[] }
  | { role: "tool"; content: string; tool_call_id: string; status?: "error" };

function asText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

export function serializeMessages(msgs: BaseMessage[]): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (const m of msgs) {
    const content = asText(m.content);
    if (m instanceof HumanMessage) {
      out.push({ role: "human", content });
    } else if (m instanceof AIMessage) {
      const calls = (m.tool_calls ?? []).map((c) => ({ name: c.name, id: c.id ?? "", args: c.args }));
      out.push(calls.length ? { role: "ai", content, tool_calls: calls } : { role: "ai", content });
    } else if (m instanceof ToolMessage) {
      const sm: StoredMessage = { role: "tool", content, tool_call_id: m.tool_call_id };
      if (m.status === "error") sm.status = "error";
      out.push(sm);
    }
    // SystemMessage is intentionally skipped — the system prompt is rebuilt fresh each turn.
  }
  return out;
}

export function deserializeMessages(stored: StoredMessage[]): BaseMessage[] {
  return stored.map((s) => {
    if (s.role === "human") return new HumanMessage(s.content);
    if (s.role === "ai") {
      return new AIMessage({
        content: s.content,
        tool_calls: (s.tool_calls ?? []).map((c) => ({
          name: c.name, id: c.id, args: (c.args ?? {}) as Record<string, unknown>, type: "tool_call" as const,
        })),
      });
    }
    return new ToolMessage({ content: s.content, tool_call_id: s.tool_call_id, ...(s.status ? { status: s.status } : {}) });
  });
}
