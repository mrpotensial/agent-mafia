import Anthropic from "@anthropic-ai/sdk";
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

/**
 * LLM-powered agent using Claude API.
 * Each agent has a unique personality and maintains game memory.
 */
export class LLMAgent extends BaseAgent {
  private client: Anthropic;
  private _systemPrompt: string | null = null;
  private model: string;

  constructor(player: Player, personality: Personality, client?: Anthropic) {
    super(player, personality);
    this.client = client ?? new Anthropic({ apiKey: config.ai.anthropicApiKey });
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

  private async callLLM(userPrompt: string, temperature?: number): Promise<string> {
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: config.ai.maxTokens,
        temperature: temperature ?? config.ai.temperature,
        system: this.systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      const block = message.content[0];
      if (block.type === "text") {
        return block.text.trim();
      }
      return "";
    } catch (error) {
      console.error(
        `[LLMAgent:${this.player.name}] API call failed:`,
        error,
      );
      return `I need more time to think about this.`;
    }
  }
}
