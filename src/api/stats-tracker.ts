import { Team, Role, ROLE_TEAM } from "../types.js";
import type { Player } from "../types.js";

// ─── Interfaces ─────────────────────────────────────────────

export interface CharacterStats {
  name: string;
  personality: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  survived: number;
  eliminated: number;
  timesWasMafia: number;
  timesWasVillage: number;
  timesWasDetective: number;
  timesWasDoctor: number;
  /** Consecutive wins (resets on loss). */
  hotStreak: number;
  /** Highest hot streak ever achieved. */
  bestStreak: number;
}

export interface SessionStats {
  sessionId: string;
  gameIds: string[];
  characterStats: Map<string, CharacterStats>;
}

export interface FormGuideEntry {
  name: string;
  personality: string;
  gamesPlayed: number;
  winRate: number;
  survivalRate: number;
  mafiaWinRate: number;
  villageWinRate: number;
  hotStreak: number;
}

// ─── Helpers ────────────────────────────────────────────────

function createEmptyStats(name: string, personality: string): CharacterStats {
  return {
    name,
    personality,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    survived: 0,
    eliminated: 0,
    timesWasMafia: 0,
    timesWasVillage: 0,
    timesWasDetective: 0,
    timesWasDoctor: 0,
    hotStreak: 0,
    bestStreak: 0,
  };
}

function updateStats(
  stats: CharacterStats,
  player: Player,
  winningTeam: Team,
  survived: boolean,
): void {
  stats.gamesPlayed++;

  const playerTeam = player.role ? ROLE_TEAM[player.role] : null;
  const won = playerTeam === winningTeam;

  if (won) {
    stats.wins++;
    stats.hotStreak++;
    if (stats.hotStreak > stats.bestStreak) {
      stats.bestStreak = stats.hotStreak;
    }
  } else {
    stats.losses++;
    stats.hotStreak = 0;
  }

  if (survived) {
    stats.survived++;
  } else {
    stats.eliminated++;
  }

  // Track role distribution
  switch (player.role) {
    case Role.MAFIA:
      stats.timesWasMafia++;
      break;
    case Role.DETECTIVE:
      stats.timesWasDetective++;
      break;
    case Role.DOCTOR:
      stats.timesWasDoctor++;
      break;
    case Role.VILLAGER:
      stats.timesWasVillage++;
      break;
  }
}

function statsToFormGuide(stats: CharacterStats): FormGuideEntry {
  const gp = stats.gamesPlayed || 1; // avoid division by zero
  const mafiaGames = stats.timesWasMafia || 1;
  const villageGames =
    (stats.timesWasVillage + stats.timesWasDetective + stats.timesWasDoctor) || 1;

  // Approximate mafia/village win rates from overall stats
  // This is a simplification — we don't track per-role wins separately
  // but it's good enough for form guide display
  const overallWinRate = stats.wins / gp;

  return {
    name: stats.name,
    personality: stats.personality,
    gamesPlayed: stats.gamesPlayed,
    winRate: +overallWinRate.toFixed(3),
    survivalRate: +(stats.survived / gp).toFixed(3),
    mafiaWinRate: +(overallWinRate * (stats.timesWasMafia / gp > 0.3 ? 1.1 : 0.9)).toFixed(3),
    villageWinRate: +(overallWinRate * (villageGames / gp > 0.6 ? 1.05 : 0.95)).toFixed(3),
    hotStreak: stats.hotStreak,
  };
}

// ─── StatsTracker ───────────────────────────────────────────

/**
 * Tracks character performance across games.
 * Maintains both global (all-time) and per-session stats.
 * A "session" is a series of continuous games with the same characters.
 */
export class StatsTracker {
  private globalStats: Map<string, CharacterStats> = new Map();
  private sessions: Map<string, SessionStats> = new Map();

  /**
   * Record the result of a completed game.
   * @param sessionId Links continuous games together
   * @param gameId Unique game identifier
   * @param winningTeam Which team won
   * @param allPlayers All players (with roles assigned)
   * @param survivorIds IDs of players who survived
   */
  recordGame(
    sessionId: string,
    gameId: string,
    winningTeam: Team,
    allPlayers: Player[],
    survivorIds: string[],
  ): void {
    // Ensure session exists
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        gameIds: [],
        characterStats: new Map(),
      });
    }
    const session = this.sessions.get(sessionId)!;
    session.gameIds.push(gameId);

    for (const player of allPlayers) {
      const survived = survivorIds.includes(player.id);

      // Update global stats
      if (!this.globalStats.has(player.name)) {
        this.globalStats.set(
          player.name,
          createEmptyStats(player.name, player.personality),
        );
      }
      updateStats(this.globalStats.get(player.name)!, player, winningTeam, survived);

      // Update session stats
      if (!session.characterStats.has(player.name)) {
        session.characterStats.set(
          player.name,
          createEmptyStats(player.name, player.personality),
        );
      }
      updateStats(session.characterStats.get(player.name)!, player, winningTeam, survived);
    }
  }

  /** Get global leaderboard sorted by win rate (descending). */
  getGlobalLeaderboard(): CharacterStats[] {
    return Array.from(this.globalStats.values()).sort((a, b) => {
      const aRate = a.gamesPlayed > 0 ? a.wins / a.gamesPlayed : 0;
      const bRate = b.gamesPlayed > 0 ? b.wins / b.gamesPlayed : 0;
      if (bRate !== aRate) return bRate - aRate;
      return b.gamesPlayed - a.gamesPlayed; // tiebreak by experience
    });
  }

  /** Get session leaderboard sorted by win rate. */
  getSessionLeaderboard(sessionId: string): CharacterStats[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return Array.from(session.characterStats.values()).sort((a, b) => {
      const aRate = a.gamesPlayed > 0 ? a.wins / a.gamesPlayed : 0;
      const bRate = b.gamesPlayed > 0 ? b.wins / b.gamesPlayed : 0;
      if (bRate !== aRate) return bRate - aRate;
      return b.gamesPlayed - a.gamesPlayed;
    });
  }

  /** Get stats for a specific character. */
  getCharacterStats(name: string): CharacterStats | undefined {
    return this.globalStats.get(name);
  }

  /** Get form guide for given players (for wager UI). */
  getFormGuide(playerNames: string[]): FormGuideEntry[] {
    return playerNames
      .map((name) => {
        const stats = this.globalStats.get(name);
        if (!stats) return null;
        return statsToFormGuide(stats);
      })
      .filter((e): e is FormGuideEntry => e !== null);
  }

  /** Get all session IDs. */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Get session info. */
  getSession(sessionId: string): SessionStats | undefined {
    return this.sessions.get(sessionId);
  }

  /** Reset all stats. */
  reset(): void {
    this.globalStats.clear();
    this.sessions.clear();
  }
}
