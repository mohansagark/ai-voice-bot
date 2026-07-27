import { AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { ChatStateType } from "./state";
import type { ChatModelLike } from "../providers";
import { saveLeadTool, saveLeadSchema } from "./tools";
import { buildSystemPrompt } from "../prompts";
import { isValidEmail } from "../leads";
import type { LeadRow } from "../leads-store";
import type { Persona } from "../config";

export interface AgentDeps {
  model: ChatModelLike;
  persona: Persona;
  portfolioContext?: string;
  persistLead: (row: LeadRow) => Promise<void>;
}

const INJECTION_PATTERNS = [
  /ignore (all |the )?(previous|prior|above) instructions/i,
  /system prompt/i,
  /disregard (your|the) (rules|instructions)/i,
  /you are now/i,
];

export function guardrailNode(state: ChatStateType): Partial<ChatStateType> {
  const last = state.messages[state.messages.length - 1];
  const text = typeof last?.content === "string" ? last.content : "";
  const tripped = INJECTION_PATTERNS.some((re) => re.test(text));
  return tripped ? { offTopicStrikes: state.offTopicStrikes + 1 } : {};
}

export function routeAfterGuardrail(state: ChatStateType): "refuse" | "agent" {
  return state.offTopicStrikes > 0 ? "refuse" : "agent";
}

export function makeRefuseNode(deps: AgentDeps) {
  return (): Partial<ChatStateType> => ({
    messages: [new AIMessage(
      `Ha — nice try! But I'm just here to chat about ${deps.persona.owner.name} and pass a note along for you. So… what's actually on your mind?`,
    )],
  });
}

export function makeAgentNode(deps: AgentDeps) {
  const system = new SystemMessage(buildSystemPrompt(deps.persona, deps.portfolioContext));
  const bound = deps.model.bindTools([saveLeadTool]);
  return async (state: ChatStateType): Promise<Partial<ChatStateType>> => {
    const extra = state.leadSaved
      ? [new SystemMessage(
          "IMPORTANT: You have already recorded this visitor's contact details this session. Do NOT ask for their name/email again and do NOT call save_lead again — just chat naturally and help with whatever they say next.",
        )]
      : [];
    const reply = await bound.invoke([system, ...extra, ...state.messages]);
    return { messages: [reply] };
  };
}

export function routeAfterAgent(state: ChatStateType): "save_lead" | "end" {
  const last = state.messages[state.messages.length - 1] as AIMessage;
  const calls = last.tool_calls ?? [];
  return calls.some((c) => c.name === "save_lead") ? "save_lead" : "end";
}

export function makeSaveLeadNode(deps: AgentDeps) {
  return async (state: ChatStateType): Promise<Partial<ChatStateType>> => {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const call = (last.tool_calls ?? []).find((c) => c.name === "save_lead");
    if (!call) return {};
    // Already captured this session — acknowledge without re-saving or re-confirming.
    if (state.leadSaved) {
      return { messages: [new AIMessage("You're all set — I've already passed your details along. What else can I help you with?")] };
    }
    const parsed = saveLeadSchema.safeParse(call.args);
    if (!parsed.success || !isValidEmail(parsed.data.email)) {
      return {
        messages: [new ToolMessage({
          tool_call_id: call.id!,
          content: "The email is invalid or a required field is missing. Ask the visitor to confirm their email before trying again.",
          status: "error",
        })],
      };
    }
    const d = parsed.data;
    const row: LeadRow = {
      email: d.email,
      name: d.name,
      question: d.message,
      sessionId: null,
      userAgent: null,
      referer: null,
      source: "agent",
    };
    try {
      await deps.persistLead(row);
      return {
        lead: d,
        leadSaved: true,
        messages: [new ToolMessage({
          tool_call_id: call.id!,
          content: "Lead delivered.",
        })],
      };
    } catch (e) {
      // Lead persistence failed (D1 down). Surface as a tool error so the agent can recover
      // gracefully — but still mark the lead as recorded so we don't loop forever.
      return {
        lead: d,
        leadSaved: true,
        messages: [new ToolMessage({
          tool_call_id: call.id!,
          content: "Lead recorded (delivery failed).",
          status: "error",
        })],
      };
    }
  };
}

export function routeAfterSaveLead(state: ChatStateType): "confirm" | "agent" | "end" {
  const last = state.messages[state.messages.length - 1];
  // If save_lead ran but the last message is a plain AI line (already-recorded ack), end.
  if (last?._getType?.() === "ai") return "end";
  return state.leadSaved ? "confirm" : "agent";
}

export function makeConfirmNode(deps: AgentDeps) {
  return (state: ChatStateType): Partial<ChatStateType> => {
    const name = state.lead.name ?? "there";
    return {
      messages: [new AIMessage(
        `Amazing — got it, ${name}! I'll make sure ${deps.persona.owner.name} sees this and gets back to you at the email you gave. Lovely chatting with you.`,
      )],
    };
  };
}
