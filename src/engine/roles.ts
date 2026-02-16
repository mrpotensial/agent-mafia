import { Role, Team, ROLE_TEAM } from "../types.js";
import type { Player } from "../types.js";

/**
 * Role distribution configs per player count.
 * Key = player count, Value = how many of each role.
 */
const ROLE_CONFIGS: Record<number, Record<Role, number>> = {
  5: {
    [Role.MAFIA]: 1,
    [Role.DETECTIVE]: 1,
    [Role.DOCTOR]: 1,
    [Role.VILLAGER]: 2,
  },
  6: {
    [Role.MAFIA]: 2,
    [Role.DETECTIVE]: 1,
    [Role.DOCTOR]: 1,
    [Role.VILLAGER]: 2,
  },
  7: {
    [Role.MAFIA]: 2,
    [Role.DETECTIVE]: 1,
    [Role.DOCTOR]: 1,
    [Role.VILLAGER]: 3,
  },
};

/** Shuffle array in place using Fisher-Yates. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Build a flat array of roles from the config for a given player count. */
export function buildRolePool(playerCount: number): Role[] {
  const cfg = ROLE_CONFIGS[playerCount];
  if (!cfg) {
    throw new Error(
      `No role config for ${playerCount} players. Supported: ${Object.keys(ROLE_CONFIGS).join(", ")}`,
    );
  }
  const pool: Role[] = [];
  for (const [role, count] of Object.entries(cfg)) {
    for (let i = 0; i < count; i++) {
      pool.push(role as Role);
    }
  }
  return pool;
}

/** Assign roles to players. Mutates player objects in-place and returns them. */
export function assignRoles(players: Player[]): Player[] {
  const pool = shuffle(buildRolePool(players.length));
  if (pool.length !== players.length) {
    throw new Error(
      `Role pool size (${pool.length}) != player count (${players.length})`,
    );
  }
  for (let i = 0; i < players.length; i++) {
    players[i].role = pool[i];
  }
  return players;
}

/** Get the team a role belongs to. */
export function getTeam(role: Role): Team {
  return ROLE_TEAM[role];
}

/** Get alive players from a specific team. */
export function getAliveByTeam(players: Player[], team: Team): Player[] {
  return players.filter(
    (p) => p.alive && p.role !== null && ROLE_TEAM[p.role] === team,
  );
}

/** Check win condition: Village wins if all mafia are dead. */
export function checkVillageWin(players: Player[]): boolean {
  return getAliveByTeam(players, Team.MAFIA).length === 0;
}

/** Check win condition: Mafia wins if mafia strictly outnumber village alive. */
export function checkMafiaWin(players: Player[]): boolean {
  const mafiaAlive = getAliveByTeam(players, Team.MAFIA).length;
  const villageAlive = getAliveByTeam(players, Team.VILLAGE).length;
  return mafiaAlive > 0 && mafiaAlive > villageAlive;
}

/** Check if game should end. Returns winning team or null. */
export function checkWinCondition(players: Player[]): Team | null {
  if (checkVillageWin(players)) return Team.VILLAGE;
  if (checkMafiaWin(players)) return Team.MAFIA;
  return null;
}

export { ROLE_CONFIGS };
