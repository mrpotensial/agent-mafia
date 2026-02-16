import { describe, it, expect, beforeEach } from "vitest";
import { StatsTracker } from "../src/api/stats-tracker.js";
import { GameStore } from "../src/api/game-manager.js";
import { OffChainWagerSystem, WagerType } from "../src/blockchain/wagering.js";
import { SpectatorManager } from "../src/api/spectator-manager.js";
import { Team, Role } from "../src/types.js";
import type { Player } from "../src/types.js";

// ─── StatsTracker ───────────────────────────────────────────

describe("StatsTracker", () => {
  let tracker: StatsTracker;

  const makePlayers = (): Player[] => [
    { id: "p1", name: "Alice", role: Role.MAFIA, alive: true, personality: "aggressive" },
    { id: "p2", name: "Bob", role: Role.DETECTIVE, alive: true, personality: "analytical" },
    { id: "p3", name: "Carol", role: Role.DOCTOR, alive: true, personality: "charismatic" },
    { id: "p4", name: "Dave", role: Role.VILLAGER, alive: true, personality: "paranoid" },
    { id: "p5", name: "Eve", role: Role.VILLAGER, alive: true, personality: "jester" },
  ];

  beforeEach(() => {
    tracker = new StatsTracker();
  });

  it("records a village win correctly", () => {
    const players = makePlayers();
    tracker.recordGame("session-1", "game-1", Team.VILLAGE, players, ["p2", "p3", "p4", "p5"]);

    const stats = tracker.getCharacterStats("Alice");
    expect(stats).toBeDefined();
    expect(stats!.gamesPlayed).toBe(1);
    expect(stats!.losses).toBe(1); // mafia lost
    expect(stats!.eliminated).toBe(1); // didn't survive
    expect(stats!.timesWasMafia).toBe(1);

    const bob = tracker.getCharacterStats("Bob");
    expect(bob!.wins).toBe(1);
    expect(bob!.survived).toBe(1);
    expect(bob!.timesWasDetective).toBe(1);
  });

  it("records a mafia win correctly", () => {
    const players = makePlayers();
    tracker.recordGame("session-1", "game-1", Team.MAFIA, players, ["p1"]);

    const alice = tracker.getCharacterStats("Alice");
    expect(alice!.wins).toBe(1);
    expect(alice!.survived).toBe(1);

    const bob = tracker.getCharacterStats("Bob");
    expect(bob!.losses).toBe(1);
    expect(bob!.eliminated).toBe(1);
  });

  it("tracks hot streak across games", () => {
    const players = makePlayers();

    // Alice (mafia) wins game 1
    tracker.recordGame("s1", "g1", Team.MAFIA, players, ["p1"]);
    expect(tracker.getCharacterStats("Alice")!.hotStreak).toBe(1);

    // Alice (mafia) wins game 2
    tracker.recordGame("s1", "g2", Team.MAFIA, players, ["p1"]);
    expect(tracker.getCharacterStats("Alice")!.hotStreak).toBe(2);
    expect(tracker.getCharacterStats("Alice")!.bestStreak).toBe(2);

    // Alice (mafia) loses game 3 (village wins)
    tracker.recordGame("s1", "g3", Team.VILLAGE, players, ["p2", "p3"]);
    expect(tracker.getCharacterStats("Alice")!.hotStreak).toBe(0);
    expect(tracker.getCharacterStats("Alice")!.bestStreak).toBe(2);
  });

  it("returns global leaderboard sorted by win rate", () => {
    const players = makePlayers();

    // Village wins 3 times — Bob/Carol/Dave/Eve should have higher win rates
    tracker.recordGame("s1", "g1", Team.VILLAGE, players, ["p2", "p3", "p4", "p5"]);
    tracker.recordGame("s1", "g2", Team.VILLAGE, players, ["p2", "p3", "p4", "p5"]);
    tracker.recordGame("s1", "g3", Team.MAFIA, players, ["p1"]);

    const lb = tracker.getGlobalLeaderboard();
    expect(lb.length).toBe(5);
    // Village members have 66% WR, Alice (mafia) has 33% WR
    expect(lb[0].name).not.toBe("Alice");
    expect(lb[lb.length - 1].name).toBe("Alice");
  });

  it("tracks session stats separately", () => {
    const players = makePlayers();

    tracker.recordGame("session-A", "g1", Team.VILLAGE, players, ["p2"]);
    tracker.recordGame("session-B", "g2", Team.MAFIA, players, ["p1"]);

    const lbA = tracker.getSessionLeaderboard("session-A");
    const lbB = tracker.getSessionLeaderboard("session-B");
    expect(lbA.length).toBe(5);
    expect(lbB.length).toBe(5);

    // In session A, village won — Bob should have 1 win
    const bobA = lbA.find((s) => s.name === "Bob");
    expect(bobA!.wins).toBe(1);

    // In session B, mafia won — Bob should have 0 wins
    const bobB = lbB.find((s) => s.name === "Bob");
    expect(bobB!.wins).toBe(0);
  });

  it("returns empty for nonexistent session", () => {
    expect(tracker.getSessionLeaderboard("nope")).toEqual([]);
  });

  it("returns undefined for unknown character", () => {
    expect(tracker.getCharacterStats("Unknown")).toBeUndefined();
  });

  it("generates form guide entries", () => {
    const players = makePlayers();
    tracker.recordGame("s1", "g1", Team.VILLAGE, players, ["p2", "p3"]);
    tracker.recordGame("s1", "g2", Team.VILLAGE, players, ["p2", "p3", "p4"]);

    const guide = tracker.getFormGuide(["Alice", "Bob", "Carol"]);
    expect(guide.length).toBe(3);

    for (const entry of guide) {
      expect(entry.gamesPlayed).toBe(2);
      expect(entry.winRate).toBeGreaterThanOrEqual(0);
      expect(entry.winRate).toBeLessThanOrEqual(1);
      expect(entry.survivalRate).toBeGreaterThanOrEqual(0);
      expect(entry.survivalRate).toBeLessThanOrEqual(1);
    }
  });

  it("form guide returns empty for unknown players", () => {
    const guide = tracker.getFormGuide(["Unknown1", "Unknown2"]);
    expect(guide).toEqual([]);
  });

  it("tracks session game IDs", () => {
    const players = makePlayers();
    tracker.recordGame("s1", "g1", Team.VILLAGE, players, ["p2"]);
    tracker.recordGame("s1", "g2", Team.MAFIA, players, ["p1"]);
    tracker.recordGame("s2", "g3", Team.VILLAGE, players, ["p2"]);

    const session1 = tracker.getSession("s1");
    expect(session1!.gameIds).toEqual(["g1", "g2"]);

    const session2 = tracker.getSession("s2");
    expect(session2!.gameIds).toEqual(["g3"]);
  });

  it("reset clears all stats", () => {
    const players = makePlayers();
    tracker.recordGame("s1", "g1", Team.VILLAGE, players, ["p2"]);
    tracker.reset();

    expect(tracker.getGlobalLeaderboard()).toEqual([]);
    expect(tracker.getSessionIds()).toEqual([]);
  });
});

// ─── GameStore.createNextGame ───────────────────────────────

describe("GameStore.createNextGame", () => {
  let store: GameStore;

  beforeEach(() => {
    store = new GameStore();
  });

  it("creates a next game with same characters", async () => {
    const first = store.create({ playerCount: 5, useLLM: false, entryFee: 0.1, maxRounds: 10 });
    const gameId = first.config.gameId;

    // Auto-fill and start
    store.autoFill(gameId);
    first.game.setAgentAdapter(first.agentManager);

    // Manually finish by setting status
    first.status = "finished";

    const next = store.createNextGame(gameId);
    expect(next.config.gameId).not.toBe(gameId);
    expect(next.sessionId).toBe(first.sessionId);
    expect(next.previousGameId).toBe(gameId);
    expect(next.status).toBe("lobby");

    // Same number of players
    expect(next.game.getPlayers().length).toBe(5);

    // Same names
    const firstNames = first.game.getPlayers().map((p) => p.name).sort();
    const nextNames = next.game.getPlayers().map((p) => p.name).sort();
    expect(nextNames).toEqual(firstNames);
  });

  it("throws if previous game is not finished", () => {
    const first = store.create({ playerCount: 5, useLLM: false, entryFee: 0.1, maxRounds: 10 });
    expect(() => store.createNextGame(first.config.gameId)).toThrow("must be finished");
  });

  it("throws if previous game not found", () => {
    expect(() => store.createNextGame("nonexistent")).toThrow("not found");
  });

  it("chains session across multiple next games", () => {
    const first = store.create({ playerCount: 5, useLLM: false, entryFee: 0.1, maxRounds: 10 });
    store.autoFill(first.config.gameId);
    first.status = "finished";

    const second = store.createNextGame(first.config.gameId);
    second.status = "finished";

    const third = store.createNextGame(second.config.gameId);

    // All share the same sessionId
    expect(second.sessionId).toBe(first.sessionId);
    expect(third.sessionId).toBe(first.sessionId);

    // Chain links
    expect(second.previousGameId).toBe(first.config.gameId);
    expect(third.previousGameId).toBe(second.config.gameId);
  });
});

// ─── Wager Timing Restriction ───────────────────────────────

describe("Wager timing restriction", () => {
  it("wager system allows placing wagers normally", () => {
    const ws = new OffChainWagerSystem();
    const wager = ws.place("game-1", "Player1", WagerType.TeamBet, "village", 0.1);
    expect(wager.settled).toBe(false);
    expect(ws.getPool("game-1")).toBe(0.1);
  });

  // Note: actual HTTP-level restriction is tested via integration test
  // The logic is: routes.ts checks managed.status !== "lobby" before placing
  // Only lobby phase allows wagers (before game starts, before roles assigned)
});

// ─── SpectatorManager with FormGuide ────────────────────────

describe("SpectatorManager with FormGuide", () => {
  let manager: SpectatorManager;
  let wagerSystem: OffChainWagerSystem;

  const mockPlayers: Player[] = [
    { id: "p1", name: "Alice", role: null, alive: true, personality: "aggressive" },
    { id: "p2", name: "Bob", role: null, alive: true, personality: "analytical" },
    { id: "p3", name: "Carol", role: null, alive: true, personality: "charismatic" },
    { id: "p4", name: "Dave", role: null, alive: true, personality: "paranoid" },
    { id: "p5", name: "Eve", role: null, alive: true, personality: "jester" },
  ];

  beforeEach(() => {
    manager = new SpectatorManager();
    wagerSystem = new OffChainWagerSystem();
  });

  it("accepts form guide parameter without errors", () => {
    const formGuide = [
      { name: "Alice", personality: "aggressive", gamesPlayed: 5, winRate: 0.8, survivalRate: 0.6, mafiaWinRate: 0.9, villageWinRate: 0.7, hotStreak: 3 },
      { name: "Bob", personality: "analytical", gamesPlayed: 5, winRate: 0.4, survivalRate: 0.4, mafiaWinRate: 0.3, villageWinRate: 0.5, hotStreak: 0 },
    ];

    const wagers = manager.placeAutoWagers("game-1", mockPlayers, wagerSystem, 5, formGuide);
    expect(wagers.length).toBe(5);
    expect(wagerSystem.getByGame("game-1").length).toBe(5);
  });

  it("works normally without form guide", () => {
    const wagers = manager.placeAutoWagers("game-1", mockPlayers, wagerSystem, 4);
    expect(wagers.length).toBe(4);
  });

  it("all auto-wagers are team bets (lobby-only betting)", () => {
    const wagers = manager.placeAutoWagers("game-1", mockPlayers, wagerSystem, 5);
    for (const w of wagers) {
      expect(w.wagerType).toBe(WagerType.TeamBet);
      expect(["village", "mafia"]).toContain(w.prediction);
    }
  });

  it("places valid wagers with form guide data", () => {
    const formGuide = [
      { name: "Alice", personality: "aggressive", gamesPlayed: 10, winRate: 0.3, survivalRate: 0.2, mafiaWinRate: 0.5, villageWinRate: 0.2, hotStreak: 0 },
      { name: "Bob", personality: "analytical", gamesPlayed: 10, winRate: 0.8, survivalRate: 0.9, mafiaWinRate: 0.7, villageWinRate: 0.85, hotStreak: 5 },
      { name: "Carol", personality: "charismatic", gamesPlayed: 10, winRate: 0.5, survivalRate: 0.5, mafiaWinRate: 0.4, villageWinRate: 0.55, hotStreak: 1 },
    ];

    // Run multiple times to test different paths
    for (let i = 0; i < 10; i++) {
      const ws = new OffChainWagerSystem();
      const wagers = manager.placeAutoWagers(`game-${i}`, mockPlayers, ws, 5, formGuide);
      for (const w of wagers) {
        expect(w.amount).toBeGreaterThanOrEqual(0.05);
        expect(w.amount).toBeLessThanOrEqual(0.5);
        expect(w.settled).toBe(false);
      }
    }
  });
});
