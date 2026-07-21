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
});

export type ChatStateType = typeof ChatState.State;
