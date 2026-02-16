import { config } from "../config.js";
import type { Player, GameEvent } from "../types.js";
import type { Personality } from "./personalities.js";
import { BaseAgent } from "./base-agent.js";
import {
  buildSystemPrompt,
  buildDiscussionPrompt,
  buildVotePrompt,
  buildNightPrompt,
} from "./prompts.js";
import {
  enforceWordLimit,
  parseVoteResponse,
  parseTargetResponse,
} from "./parse-utils.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * OpenRouter-powered agent. Works with any model available on OpenRouter
 * (Gemini, Claude, GPT, Llama, etc.) via OpenAI-compatible API.
 */
export class OpenRouterAgent extends BaseAgent {
  private apiKey: string;
  private _systemPrompt: string | null = null;
  private model: string;

  constructor(player: Player, personality: Personality, apiKey?: string) {
    super(player, personality);
    this.apiKey = apiKey ?? config.ai.openrouterApiKey;
    this.model = config.ai.model;
  }

  private get systemPrompt(): string {
    if (!this._systemPrompt) {
      this._systemPrompt = buildSystemPrompt(this.player, this.personality);
    }
    return this._systemPrompt;
  }

  async makeStatement(
    players: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string> {
    const alivePlayers = players.filter((p) => p.alive);
    const userPrompt = buildDiscussionPrompt(
      this.player,
      alivePlayers,
      round,
      this.memory,
    );

    const response = await this.callLLM(userPrompt, 0.9);
    return enforceWordLimit(response);
  }

  async castVote(
    alivePlayers: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string | null> {
    const userPrompt = buildVotePrompt(
      this.player,
      alivePlayers,
      round,
      this.memory,
    );

    const response = await this.callLLM(userPrompt, 0.3);
    return parseVoteResponse(response, alivePlayers, this.player.id);
  }

  async nightAction(
    alivePlayers: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string> {
    const userPrompt = buildNightPrompt(
      this.player,
      alivePlayers,
      round,
      this.memory,
    );

    const response = await this.callLLM(userPrompt, 0.3);
    return parseTargetResponse(response, alivePlayers, this.player.id);
  }

  private async callLLM(userPrompt: string, temperature?: number, retries = 3): Promise<string> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://agent-mafia.moltiverse.com",
            "X-Title": "Agent Mafia",
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: config.ai.maxTokens,
            temperature: temperature ?? config.ai.temperature,
            messages: [
              { role: "system", content: this.systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });

        if (res.status === 429 && attempt < retries) {
          const delay = 2000 * (attempt + 1);
          console.warn(
            `[OpenRouterAgent:${this.player.name}] Rate limited, retry ${attempt + 1}/${retries} in ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`OpenRouter ${res.status}: ${err}`);
        }

        const data = await res.json() as {
          choices: { message: { content: string } }[];
        };
        return data.choices[0]?.message?.content?.trim() ?? "";
      } catch (error) {
        if (attempt < retries && String(error).includes("429")) {
          const delay = 2000 * (attempt + 1);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        console.error(
          `[OpenRouterAgent:${this.player.name}] API call failed:`,
          error,
        );
        return `I need more time to think about this.`;
      }
    }
    return `I need more time to think about this.`;
  }
}
