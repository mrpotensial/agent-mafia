import { config, type AIProvider } from "../config.js";
import type { Player } from "../types.js";
import type { Personality } from "./personalities.js";
import type { BaseAgent } from "./base-agent.js";
import { RandomAgent } from "./base-agent.js";
import { LLMAgent } from "./llm-agent.js";
import { GeminiAgent } from "./gemini-agent.js";
import { OpenRouterAgent } from "./openrouter-agent.js";

/**
 * Create an agent based on the configured AI provider.
 * Falls back to RandomAgent if useLLM is false.
 */
export function createAgent(
  player: Player,
  personality: Personality,
  useLLM: boolean,
  provider?: AIProvider,
): BaseAgent {
  if (!useLLM) {
    return new RandomAgent(player, personality);
  }

  const selectedProvider = provider ?? config.ai.provider;

  switch (selectedProvider) {
    case "gemini":
      return new GeminiAgent(player, personality);
    case "anthropic":
      return new LLMAgent(player, personality);
    case "openrouter":
      return new OpenRouterAgent(player, personality);
    case "openai":
      // OpenAI uses same interface as Anthropic but different SDK
      // For now, fallback to random until OpenAI agent is implemented
      console.warn(
        `[createAgent] OpenAI provider not yet implemented, using RandomAgent`,
      );
      return new RandomAgent(player, personality);
    default:
      return new RandomAgent(player, personality);
  }
}
