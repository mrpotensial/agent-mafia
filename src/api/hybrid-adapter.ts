import type { AgentAdapter } from "../engine/game.js";
import type { AgentManager } from "../agents/agent-adapter.js";
import type { Player, GameEvent, ActionType, ActionContext } from "../types.js";
import { GamePhase, GameEventType, Role } from "../types.js";
import { createPendingAction } from "./pending-actions.js";
import { broadcastToGame } from "./websocket.js";

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Routes AI players to AgentManager and external players to the pending action system.
 * The game loop awaits each adapter call — for external players, the Promise resolves
 * when they submit via HTTP or when the timeout fires with a random fallback.
 */
export class HybridAgentAdapter implements AgentAdapter {
  constructor(
    private agentManager: AgentManager,
    private externalPlayerIds: Set<string>,
    private gameId: string,
    private timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async makeStatement(
    player: Player,
    players: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string> {
    if (!this.externalPlayerIds.has(player.id)) {
      return this.agentManager.makeStatement(player, players, round, events);
    }

    const context = this.buildContext(player, players, round, events, "statement");
    this.broadcastActionRequired(context);

    const result = await createPendingAction(
      this.gameId,
      player.id,
      "statement",
      context,
      this.timeoutMs,
      () => `${player.name} stays silent...`,
    );

    return result ?? `${player.name} stays silent...`;
  }

  async castVote(
    player: Player,
    alivePlayers: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string | null> {
    if (!this.externalPlayerIds.has(player.id)) {
      return this.agentManager.castVote(player, alivePlayers, round, events);
    }

    const context = this.buildContext(player, alivePlayers, round, events, "vote");
    this.broadcastActionRequired(context);

    return createPendingAction(
      this.gameId,
      player.id,
      "vote",
      context,
      this.timeoutMs,
      () => {
        const targets = alivePlayers.filter((p) => p.id !== player.id);
        return targets.length > 0
          ? targets[Math.floor(Math.random() * targets.length)].id
          : null;
      },
    );
  }

  async nightAction(
    player: Player,
    alivePlayers: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string> {
    if (!this.externalPlayerIds.has(player.id)) {
      return this.agentManager.nightAction(player, alivePlayers, round, events);
    }

    const context = this.buildContext(player, alivePlayers, round, events, "night_action");
    this.broadcastActionRequired(context);

    const result = await createPendingAction(
      this.gameId,
      player.id,
      "night_action",
      context,
      this.timeoutMs,
      () => {
        const targets = alivePlayers.filter((p) => p.id !== player.id);
        return targets[Math.floor(Math.random() * targets.length)].id;
      },
    );

    // Night action must never be null
    if (!result) {
      const targets = alivePlayers.filter((p) => p.id !== player.id);
      return targets[Math.floor(Math.random() * targets.length)].id;
    }
    return result;
  }

  private buildContext(
    player: Player,
    players: Player[],
    round: number,
    events: GameEvent[],
    actionType: ActionType,
  ): ActionContext {
    // Filter: hide raw NIGHT_ACTION, only show detective's own investigation results
    const publicEvents = events.filter((e) => {
      if (e.type === GameEventType.NIGHT_ACTION) return false;
      if (e.type === GameEventType.INVESTIGATION_RESULT) {
        const data = e.data as { detectiveId?: string };
        return data.detectiveId === player.id;
      }
      return true;
    });

    return {
      gameId: this.gameId,
      playerId: player.id,
      playerName: player.name,
      actionType,
      round,
      phase:
        actionType === "night_action"
          ? GamePhase.NIGHT
          : actionType === "vote"
            ? GamePhase.DAY_VOTE
            : GamePhase.DAY_DISCUSS,
      role: player.role,
      alivePlayers: players
        .filter((p) => p.alive)
        .map((p) => ({ id: p.id, name: p.name, alive: p.alive })),
      allPlayers: players.map((p) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
      })),
      recentEvents: publicEvents.slice(-30),
      timeoutMs: this.timeoutMs,
      instructions: this.getInstructions(player, actionType, round),
    };
  }

  private getInstructions(
    player: Player,
    actionType: ActionType,
    round: number,
  ): string {
    switch (actionType) {
      case "statement":
        return (
          `Day Discussion (Round ${round}). Make a statement to the group. ` +
          `You can accuse, defend, analyze, or bluff. Your role is ${player.role}. ` +
          `Respond with your statement text (max 200 words).`
        );
      case "vote":
        return (
          `Voting Phase (Round ${round}). Choose a player to eliminate ` +
          `by providing their player ID, or respond with "skip" to abstain. ` +
          `Your role is ${player.role}.`
        );
      case "night_action":
        return this.getNightInstructions(player, round);
    }
  }

  private getNightInstructions(player: Player, round: number): string {
    switch (player.role) {
      case Role.MAFIA:
        return (
          `Night Phase (Round ${round}). You are MAFIA. ` +
          `Choose a player to KILL tonight by providing their player ID.`
        );
      case Role.DETECTIVE:
        return (
          `Night Phase (Round ${round}). You are the DETECTIVE. ` +
          `Choose a player to INVESTIGATE by providing their player ID.`
        );
      case Role.DOCTOR:
        return (
          `Night Phase (Round ${round}). You are the DOCTOR. ` +
          `Choose a player to PROTECT tonight by providing their player ID.`
        );
      default:
        return `Night Phase (Round ${round}). You have no night action.`;
    }
  }

  private broadcastActionRequired(context: ActionContext): void {
    broadcastToGame(this.gameId, {
      type: GameEventType.PHASE_CHANGED,
      gameId: this.gameId,
      round: context.round,
      phase: context.phase,
      timestamp: Date.now(),
      data: {
        customType: "action_required",
        playerId: context.playerId,
        playerName: context.playerName,
        actionType: context.actionType,
        timeoutMs: context.timeoutMs,
      },
    });
  }
}
