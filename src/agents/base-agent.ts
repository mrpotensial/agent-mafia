import type { Player, GameEvent } from "../types.js";
import { AgentMemory } from "./memory.js";
import type { Personality } from "./personalities.js";

/**
 * Base class for all game agents.
 * Provides memory management and personality tracking.
 * Subclasses implement the actual decision-making logic.
 */
export abstract class BaseAgent {
  readonly player: Player;
  readonly personality: Personality;
  readonly memory: AgentMemory;

  constructor(player: Player, personality: Personality) {
    this.player = player;
    this.personality = personality;
    this.memory = new AgentMemory(player.id);
  }

  /** Process a game event and update memory. */
  processEvent(event: GameEvent): void {
    this.memory.record(event);
  }

  /** Ensure memory has up-to-date name map from player list. */
  updateNameMap(players: Player[]): void {
    this.memory.setNameMap(players);
  }

  /** Generate a statement during day discussion. */
  abstract makeStatement(
    players: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string>;

  /** Cast a vote during voting phase. Returns target player id or null (skip). */
  abstract castVote(
    alivePlayers: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string | null>;

  /** Perform a night action. Returns target player id. */
  abstract nightAction(
    alivePlayers: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string>;
}

/** Pick a random element from an array. */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Random agent with personality-influenced behavior.
 * Used for testing and as a fallback when LLM is unavailable.
 */
export class RandomAgent extends BaseAgent {
  async makeStatement(
    players: Player[],
    round: number,
  ): Promise<string> {
    const others = players.filter(
      (p) => p.id !== this.player.id && p.alive,
    );
    const target = pick(others);
    const targetName = target?.name ?? "someone";

    // Personality-influenced statement templates
    const templates = this.getStatementTemplates(targetName, round);
    return pick(templates);
  }

  async castVote(
    alivePlayers: Player[],
  ): Promise<string | null> {
    const targets = alivePlayers.filter((p) => p.id !== this.player.id);
    if (targets.length === 0) return null;

    // Skip chance based on aggression (aggressive = rarely skip)
    const skipChance = 0.3 * (1 - this.personality.aggression);
    if (Math.random() < skipChance) return null;

    return pick(targets).id;
  }

  async nightAction(
    alivePlayers: Player[],
  ): Promise<string> {
    const targets = alivePlayers.filter((p) => p.id !== this.player.id);
    return pick(targets).id;
  }

  private getStatementTemplates(targetName: string, round: number): string[] {
    const aggr = this.personality.aggression;
    const trust = this.personality.trustLevel;

    // High aggression templates
    if (aggr >= 0.7) {
      return [
        `${targetName}! Explain yourself! Your silence is damning!`,
        `I'm calling it right now — ${targetName} is Mafia. Vote them out!`,
        `Why is nobody talking about ${targetName}'s suspicious behavior?`,
        `We're wasting time. ${targetName} has been dodging questions since round 1.`,
        `I don't trust a single word coming out of ${targetName}'s mouth!`,
      ];
    }

    // Low aggression (observer) templates
    if (aggr <= 0.3) {
      return [
        `I've been watching carefully... ${targetName}'s behavior shifted this round.`,
        `Something about ${targetName}'s voting pattern doesn't add up.`,
        round > 1 ? `Comparing what was said in earlier rounds, I notice some inconsistencies.` : `Let's observe carefully before jumping to conclusions.`,
        `I'll reserve judgment for now, but I'm keeping my eye on ${targetName}.`,
        `The truth reveals itself to those who watch patiently.`,
      ];
    }

    // High trust templates
    if (trust >= 0.7) {
      return [
        `I believe we should work together. ${targetName}, what do you think?`,
        `Let's form a coalition. I think most of us are on the same side.`,
        `I want to trust ${targetName}, but we need to stay vigilant.`,
        `We can figure this out if we cooperate. Who's with me?`,
        `I'll give ${targetName} the benefit of the doubt for now.`,
      ];
    }

    // Low trust templates
    if (trust <= 0.3) {
      return [
        `Why should I believe any of you? ${targetName} is deflecting.`,
        `Everyone's suspicious. ${targetName} just happens to be the most suspicious.`,
        `Trust nobody. That's how you survive this game.`,
        `${targetName} is trying too hard to look innocent. Classic Mafia move.`,
        `I don't buy ${targetName}'s story. Something's off.`,
      ];
    }

    // Balanced templates
    return [
      `I think ${targetName} is acting suspicious this round.`,
      `Let's analyze what happened. ${targetName}'s behavior stands out.`,
      `We need to focus on finding the Mafia. I have my suspicions about ${targetName}.`,
      `Something feels off about this round. ${targetName}, care to explain?`,
      `I've been watching closely. ${targetName} changed their behavior recently.`,
    ];
  }
}
