import {
  GamePhase,
  GameEventType,
  Team,
  Role,
  ROLE_TEAM,
} from "../types.js";
import type {
  Player,
  GameConfig,
  GameResult,
  GameEvent,
  Vote,
  NightAction,
  Statement,
} from "../types.js";
import { config } from "../config.js";
import { StateMachine } from "./state-machine.js";
import { VoteSystem } from "./vote-system.js";
import { TurnManager } from "./turn-manager.js";
import { GameEventEmitter } from "./event-emitter.js";
import { assignRoles, checkWinCondition } from "./roles.js";

/** Interface that agents must implement to participate in a game. */
export interface AgentAdapter {
  makeStatement(
    player: Player,
    players: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string>;

  castVote(
    player: Player,
    alivePlayers: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string | null>;

  nightAction(
    player: Player,
    alivePlayers: Player[],
    round: number,
    events: GameEvent[],
  ): Promise<string>;
}

export class Game {
  private stateMachine: StateMachine;
  private voteSystem: VoteSystem;
  private turnManager: TurnManager;
  private emitter: GameEventEmitter;
  private players: Player[] = [];
  private gameConfig: GameConfig;
  private agentAdapter: AgentAdapter | null = null;

  constructor(gameConfig: GameConfig) {
    this.gameConfig = gameConfig;
    this.stateMachine = new StateMachine();
    this.voteSystem = new VoteSystem();
    this.emitter = new GameEventEmitter();
    this.turnManager = new TurnManager(
      this.stateMachine,
      this.voteSystem,
      this.emitter,
      gameConfig.gameId,
    );
  }

  /** Set the agent adapter for AI-powered games. */
  setAgentAdapter(adapter: AgentAdapter): void {
    this.agentAdapter = adapter;
  }

  /** Subscribe to game events. */
  onEvent(listener: (event: GameEvent) => void): () => void {
    return this.emitter.on(listener);
  }

  /** Add a player to the game lobby. */
  addPlayer(player: Player): void {
    if (this.stateMachine.phase !== GamePhase.LOBBY) {
      throw new Error("Can only add players during LOBBY phase");
    }
    if (this.players.length >= this.gameConfig.playerCount) {
      throw new Error(
        `Game is full (${this.gameConfig.playerCount} players max)`,
      );
    }
    if (this.players.some((p) => p.id === player.id)) {
      throw new Error(`Player ${player.id} already in game`);
    }
    this.players.push(player);

    this.emitter.emit({
      type: GameEventType.PLAYER_JOINED,
      gameId: this.gameConfig.gameId,
      round: 0,
      phase: GamePhase.LOBBY,
      timestamp: Date.now(),
      data: { playerId: player.id, name: player.name },
    });
  }

  /** Get a read-only copy of all players. */
  getPlayers(): Player[] {
    return this.players.map((p) => ({ ...p }));
  }

  /** Get alive players. */
  getAlivePlayers(): Player[] {
    return this.players.filter((p) => p.alive);
  }

  get phase(): GamePhase {
    return this.stateMachine.phase;
  }

  get round(): number {
    return this.turnManager.currentRound;
  }

  /** Run the full game loop from LOBBY to GAME_OVER. */
  async run(): Promise<GameResult> {
    if (this.players.length !== this.gameConfig.playerCount) {
      throw new Error(
        `Need ${this.gameConfig.playerCount} players, have ${this.players.length}`,
      );
    }

    // Assign roles
    this.turnManager.startGame();
    assignRoles(this.players);

    this.emitter.emit({
      type: GameEventType.ROLES_ASSIGNED,
      gameId: this.gameConfig.gameId,
      round: 1,
      phase: GamePhase.ROLE_ASSIGN,
      timestamp: Date.now(),
      data: {
        roles: this.players.map((p) => ({
          playerId: p.id,
          role: p.role,
        })),
      },
    });

    // Begin first day
    this.turnManager.beginDay();

    // Game loop — safety limit prevents infinite loops
    let winner: Team | null = null;
    const maxIterations = this.gameConfig.maxRounds * 2;
    let iteration = 0;
    while (!winner && iteration < maxIterations) {
      iteration++;
      // Day discussion
      await this.runDiscussion();

      // Day vote
      this.turnManager.beginVoting();
      await this.runVoting();

      const alivePlayers = this.getAlivePlayers();
      const voteResult = this.turnManager.processVotes(alivePlayers);

      // Elimination
      if (voteResult.eliminatedId) {
        this.eliminatePlayer(voteResult.eliminatedId, "voted_out");
        winner = this.turnManager.afterElimination(this.players);
        if (winner) break;
      }

      // Night
      const nightResult = await this.runNight();

      // Dawn — apply night results
      if (nightResult.killedId) {
        this.eliminatePlayer(nightResult.killedId, "killed_by_mafia");

        this.emitter.emit({
          type: GameEventType.PLAYER_KILLED,
          gameId: this.gameConfig.gameId,
          round: this.turnManager.currentRound,
          phase: GamePhase.DAWN,
          timestamp: Date.now(),
          data: { playerId: nightResult.killedId },
        });
      }

      if (nightResult.savedId) {
        this.emitter.emit({
          type: GameEventType.PLAYER_SAVED,
          gameId: this.gameConfig.gameId,
          round: this.turnManager.currentRound,
          phase: GamePhase.DAWN,
          timestamp: Date.now(),
          data: { playerId: nightResult.savedId },
        });
      }

      if (nightResult.investigationResult) {
        this.emitter.emit({
          type: GameEventType.INVESTIGATION_RESULT,
          gameId: this.gameConfig.gameId,
          round: this.turnManager.currentRound,
          phase: GamePhase.NIGHT,
          timestamp: Date.now(),
          data: nightResult.investigationResult,
        });
      }

      winner = this.turnManager.afterDawn(
        this.players,
        this.gameConfig.maxRounds,
      );
    }

    // Emit game over
    this.emitter.emit({
      type: GameEventType.GAME_OVER,
      gameId: this.gameConfig.gameId,
      round: this.turnManager.currentRound,
      phase: GamePhase.GAME_OVER,
      timestamp: Date.now(),
      data: { winner },
    });

    return {
      gameId: this.gameConfig.gameId,
      winner: winner!,
      rounds: this.turnManager.currentRound,
      survivors: this.players.filter((p) => p.alive),
      eliminated: this.players.filter((p) => !p.alive),
      events: this.emitter.getHistory(),
    };
  }

  /** Run day discussion phase. Each alive player makes a statement. */
  private async runDiscussion(): Promise<void> {
    const alivePlayers = this.getAlivePlayers();

    for (const player of alivePlayers) {
      let content: string;

      if (this.agentAdapter) {
        try {
          content = await this.agentAdapter.makeStatement(
            player,
            this.getPlayers(),
            this.turnManager.currentRound,
            this.emitter.getHistory(),
          );
        } catch (err) {
          console.error(`[Game] Agent ${player.id} makeStatement failed:`, err);
          content = `[${player.name}] I need a moment to think...`;
        }
      } else {
        content = `[${player.name}] I have nothing to say.`;
      }

      this.emitter.emit({
        type: GameEventType.STATEMENT_MADE,
        gameId: this.gameConfig.gameId,
        round: this.turnManager.currentRound,
        phase: GamePhase.DAY_DISCUSS,
        timestamp: Date.now(),
        data: { playerId: player.id, content },
      });
    }
  }

  /** Run voting phase. Each alive player casts a vote. */
  private async runVoting(): Promise<void> {
    const alivePlayers = this.getAlivePlayers();

    for (const player of alivePlayers) {
      let targetId: string | null;

      if (this.agentAdapter) {
        try {
          targetId = await this.agentAdapter.castVote(
            player,
            alivePlayers,
            this.turnManager.currentRound,
            this.emitter.getHistory(),
          );
        } catch (err) {
          console.error(`[Game] Agent ${player.id} castVote failed:`, err);
          targetId = null; // Skip vote on error
        }
      } else {
        // Random vote (excluding self)
        const targets = alivePlayers.filter((p) => p.id !== player.id);
        targetId =
          targets.length > 0
            ? targets[Math.floor(Math.random() * targets.length)].id
            : null;
      }

      this.voteSystem.castVote({ voterId: player.id, targetId });

      this.emitter.emit({
        type: GameEventType.VOTE_CAST,
        gameId: this.gameConfig.gameId,
        round: this.turnManager.currentRound,
        phase: GamePhase.DAY_VOTE,
        timestamp: Date.now(),
        data: { voterId: player.id, targetId },
      });
    }
  }

  /** Run night phase. Mafia kills, detective investigates, doctor saves. */
  private async runNight(): Promise<{
    killedId: string | null;
    savedId: string | null;
    investigationResult: { targetId: string; isMafia: boolean } | null;
  }> {
    const alivePlayers = this.getAlivePlayers();
    const nightActions: NightAction[] = [];

    // Collect night actions from players with special roles
    const nightRoles = [Role.MAFIA, Role.DETECTIVE, Role.DOCTOR];
    for (const player of alivePlayers) {
      if (!player.role || !nightRoles.includes(player.role)) continue;

      let targetId: string;

      if (this.agentAdapter) {
        try {
          targetId = await this.agentAdapter.nightAction(
            player,
            alivePlayers,
            this.turnManager.currentRound,
            this.emitter.getHistory(),
          );
        } catch (err) {
          console.error(`[Game] Agent ${player.id} nightAction failed:`, err);
          // Fallback to random target
          const fallbackTargets = alivePlayers.filter((p) => p.id !== player.id);
          targetId = fallbackTargets.length > 0
            ? fallbackTargets[Math.floor(Math.random() * fallbackTargets.length)].id
            : player.id; // Last resort
        }
      } else {
        // Random target (excluding self)
        const targets = alivePlayers.filter((p) => p.id !== player.id);
        targetId = targets[Math.floor(Math.random() * targets.length)].id;
      }

      nightActions.push({
        actorId: player.id,
        role: player.role,
        targetId,
      });

      this.emitter.emit({
        type: GameEventType.NIGHT_ACTION,
        gameId: this.gameConfig.gameId,
        round: this.turnManager.currentRound,
        phase: GamePhase.NIGHT,
        timestamp: Date.now(),
        data: { actorId: player.id, role: player.role, targetId },
      });
    }

    return this.turnManager.processNight(nightActions, this.players);
  }

  /** Eliminate a player (by vote or night kill). */
  private eliminatePlayer(
    playerId: string,
    reason: "voted_out" | "killed_by_mafia",
  ): void {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;

    player.alive = false;

    this.emitter.emit({
      type: GameEventType.PLAYER_ELIMINATED,
      gameId: this.gameConfig.gameId,
      round: this.turnManager.currentRound,
      phase: this.stateMachine.phase,
      timestamp: Date.now(),
      data: {
        playerId,
        name: player.name,
        role: player.role,
        reason,
      },
    });
  }
}
