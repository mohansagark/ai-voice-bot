import { StateGraph, START, END } from "@langchain/langgraph";
import { ChatState } from "./state";
import {
  guardrailNode, routeAfterGuardrail, makeRefuseNode,
  makeAgentNode, routeAfterAgent,
  makeSaveLeadNode, routeAfterSaveLead, makeConfirmNode,
  makeShowTimePickerNode,
  type AgentDeps,
} from "./nodes";

export function buildGraph(deps: AgentDeps) {
  return new StateGraph(ChatState)
    .addNode("guardrail", guardrailNode)
    .addNode("refuse", makeRefuseNode(deps))
    .addNode("agent", makeAgentNode(deps))
    .addNode("save_lead", makeSaveLeadNode(deps))
    .addNode("confirm", makeConfirmNode(deps))
    .addNode("show_time_picker", makeShowTimePickerNode(deps))
    .addEdge(START, "guardrail")
    .addConditionalEdges("guardrail", routeAfterGuardrail, { refuse: "refuse", agent: "agent" })
    .addEdge("refuse", END)
    .addConditionalEdges("agent", routeAfterAgent, { save_lead: "save_lead", show_time_picker: "show_time_picker", end: END })
    .addConditionalEdges("save_lead", routeAfterSaveLead, { confirm: "confirm", agent: "agent" })
    .addEdge("confirm", END)
    // End here with the ack from makeShowTimePickerNode — do not re-enter agent (second
    // LLM invoke was hanging/timing out in production and breaking schedule turns).
    .addEdge("show_time_picker", END)
    .compile();
}
