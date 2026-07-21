import { StateGraph, START, END } from "@langchain/langgraph";
import { ChatState } from "./state";
import {
  guardrailNode, routeAfterGuardrail, refuseNode,
  makeAgentNode, routeAfterAgent,
  makeSaveLeadNode, routeAfterSaveLead, makeConfirmNode,
  type AgentDeps,
} from "./nodes";

export function buildGraph(deps: AgentDeps) {
  return new StateGraph(ChatState)
    .addNode("guardrail", guardrailNode)
    .addNode("refuse", refuseNode)
    .addNode("agent", makeAgentNode(deps))
    .addNode("save_lead", makeSaveLeadNode(deps))
    .addNode("confirm", makeConfirmNode(deps))
    .addEdge(START, "guardrail")
    .addConditionalEdges("guardrail", routeAfterGuardrail, { refuse: "refuse", agent: "agent" })
    .addEdge("refuse", END)
    .addConditionalEdges("agent", routeAfterAgent, { save_lead: "save_lead", end: END })
    .addConditionalEdges("save_lead", routeAfterSaveLead, { confirm: "confirm", agent: "agent" })
    .addEdge("confirm", END)
    .compile();
}
