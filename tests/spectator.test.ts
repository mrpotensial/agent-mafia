import { describe, it, expect, beforeEach } from "vitest";
import { SpectatorManager } from "../src/api/spectator-manager.js";
import { OffChainWagerSystem, WagerType } from "../src/blockchain/wagering.js";
import type { Player } from "../src/types.js";

describe("SpectatorManager", () => {
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

  // ─── generateSpectators ─────────────────────────────────────

  it("generates unique spectator names", () => {
    const names = manager.generateSpectators(5);
    expect(names).toHaveLength(5);
    // All unique
    expect(new Set(names).size).toBe(5);
  });

  it("clamps spectator count to valid range", () => {
    const few = manager.generateSpectators(0);
    expect(few).toHaveLength(1);

    const many = manager.generateSpectators(20);
    expect(many).toHaveLength(10); // max 10 bot names
  });

  it("returns different sets on multiple calls (randomized)", () => {
    // Run multiple times to increase chance of different results
    const sets = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const names = manager.generateSpectators(3);
      sets.add(names.sort().join(","));
    }
    // Should have at least 2 different sets (probability ~99.9%)
    expect(sets.size).toBeGreaterThanOrEqual(2);
  });

  // ─── placeAutoWagers ────────────────────────────────────────

  it("places wagers for auto-spectators", () => {
    const wagers = manager.placeAutoWagers("game-1", mockPlayers, wagerSystem, 4);
    expect(wagers).toHaveLength(4);
    expect(wagerSystem.getByGame("game-1")).toHaveLength(4);
  });

  it("places 3-5 wagers with default count", () => {
    const wagers = manager.placeAutoWagers("game-1", mockPlayers, wagerSystem);
    expect(wagers.length).toBeGreaterThanOrEqual(3);
    expect(wagers.length).toBeLessThanOrEqual(5);
  });

  it("all auto-wagers are team bets (lobby-only betting)", () => {
    for (let i = 0; i < 10; i++) {
      const ws = new OffChainWagerSystem();
      const wagers = manager.placeAutoWagers(`game-${i}`, mockPlayers, ws, 5);
      for (const w of wagers) {
        expect(w.wagerType).toBe(WagerType.TeamBet);
        expect(["village", "mafia"]).toContain(w.prediction);
      }
    }
  });

  it("uses valid amounts (0.05-0.5)", () => {
    const wagers = manager.placeAutoWagers("game-1", mockPlayers, wagerSystem, 5);
    for (const w of wagers) {
      expect(w.amount).toBeGreaterThanOrEqual(0.05);
      expect(w.amount).toBeLessThanOrEqual(0.5);
    }
  });

  it("uses valid predictions (village or mafia)", () => {
    const wagers = manager.placeAutoWagers("game-1", mockPlayers, wagerSystem, 5);
    for (const w of wagers) {
      expect(["village", "mafia"]).toContain(w.prediction);
    }
  });

  it("creates pool in wager system", () => {
    manager.placeAutoWagers("game-1", mockPlayers, wagerSystem, 3);
    const pool = wagerSystem.getPool("game-1");
    expect(pool).toBeGreaterThan(0);
  });

  it("handles empty player list (falls back to team bets)", () => {
    const wagers = manager.placeAutoWagers("game-1", [], wagerSystem, 3);
    expect(wagers).toHaveLength(3);
    // All should be team bets when no players
    for (const w of wagers) {
      expect(w.wagerType).toBe(WagerType.TeamBet);
    }
  });

  it("spectator wagers can be settled", () => {
    manager.placeAutoWagers("game-1", mockPlayers, wagerSystem, 4);
    const settled = wagerSystem.settle("game-1", "village", ["p3"], ["p2"]);
    expect(settled).toHaveLength(4);
    for (const w of settled) {
      expect(w.settled).toBe(true);
    }
  });

  it("different spectators have unique names", () => {
    const wagers = manager.placeAutoWagers("game-1", mockPlayers, wagerSystem, 5);
    const bettorNames = wagers.map((w) => w.bettor);
    expect(new Set(bettorNames).size).toBe(5);
  });

  it("team bets have diversity (not all same side)", () => {
    // Run many times — diversity check ensures at least some variation
    let hadDiversity = false;
    for (let i = 0; i < 20; i++) {
      const ws = new OffChainWagerSystem();
      const wagers = manager.placeAutoWagers(`game-${i}`, mockPlayers, ws, 5);
      const teamBets = wagers.filter((w) => w.wagerType === WagerType.TeamBet);
      const predictions = teamBets.map((w) => w.prediction);
      if (predictions.includes("village") && predictions.includes("mafia")) {
        hadDiversity = true;
        break;
      }
    }
    expect(hadDiversity).toBe(true);
  });
});
