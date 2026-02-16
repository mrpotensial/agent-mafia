import { GameEventType, Role } from "../types.js";
import type { GameEvent } from "../types.js";

interface MemoryEntry {
  round: number;
  type: string;
  summary: string;
}

/**
 * Per-game memory for an AI agent.
 * Tracks statements, votes, eliminations, and private knowledge.
 */
export class AgentMemory {
  private playerId: string;
  private entries: MemoryEntry[] = [];
  private knowledge: string[] = []; // Private info (detective results, etc.)
  private suspicions: Map<string, number> = new Map(); // playerId -> suspicion level
  private allies: Set<string> = new Set();
  private nameMap: Map<string, string> = new Map(); // playerId -> name

  constructor(playerId: string) {
    this.playerId = playerId;
  }

  /** Set name mapping so memory uses player names instead of IDs. */
  setNameMap(players: Array<{ id: string; name: string }>): void {
    for (const p of players) {
      this.nameMap.set(p.id, p.name);
    }
  }

  /** Resolve a player ID to their name. */
  private resolveName(playerId: string): string {
    return this.nameMap.get(playerId) ?? playerId;
  }

  /** Record a game event into memory. */
  record(event: GameEvent): void {
    switch (event.type) {
      case GameEventType.STATEMENT_MADE: {
        const { playerId, content } = event.data as {
          playerId: string;
          content: string;
        };
        this.entries.push({
          round: event.round,
          type: "statement",
          summary: `${this.resolveName(playerId)} said: "${this.truncate(content as string, 250)}"`,
        });
        break;
      }

      case GameEventType.VOTE_CAST: {
        const { voterId, targetId } = event.data as {
          voterId: string;
          targetId: string | null;
        };
        const action = targetId ? `voted for ${this.resolveName(targetId)}` : "skipped vote";
        this.entries.push({
          round: event.round,
          type: "vote",
          summary: `${this.resolveName(voterId)} ${action}`,
        });
        break;
      }

      case GameEventType.PLAYER_ELIMINATED: {
        const { playerId, name, role, reason } = event.data as {
          playerId: string;
          name: string;
          role: string;
          reason: string;
        };
        this.entries.push({
          round: event.round,
          type: "elimination",
          summary: `${name} was ${reason === "voted_out" ? "voted out" : "killed by Mafia"}. They were ${role}.`,
        });
        // Remove from suspicions and allies
        this.suspicions.delete(playerId);
        this.allies.delete(playerId);
        break;
      }

      case GameEventType.PLAYER_KILLED: {
        const { playerId } = event.data as { playerId: string };
        this.entries.push({
          round: event.round,
          type: "kill",
          summary: `${this.resolveName(playerId)} was killed during the night by Mafia.`,
        });
        break;
      }

      case GameEventType.PLAYER_SAVED: {
        const { playerId } = event.data as { playerId: string };
        this.entries.push({
          round: event.round,
          type: "save",
          summary: `Someone was saved by the Doctor during the night.`,
        });
        break;
      }

      case GameEventType.INVESTIGATION_RESULT: {
        const { targetId, isMafia } = event.data as {
          targetId: string;
          isMafia: boolean;
        };
        // Only the detective who investigated should see this
        const result = isMafia ? "IS MAFIA" : "is NOT Mafia";
        this.knowledge.push(
          `Round ${event.round}: Investigated ${this.resolveName(targetId)} — ${result}`,
        );
        if (isMafia) {
          this.suspicions.set(targetId, 1.0);
        } else {
          this.suspicions.set(targetId, 0.0);
          this.allies.add(targetId);
        }
        break;
      }
    }
  }

  /** Add private knowledge (e.g., detective investigation result). */
  addKnowledge(info: string): void {
    this.knowledge.push(info);
  }

  /** Adjust suspicion level for a player. */
  adjustSuspicion(playerId: string, delta: number): void {
    const current = this.suspicions.get(playerId) ?? 0.5;
    this.suspicions.set(playerId, Math.max(0, Math.min(1, current + delta)));
  }

  /** Get full event summary grouped by round. */
  getRecentSummary(): string {
    if (this.entries.length === 0) return "";
    const byRound = new Map<number, MemoryEntry[]>();
    for (const e of this.entries) {
      if (!byRound.has(e.round)) byRound.set(e.round, []);
      byRound.get(e.round)!.push(e);
    }
    const lines: string[] = [];
    for (const [round, entries] of byRound) {
      for (const e of entries) {
        lines.push(`[Round ${round}] ${e.summary}`);
      }
    }
    return lines.join("\n");
  }

  /** Get voting history across all rounds. */
  getVotingHistory(): string {
    const voteEntries = this.entries.filter((e) => e.type === "vote");
    if (voteEntries.length === 0) return "";
    const byRound = new Map<number, string[]>();
    for (const e of voteEntries) {
      if (!byRound.has(e.round)) byRound.set(e.round, []);
      byRound.get(e.round)!.push(e.summary);
    }
    const lines: string[] = [];
    for (const [round, votes] of byRound) {
      lines.push(`Round ${round}: ${votes.join("; ")}`);
    }
    return lines.join("\n");
  }

  /** Get suspicion summary formatted for prompts. */
  getSuspicionSummary(): string {
    if (this.suspicions.size === 0) return "";
    const lines: string[] = [];
    for (const [playerId, level] of this.suspicions) {
      const name = this.resolveName(playerId);
      let label: string;
      if (level >= 0.8) label = "CONFIRMED MAFIA";
      else if (level >= 0.6) label = "highly suspicious";
      else if (level >= 0.4) label = "somewhat suspicious";
      else if (level <= 0.1) label = "confirmed innocent";
      else if (level <= 0.3) label = "likely innocent";
      else label = "neutral";
      lines.push(`${name}: ${label}`);
    }
    return lines.join(", ");
  }

  /** Get private knowledge as a formatted string. */
  getKnowledge(): string {
    if (this.knowledge.length === 0) return "";
    return this.knowledge.join("\n");
  }

  /** Get suspicion levels. */
  getSuspicions(): Map<string, number> {
    return new Map(this.suspicions);
  }

  /** Get all memory entries. */
  getEntries(): readonly MemoryEntry[] {
    return this.entries;
  }

  private truncate(text: string, maxLen: number): string {
    return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  }
}
