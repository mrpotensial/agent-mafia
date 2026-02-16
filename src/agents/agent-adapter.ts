import type { AgentAdapter } from "../engine/game.js";
import type { Player, GameEvent } from "../types.js";
import type { BaseAgent } from "./base-agent.js";

/**
 * Bridges between the Game engine's AgentAdapter interface
 * and the actual BaseAgent instances.
 */
export class AgentManager implements AgentAdapter {
  private agents: Map<string, BaseAgent> = new Map();

  /** Register an agent for a player. */
  register(agent: BaseAgent): void {
    this.agents.set(agent.player.id, agent);
  }

  /** Get an agent by player id. */
  get(playerId: string): BaseAgent | undefined {
    return this.agents.get(playerId);
  }

  /** Broadcast a game event to all agents. */
  broadcastEvent(event: GameEvent): void {
    for (const agent of this.agents.values()) {
      agent.processEvent(event);
    }
  }

  // ─── AgentAdapter implementation ───────────────────────────

  async makeStatement(
    player: Player,
    players: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string> {
    const agent = this.agents.get(player.id);
    if (!agent) return `[${player.name}] ...`;
    agent.updateNameMap(players);
    return agent.makeStatement(players, round, events);
  }

  async castVote(
    player: Player,
    alivePlayers: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string | null> {
    const agent = this.agents.get(player.id);
    if (!agent) return null;
    agent.updateNameMap(alivePlayers);
    return agent.castVote(alivePlayers, round, events);
  }

  async nightAction(
    player: Player,
    alivePlayers: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string> {
    const agent = this.agents.get(player.id);
    if (!agent) {
      const targets = alivePlayers.filter((p) => p.id !== player.id);
      return targets[Math.floor(Math.random() * targets.length)].id;
    }
    agent.updateNameMap(alivePlayers);
    return agent.nightAction(alivePlayers, round, events);
  }
}
