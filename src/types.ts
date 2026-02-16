// ─── Game States ────────────────────────────────────────────

export enum GamePhase {
  LOBBY = "lobby",
  ROLE_ASSIGN = "role_assign",
  DAY_DISCUSS = "day_discuss",
  DAY_VOTE = "day_vote",
  ELIMINATION = "elimination",
  NIGHT = "night",
  DAWN = "dawn",
  GAME_OVER = "game_over",
}

// ─── Roles ──────────────────────────────────────────────────

export enum Role {
  VILLAGER = "villager",
  MAFIA = "mafia",
  DETECTIVE = "detective",
  DOCTOR = "doctor",
}

export enum Team {
  VILLAGE = "village",
  MAFIA = "mafia",
}

export const ROLE_TEAM: Record<Role, Team> = {
  [Role.VILLAGER]: Team.VILLAGE,
  [Role.MAFIA]: Team.MAFIA,
  [Role.DETECTIVE]: Team.VILLAGE,
  [Role.DOCTOR]: Team.VILLAGE,
};

// ─── Player ─────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  role: Role | null;
  alive: boolean;
  personality: string;
}

// ─── Actions ────────────────────────────────────────────────

export interface Statement {
  playerId: string;
  content: string;
  round: number;
  phase: GamePhase;
}

export interface Accusation {
  accuserId: string;
  targetId: string;
  reason: string;
}

export interface Vote {
  voterId: string;
  targetId: string | null; // null = skip
}

export interface NightAction {
  actorId: string;
  role: Role;
  targetId: string;
}

// ─── Events ─────────────────────────────────────────────────

export enum GameEventType {
  GAME_CREATED = "game_created",
  PLAYER_JOINED = "player_joined",
  ROLES_ASSIGNED = "roles_assigned",
  PHASE_CHANGED = "phase_changed",
  STATEMENT_MADE = "statement_made",
  ACCUSATION_MADE = "accusation_made",
  VOTE_CAST = "vote_cast",
  PLAYER_ELIMINATED = "player_eliminated",
  NIGHT_ACTION = "night_action",
  PLAYER_SAVED = "player_saved",
  PLAYER_KILLED = "player_killed",
  INVESTIGATION_RESULT = "investigation_result",
  GAME_OVER = "game_over",
}

export interface GameEvent {
  type: GameEventType;
  gameId: string;
  round: number;
  phase: GamePhase;
  timestamp: number;
  data: Record<string, unknown>;
}

// ─── Game Result ────────────────────────────────────────────

export interface GameResult {
  gameId: string;
  winner: Team;
  rounds: number;
  survivors: Player[];
  eliminated: Player[];
  events: GameEvent[];
}

// ─── Game Config ────────────────────────────────────────────

export interface GameConfig {
  gameId: string;
  playerCount: number;
  entryFee: number;
  maxRounds: number;
}

// ─── External Player Actions ────────────────────────────────

export type ActionType = "statement" | "vote" | "night_action";

export interface ActionContext {
  gameId: string;
  playerId: string;
  playerName: string;
  actionType: ActionType;
  round: number;
  phase: GamePhase;
  role: Role | null;
  alivePlayers: { id: string; name: string; alive: boolean }[];
  allPlayers: { id: string; name: string; alive: boolean }[];
  recentEvents: GameEvent[];
  timeoutMs: number;
  instructions: string;
}
