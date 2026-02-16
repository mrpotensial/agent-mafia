import { GoogleGenerativeAI } from "@google/generative-ai";
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
 * Gemini-powered agent using Google Generative AI SDK.
 */
export class GeminiAgent extends BaseAgent {
  private genAI: GoogleGenerativeAI;
  private _systemPrompt: string | null = null;
  private model: string;

  constructor(player: Player, personality: Personality, apiKey?: string) {
    super(player, personality);
    this.genAI = new GoogleGenerativeAI(
      apiKey ?? config.ai.geminiApiKey,
    );
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
      const model = this.genAI.getGenerativeModel({
        model: this.model,
        systemInstruction: this.systemPrompt,
        generationConfig: {
          maxOutputTokens: config.ai.maxTokens,
          temperature: temperature ?? config.ai.temperature,
        },
      });

      const result = await model.generateContent(userPrompt);
      return result.response.text().trim();
    } catch (error) {
      console.error(
        `[GeminiAgent:${this.player.name}] API call failed:`,
        error,
      );
      return `I need more time to think about this.`;
    }
  }
}
