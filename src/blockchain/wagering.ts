import { ethers } from "ethers";
import { getGameContract } from "./contracts.js";
import { getProvider } from "./monad.js";

// ─── Wager Types ────────────────────────────────────────────

export enum WagerType {
  TeamBet = 0,       // Bet on which team wins
  EliminationBet = 1, // Bet on who gets eliminated next
  IdentityBet = 2,    // Bet on who is Mafia
}

// ─── Prediction Encoding ────────────────────────────────────

/** Encode a team bet prediction. */
export function encodeTeamBet(team: "village" | "mafia"): string {
  return ethers.keccak256(ethers.toUtf8Bytes(team));
}

/** Encode an elimination bet prediction. */
export function encodeEliminationBet(playerId: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`eliminate:${playerId}`));
}

/** Encode an identity bet prediction. */
export function encodeIdentityBet(playerId: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`mafia:${playerId}`));
}

// ─── Wager Operations ───────────────────────────────────────

/** Place a wager on a game. */
export async function placeWager(
  gameAddress: string,
  bettorSigner: ethers.Wallet,
  wagerType: WagerType,
  prediction: string,
  amountInMON: string,
): Promise<string> {
  const game = getGameContract(gameAddress, bettorSigner);
  const tx = await game.placeWager(wagerType, prediction, {
    value: ethers.parseEther(amountInMON),
  });
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Get wager count for a game. */
export async function getWagerCount(gameAddress: string): Promise<number> {
  const game = getGameContract(gameAddress);
  const count: bigint = await game.wagerCount();
  return Number(count);
}

/** Get total wager pool for a game. */
export async function getWagerPool(gameAddress: string): Promise<string> {
  const game = getGameContract(gameAddress);
  const pool: bigint = await game.totalWagerPool();
  return ethers.formatEther(pool);
}

// ─── Offline Wager Tracking ─────────────────────────────────
// For hackathon MVP, we also support off-chain wager tracking
// when blockchain is not available (dev/demo mode).

export interface OffChainWager {
  id: string;
  gameId: string;
  bettor: string;
  wagerType: WagerType;
  prediction: string;
  amount: number;
  timestamp: number;
  settled: boolean;
  won: boolean;
  payout: number;
}

export class OffChainWagerSystem {
  private wagers: OffChainWager[] = [];
  private nextId = 1;

  /** Place an off-chain wager. */
  place(
    gameId: string,
    bettor: string,
    wagerType: WagerType,
    prediction: string,
    amount: number,
  ): OffChainWager {
    const wager: OffChainWager = {
      id: `w${this.nextId++}`,
      gameId,
      bettor,
      wagerType,
      prediction,
      amount,
      timestamp: Date.now(),
      settled: false,
      won: false,
      payout: 0,
    };
    this.wagers.push(wager);
    return wager;
  }

  /** Platform fee percentage (10%). */
  static readonly PLATFORM_FEE_PCT = 0.10;

  /**
   * Settle wagers for a game using pool-based payout.
   *
   * How it works (per wager type):
   *   1. All bets of same type form a pool
   *   2. Platform takes 10% fee from the pool
   *   3. Remaining 90% is distributed to winners proportional to their stake
   *   4. If no winners, all bettors get refunded (minus platform fee)
   *   5. If no losers (everyone bet the same side), everyone gets their stake back
   */
  settle(
    gameId: string,
    winningTeam: "village" | "mafia",
    eliminatedIds: string[],
    mafiaIds: string[],
  ): OffChainWager[] {
    const gameWagers = this.wagers.filter(
      (w) => w.gameId === gameId && !w.settled,
    );

    // Determine win/loss for each wager
    for (const wager of gameWagers) {
      switch (wager.wagerType) {
        case WagerType.TeamBet:
          wager.won = wager.prediction === winningTeam;
          break;
        case WagerType.EliminationBet:
          wager.won = eliminatedIds.includes(wager.prediction);
          break;
        case WagerType.IdentityBet:
          wager.won = mafiaIds.includes(wager.prediction);
          break;
      }
    }

    // Settle per wager type (each type has its own pool)
    for (const wagerType of [WagerType.TeamBet, WagerType.EliminationBet, WagerType.IdentityBet]) {
      const typed = gameWagers.filter((w) => w.wagerType === wagerType);
      if (typed.length === 0) continue;

      const totalPool = typed.reduce((s, w) => s + w.amount, 0);
      const winners = typed.filter((w) => w.won);
      const winnersTotal = winners.reduce((s, w) => s + w.amount, 0);

      if (winners.length === 0) {
        // No winners — refund everyone (minus platform fee)
        for (const w of typed) {
          w.settled = true;
          w.payout = +(w.amount * (1 - OffChainWagerSystem.PLATFORM_FEE_PCT)).toFixed(4);
        }
      } else if (winners.length === typed.length) {
        // Everyone won (all bet same side) — return stakes, no profit
        for (const w of typed) {
          w.settled = true;
          w.payout = w.amount;
        }
      } else {
        // Normal case: losers fund winners
        const platformFee = totalPool * OffChainWagerSystem.PLATFORM_FEE_PCT;
        const netPool = totalPool - platformFee;

        for (const w of typed) {
          w.settled = true;
          if (w.won) {
            // Winner gets proportional share of net pool
            w.payout = +((w.amount / winnersTotal) * netPool).toFixed(4);
          } else {
            w.payout = 0;
          }
        }
      }
    }

    return gameWagers;
  }

  /** Get all wagers for a game. */
  getByGame(gameId: string): OffChainWager[] {
    return this.wagers.filter((w) => w.gameId === gameId);
  }

  /** Get total pool for a game. */
  getPool(gameId: string): number {
    return this.wagers
      .filter((w) => w.gameId === gameId)
      .reduce((sum, w) => sum + w.amount, 0);
  }

  /** Reset (for tests). */
  reset(): void {
    this.wagers = [];
    this.nextId = 1;
  }
}
