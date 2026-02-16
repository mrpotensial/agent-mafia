import type { Player, Vote } from "../types.js";

export interface VoteResult {
  /** Player id that got eliminated, or null if tie/skip. */
  eliminatedId: string | null;
  /** Vote tally: playerId -> vote count. */
  tally: Map<string, number>;
  /** Number of players that skipped. */
  skips: number;
}

export class VoteSystem {
  private votes: Vote[] = [];

  /** Cast a vote. Replaces previous vote from same voter. */
  castVote(vote: Vote): void {
    // Remove previous vote from same voter
    this.votes = this.votes.filter((v) => v.voterId !== vote.voterId);
    this.votes.push(vote);
  }

  /** Tally votes and determine elimination. */
  tally(alivePlayers: Player[]): VoteResult {
    const aliveIds = new Set(alivePlayers.map((p) => p.id));
    const counts = new Map<string, number>();
    let skips = 0;

    for (const vote of this.votes) {
      // Only count votes from alive players
      if (!aliveIds.has(vote.voterId)) continue;

      if (vote.targetId === null) {
        skips++;
      } else if (aliveIds.has(vote.targetId)) {
        counts.set(vote.targetId, (counts.get(vote.targetId) ?? 0) + 1);
      }
    }

    // Find the player with the most votes
    let maxVotes = 0;
    let maxIds: string[] = [];

    for (const [id, count] of counts) {
      if (count > maxVotes) {
        maxVotes = count;
        maxIds = [id];
      } else if (count === maxVotes) {
        maxIds.push(id);
      }
    }

    // If votes exist, eliminate. On tie, random pick from tied candidates.
    let eliminatedId: string | null = null;
    if (maxVotes > 0 && maxIds.length > 0) {
      eliminatedId = maxIds[Math.floor(Math.random() * maxIds.length)];
    }

    return { eliminatedId, tally: counts, skips };
  }

  /** Get current votes (read-only). */
  getVotes(): readonly Vote[] {
    return this.votes;
  }

  /** Reset votes for next round. */
  reset(): void {
    this.votes = [];
  }
}
