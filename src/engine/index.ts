export { StateMachine } from "./state-machine.js";
export { VoteSystem } from "./vote-system.js";
export type { VoteResult } from "./vote-system.js";
export { TurnManager } from "./turn-manager.js";
export { GameEventEmitter } from "./event-emitter.js";
export type { GameEventListener } from "./event-emitter.js";
export { Game } from "./game.js";
export type { AgentAdapter } from "./game.js";
export {
  assignRoles,
  buildRolePool,
  checkWinCondition,
  checkVillageWin,
  checkMafiaWin,
  getAliveByTeam,
  getTeam,
  ROLE_CONFIGS,
} from "./roles.js";
