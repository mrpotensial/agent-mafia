import { GamePhase, Team, GameEventType, Role } from "../types.js";
import type { Player, NightAction, GameConfig } from "../types.js";
import { StateMachine } from "./state-machine.js";
import { VoteSystem, type VoteResult } from "./vote-system.js";
import { checkWinCondition } from "./roles.js";
import { GameEventEmitter } from "./event-emitter.js";

export class TurnManager {
  private stateMachine: StateMachine;
  private voteSystem: VoteSystem;
  private emitter: GameEventEmitter;
  private round = 0;
  private gameId: string;

  constructor(
    stateMachine: StateMachine,
    voteSystem: VoteSystem,
    emitter: GameEventEmitter,
    gameId: string,
  ) {
    this.stateMachine = stateMachine;
    this.voteSystem = voteSystem;
    this.emitter = emitter;
    this.gameId = gameId;
  }

  get currentRound(): number {
    return this.round;
  }

  get phase(): GamePhase {
    return this.stateMachine.phase;
  }

  /** Start the game: assign roles and enter day discussion. */
  startGame(): void {
    this.round = 1;
    this.stateMachine.transition(GamePhase.ROLE_ASSIGN);
    this.emitPhaseChange();
  }

  /** Move from role assignment to first day discussion. */
  beginDay(): void {
    this.stateMachine.transition(GamePhase.DAY_DISCUSS);
    this.emitPhaseChange();
  }

  /** Move from discussion to voting. */
  beginVoting(): void {
    this.stateMachine.transition(GamePhase.DAY_VOTE);
    this.voteSystem.reset();
    this.emitPhaseChange();
  }

  /**
   * Process vote results. Transitions to ELIMINATION or NIGHT.
   * Returns the vote result.
   */
  processVotes(alivePlayers: Player[]): VoteResult {
    const result = this.voteSystem.tally(alivePlayers);

    if (result.eliminatedId) {
      this.stateMachine.transition(GamePhase.ELIMINATION);
      this.emitPhaseChange();
    } else {
      // No elimination (tie or all skips) — go to night
      this.stateMachine.transition(GamePhase.NIGHT);
      this.emitPhaseChange();
    }

    return result;
  }

  /**
   * After elimination, check win condition.
   * Transitions to NIGHT or GAME_OVER.
   */
  afterElimination(players: Player[]): Team | null {
    const winner = checkWinCondition(players);
    if (winner) {
      this.stateMachine.transition(GamePhase.GAME_OVER);
      this.emitPhaseChange();
      return winner;
    }

    this.stateMachine.transition(GamePhase.NIGHT);
    this.emitPhaseChange();
    return null;
  }

  /** Begin night phase (mafia kill, detective investigate, doctor save). */
  beginNight(): void {
    // Already transitioned via processVotes or afterElimination
    // This is called when the phase is already NIGHT
  }

  /**
   * Process night actions and transition to DAWN.
   * Returns: { killedId, savedId, investigationResult }
   */
  processNight(
    actions: NightAction[],
    players: Player[],
  ): {
    killedId: string | null;
    savedId: string | null;
    investigationResult: { targetId: string; isMafia: boolean } | null;
  } {
    // Collect mafia votes for consensus (multiple mafia members vote on a target)
    const mafiaVotes: string[] = [];
    let doctorTargetId: string | null = null;
    let investigationResult: {
      targetId: string;
      isMafia: boolean;
    } | null = null;

    for (const action of actions) {
      // Validate target is a real, alive player
      const validTarget = players.find(
        (p) => p.id === action.targetId && p.alive,
      );

      switch (action.role) {
        case Role.MAFIA:
          if (validTarget) mafiaVotes.push(action.targetId);
          break;
        case Role.DOCTOR:
          doctorTargetId = validTarget ? action.targetId : null;
          break;
        case Role.DETECTIVE: {
          const target = players.find((p) => p.id === action.targetId);
          if (target?.role) {
            investigationResult = {
              targetId: action.targetId,
              isMafia: target.role === Role.MAFIA,
            };
          }
          break;
        }
      }
    }

    // Mafia consensus: pick the most-voted target; ties broken by first vote
    let mafiaTargetId: string | null = null;
    if (mafiaVotes.length > 0) {
      const voteCounts = new Map<string, number>();
      for (const id of mafiaVotes) {
        voteCounts.set(id, (voteCounts.get(id) ?? 0) + 1);
      }
      let maxCount = 0;
      for (const [id, count] of voteCounts) {
        if (count > maxCount) {
          maxCount = count;
          mafiaTargetId = id;
        }
      }
    }

    const savedId =
      mafiaTargetId && mafiaTargetId === doctorTargetId
        ? doctorTargetId
        : null;
    const killedId = savedId ? null : mafiaTargetId;

    this.stateMachine.transition(GamePhase.DAWN);
    this.emitPhaseChange();

    return { killedId, savedId, investigationResult };
  }

  /**
   * After dawn announcement, check win condition.
   * Transitions to DAY_DISCUSS or GAME_OVER.
   */
  afterDawn(players: Player[], maxRounds: number): Team | null {
    const winner = checkWinCondition(players);
    if (winner) {
      this.stateMachine.transition(GamePhase.GAME_OVER);
      this.emitPhaseChange();
      return winner;
    }

    if (this.round >= maxRounds) {
      // Draw — mafia wins by default (they survived)
      this.stateMachine.transition(GamePhase.GAME_OVER);
      this.emitPhaseChange();
      return Team.MAFIA;
    }

    this.round++;
    this.stateMachine.transition(GamePhase.DAY_DISCUSS);
    this.emitPhaseChange();
    return null;
  }

  private emitPhaseChange(): void {
    this.emitter.emit({
      type: GameEventType.PHASE_CHANGED,
      gameId: this.gameId,
      round: this.round,
      phase: this.stateMachine.phase,
      timestamp: Date.now(),
      data: { phase: this.stateMachine.phase, round: this.round },
    });
  }
}
