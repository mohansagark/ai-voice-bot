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
  // Cross-vendor fallback — invoked only when the primary model call fails or times out.
  fallbackModel?: ChatModelLike;
  persona: Persona;
  portfolioContext?: string;
  persistLead: (row: LeadRow) => Promise<void>;
}

// Defensive ceiling on the LLM call: LangChain's OpenAI client has been observed to hang
// indefinitely (no error, no resolution) under the Workers runtime for reasons still under
// investigation — Groq itself and a raw fetch() to the same endpoint both respond in under
// a second. Without this, a hung invoke leaves the visitor staring at "thinking..." forever.
// The widget's error path already shows a generic "something hiccuped" message regardless
// of this error's text, so no client-side change is needed to go with it.
export const AGENT_INVOKE_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
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

/** True when the visitor is asking to schedule / pick a time (and hasn't already picked one). */
export function wantsTimePicker(text: string): boolean {
  if (!text || /\[Preferred time:/i.test(text)) return false;
  return /\b(schedule|book|booking|meeting|appointment|time picker|pick a time|set up a (call|meeting|session)|sync with|connect with)\b/i.test(
    text,
  );
}

/** Extract a widget time-picker selection, if present. */
export function parsePreferredTime(text: string): string | null {
  const m = text.match(/\[Preferred time:\s*([^\]]+)\]/i);
  const v = m?.[1]?.trim();
  return v || null;
}

function lastHumanText(state: ChatStateType): string {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i] as { _getType?: () => string; getType?: () => string; content?: unknown };
    const kind = m._getType?.() ?? m.getType?.();
    if (kind === "human" && typeof m.content === "string") return m.content;
  }
  return "";
}

export function makeAgentNode(deps: AgentDeps) {
  const system = new SystemMessage(buildSystemPrompt(deps.persona, deps.portfolioContext));
  // Only bind save_lead. show_time_picker is handled by the schedule fast-path below —
  // binding it made Groq tool-calling hang (empty or flaky schemas → widget hiccups).
  const bound = deps.model.bindTools([saveLeadTool]);
  const fallbackBound = deps.fallbackModel?.bindTools([saveLeadTool]);
  return async (state: ChatStateType): Promise<Partial<ChatStateType>> => {
    const human = lastHumanText(state);
    const owner = deps.persona.owner.name;

    // Fast path: schedule intent → synthetic show_time_picker (no LLM).
    if (wantsTimePicker(human)) {
      return {
        messages: [
          new AIMessage({
            content: `Sure — pick a time that works for you below, and I'll pass it along to ${owner}.`,
            tool_calls: [{
              name: "show_time_picker",
              id: `tp-${Date.now()}`,
              args: { reason: "visitor asked to schedule" },
            }],
          }),
        ],
      };
    }

    // Fast path: visitor just confirmed a slot in the picker — don't risk an LLM hang.
    const preferred = parsePreferredTime(human);
    if (preferred) {
      if (state.leadSaved) {
        return {
          messages: [new AIMessage(
            `Got it — ${preferred}. I'll make sure ${owner} sees that preference.`,
          )],
        };
      }
      return {
        messages: [new AIMessage(
          `Perfect — I've noted ${preferred}. What's the best email to reach you at, and what should I tell ${owner} this is about?`,
        )],
      };
    }

    const extra = state.leadSaved
      ? [new SystemMessage(
          "IMPORTANT: You have already recorded this visitor's contact details this session. Do NOT ask for their name/email again and do NOT call save_lead again — just chat naturally and help with whatever they say next.",
        )]
      : [];
    const messages = [system, ...extra, ...state.messages];
    try {
      const reply = await withTimeout(bound.invoke(messages), AGENT_INVOKE_TIMEOUT_MS, "LLM invoke");
      return { messages: [reply] };
    } catch (e) {
      console.error("primary chat model failed:", String((e as Error).message));
      if (fallbackBound) {
        try {
          const reply = await withTimeout(fallbackBound.invoke(messages), AGENT_INVOKE_TIMEOUT_MS, "LLM invoke (fallback)");
          return { messages: [reply] };
        } catch (e2) {
          console.error("fallback chat model failed:", String((e2 as Error).message));
        }
      }
      // Soft recovery — never throw past here. A thrown error becomes SSE `error` and the
      // widget's generic "something hiccuped" line, which is worse than a brief retry ask.
      return {
        messages: [new AIMessage(
          `Sorry — I blanked for a second. Mind trying that again? Or tell me what you'd like me to pass along to ${owner}.`,
        )],
      };
    }
  };
}

export function routeAfterAgent(state: ChatStateType): "save_lead" | "show_time_picker" | "end" {
  const last = state.messages[state.messages.length - 1] as AIMessage;
  const calls = last.tool_calls ?? [];
  if (calls.some((c) => c.name === "save_lead")) return "save_lead";
  if (calls.some((c) => c.name === "show_time_picker")) return "show_time_picker";
  return "end";
}

export function makeShowTimePickerNode(deps: AgentDeps) {
  return (state: ChatStateType): Partial<ChatStateType> => {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const call = (last.tool_calls ?? []).find((c) => c.name === "show_time_picker");
    if (!call) return {};
    // Prefer any prose the model already produced alongside the tool call; otherwise a short
    // canned ack. We END after this node (no second LLM round-trip) — looping back to
    // `agent` for a "natural" follow-up was timing out under Workers and surfacing as the
    // widget's "something hiccuped" error on every schedule request.
    const prior = typeof last.content === "string" ? last.content.trim() : "";
    const ack =
      prior ||
      `Sure — pick a time that works for you below, and I'll pass it along to ${deps.persona.owner.name}.`;
    return {
      uiComponent: "time_picker",
      messages: [
        new ToolMessage({
          tool_call_id: call.id!,
          content: "The time picker is now showing in the chat UI for the visitor to fill in.",
        }),
        new AIMessage(ack),
      ],
    };
  };
}

export function makeSaveLeadNode(deps: AgentDeps) {
  return async (state: ChatStateType): Promise<Partial<ChatStateType>> => {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const call = (last.tool_calls ?? []).find((c) => c.name === "save_lead");
    if (!call) return {};
    // Already captured this session — the model isn't supposed to call save_lead again,
    // but it doesn't always comply. Rather than short-circuit the turn with a canned
    // reply (which used to swallow whatever the visitor actually just asked), report it
    // as a no-op tool result and let the agent give a real answer to their message.
    if (state.leadSaved) {
      return {
        leadJustSaved: false,
        messages: [new ToolMessage({
          tool_call_id: call.id!,
          content: "Already recorded this visitor this session — do not save again. Just answer what they actually asked.",
        })],
      };
    }
    const parsed = saveLeadSchema.safeParse(call.args);
    if (!parsed.success || !isValidEmail(parsed.data.email)) {
      return {
        leadJustSaved: false,
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
      preferredTime: d.preferredTime ?? null,
    };
    try {
      await deps.persistLead(row);
      return {
        lead: d,
        leadSaved: true,
        leadJustSaved: true,
        messages: [new ToolMessage({
          tool_call_id: call.id!,
          content: "Lead delivered.",
        })],
      };
    } catch (e) {
      // Lead persistence failed (D1 down). Surface as a tool error so the agent can recover
      // gracefully — but still mark the lead as recorded so we don't loop forever. Routes
      // back to "agent" (not "confirm"), since celebrating a save that didn't actually
      // happen would be worse than the agent handling the error naturally.
      return {
        lead: d,
        leadSaved: true,
        leadJustSaved: false,
        messages: [new ToolMessage({
          tool_call_id: call.id!,
          content: "Lead recorded (delivery failed).",
          status: "error",
        })],
      };
    }
  };
}

export function routeAfterSaveLead(state: ChatStateType): "confirm" | "agent" {
  // Only a fresh, successful save goes to the celebratory confirm line. Every other
  // outcome (already saved earlier, invalid email, persist failure) routes back to the
  // agent so it can give a real reply grounded in the tool result and whatever the
  // visitor actually asked.
  return state.leadJustSaved ? "confirm" : "agent";
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
