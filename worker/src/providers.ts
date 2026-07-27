import { ChatOpenAI } from "@langchain/openai";
import type { AIMessage } from "@langchain/core/messages";
import type { AppConfig, Env } from "./config";

export interface ChatModelLike {
  bindTools(tools: unknown[]): { invoke(messages: unknown[]): Promise<AIMessage> };
}

export function buildModel(config: AppConfig, env: Env, provider = config.defaultProvider): ChatModelLike {
  const p = config.providers[provider];
  if (!p) throw new Error(`Unknown provider: ${provider}`);
  const apiKey = (env as unknown as Record<string, string | undefined>)[p.keyEnv];
  if (!apiKey) throw new Error(`Missing key for provider "${provider}" (env ${p.keyEnv})`);
  return new ChatOpenAI({
    model: p.model,
    apiKey,
    configuration: p.baseURL ? { baseURL: p.baseURL } : undefined,
    temperature: 0.3,
    maxRetries: 0,
  }) as unknown as ChatModelLike;
}
