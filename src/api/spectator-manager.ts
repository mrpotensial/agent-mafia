import type { Player } from "../types.js";
import {
  OffChainWagerSystem,
  WagerType,
  type OffChainWager,
} from "../blockchain/wagering.js";
import type { FormGuideEntry } from "./stats-tracker.js";

/** Bot spectator names for auto-wagering. */
const BOT_NAMES = [
  "SharpEye_Bot",
  "LuckyGuess_AI",
  "OracleBot",
  "WagerWolf",
  "BetMaster_3000",
  "ShadowBet",
  "CoinFlipCarl",
  "DiamondHands",
  "MoonBetter",
  "Degen_AI",
];

/** Possible wager amounts (in MON). */
const AMOUNTS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.5];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Manages AI spectators that automatically place wagers on games.
 * Creates a more lively betting pool for hackathon demos.
 */
export class SpectatorManager {
  /** Pick random unique bot names. */
  generateSpectators(count: number): string[] {
    const clamped = Math.max(1, Math.min(count, BOT_NAMES.length));
    return shuffle(BOT_NAMES).slice(0, clamped);
  }

  /**
   * Place automatic wagers for AI spectators.
   * All bets are Team Bets (Village vs Mafia) since wagers are placed
   * before game starts (lobby phase) when roles are not yet assigned.
   * If formGuide is provided, bots make smarter bets based on stats.
   */
  placeAutoWagers(
    gameId: string,
    players: Player[],
    wagerSystem: OffChainWagerSystem,
    count?: number,
    formGuide?: FormGuideEntry[],
  ): OffChainWager[] {
    const spectatorCount = count ?? (3 + Math.floor(Math.random() * 3)); // 3-5
    const names = this.generateSpectators(spectatorCount);
    const wagers: OffChainWager[] = [];

    // Compute average village win rate from form guide (for smart team bets)
    const avgVillageWinRate = formGuide && formGuide.length > 0
      ? formGuide.reduce((s, e) => s + e.villageWinRate, 0) / formGuide.length
      : 0.5;

    // Track team predictions to ensure diversity
    let villageBets = 0;
    let mafiaBets = 0;

    for (const name of names) {
      const amount = pick(AMOUNTS);

      // Team bet — use form guide for smarter picks
      let team: "village" | "mafia";
      if (villageBets === 0 && mafiaBets > 0) {
        team = "village";
      } else if (mafiaBets === 0 && villageBets > 0) {
        team = "mafia";
      } else if (formGuide && formGuide.length > 0) {
        // Smart bet: favor team with higher historical win rate
        team = Math.random() < avgVillageWinRate ? "village" : "mafia";
      } else {
        team = Math.random() < 0.55 ? "village" : "mafia";
      }

      if (team === "village") villageBets++;
      else mafiaBets++;

      wagers.push(
        wagerSystem.place(gameId, name, WagerType.TeamBet, team, amount),
      );
    }

    return wagers;
  }
}
