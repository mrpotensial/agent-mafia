import { GamePhase } from "../types.js";

const VALID_TRANSITIONS: Record<GamePhase, GamePhase[]> = {
  [GamePhase.LOBBY]: [GamePhase.ROLE_ASSIGN],
  [GamePhase.ROLE_ASSIGN]: [GamePhase.DAY_DISCUSS],
  [GamePhase.DAY_DISCUSS]: [GamePhase.DAY_VOTE],
  [GamePhase.DAY_VOTE]: [GamePhase.ELIMINATION, GamePhase.NIGHT],
  [GamePhase.ELIMINATION]: [GamePhase.NIGHT, GamePhase.GAME_OVER],
  [GamePhase.NIGHT]: [GamePhase.DAWN],
  [GamePhase.DAWN]: [GamePhase.DAY_DISCUSS, GamePhase.GAME_OVER],
  [GamePhase.GAME_OVER]: [GamePhase.LOBBY],
};

export class StateMachine {
  private current: GamePhase = GamePhase.LOBBY;

  get phase(): GamePhase {
    return this.current;
  }

  canTransition(to: GamePhase): boolean {
    return VALID_TRANSITIONS[this.current].includes(to);
  }

  transition(to: GamePhase): void {
    if (!this.canTransition(to)) {
      throw new Error(
        `Invalid transition: ${this.current} -> ${to}. ` +
          `Valid targets: ${VALID_TRANSITIONS[this.current].join(", ")}`,
      );
    }
    this.current = to;
  }

  reset(): void {
    this.current = GamePhase.LOBBY;
  }

  isGameOver(): boolean {
    return this.current === GamePhase.GAME_OVER;
  }
}
