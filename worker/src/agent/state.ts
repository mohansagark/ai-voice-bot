import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

export interface Lead {
  name?: string; email?: string; message?: string; phone?: string; company?: string;
}
export interface Consent { agreed: boolean; timestamp?: string; text?: string; }

export const ChatState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  lead: Annotation<Lead>({ reducer: (_, y) => y, default: () => ({}) }),
  consent: Annotation<Consent>({ reducer: (_, y) => y, default: () => ({ agreed: false }) }),
  offTopicStrikes: Annotation<number>({ reducer: (_, y) => y, default: () => 0 }),
  leadSaved: Annotation<boolean>({ reducer: (_, y) => y, default: () => false }),
  // True only on the turn a lead is freshly persisted — distinct from leadSaved (which
  // stays true for the rest of the session) so routing can tell "just saved, go
  // celebrate" apart from "already saved earlier, this was a no-op re-attempt."
  leadJustSaved: Annotation<boolean>({ reducer: (_, y) => y, default: () => false }),
  // Set only on the turn the agent calls show_time_picker — never carried into the next
  // turn's initial state (only leadSaved/lead are persisted across turns via the session
  // store), so this naturally resets to null every fresh graph run.
  uiComponent: Annotation<string | null>({ reducer: (_, y) => y, default: () => null }),
});

export type ChatStateType = typeof ChatState.State;
