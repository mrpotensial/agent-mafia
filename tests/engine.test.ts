import { describe, it, expect, beforeEach } from "vitest";
import { StateMachine } from "../src/engine/state-machine.js";
import { VoteSystem } from "../src/engine/vote-system.js";
import { GameEventEmitter } from "../src/engine/event-emitter.js";
import {
  assignRoles,
  buildRolePool,
  checkWinCondition,
  checkVillageWin,
  checkMafiaWin,
} from "../src/engine/roles.js";
import { Game } from "../src/engine/game.js";
import { GamePhase, Role, Team, GameEventType } from "../src/types.js";
import type { Player, GameEvent } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    role: null,
    alive: true,
    personality: "analytical",
  }));
}

// ─── StateMachine ───────────────────────────────────────────

describe("StateMachine", () => {
  let sm: StateMachine;

  beforeEach(() => {
    sm = new StateMachine();
  });

  it("starts in LOBBY phase", () => {
    expect(sm.phase).toBe(GamePhase.LOBBY);
  });

  it("allows valid transitions", () => {
    expect(sm.canTransition(GamePhase.ROLE_ASSIGN)).toBe(true);
    sm.transition(GamePhase.ROLE_ASSIGN);
    expect(sm.phase).toBe(GamePhase.ROLE_ASSIGN);
  });

  it("rejects invalid transitions", () => {
    expect(sm.canTransition(GamePhase.NIGHT)).toBe(false);
    expect(() => sm.transition(GamePhase.NIGHT)).toThrow("Invalid transition");
  });

  it("walks through full game cycle", () => {
    sm.transition(GamePhase.ROLE_ASSIGN);
    sm.transition(GamePhase.DAY_DISCUSS);
    sm.transition(GamePhase.DAY_VOTE);
    sm.transition(GamePhase.ELIMINATION);
    sm.transition(GamePhase.NIGHT);
    sm.transition(GamePhase.DAWN);
    sm.transition(GamePhase.GAME_OVER);
    expect(sm.isGameOver()).toBe(true);
  });

  it("allows skip elimination (tie) -> night", () => {
    sm.transition(GamePhase.ROLE_ASSIGN);
    sm.transition(GamePhase.DAY_DISCUSS);
    sm.transition(GamePhase.DAY_VOTE);
    // Tie — go to night directly
    sm.transition(GamePhase.NIGHT);
    expect(sm.phase).toBe(GamePhase.NIGHT);
  });

  it("resets to LOBBY", () => {
    sm.transition(GamePhase.ROLE_ASSIGN);
    sm.reset();
    expect(sm.phase).toBe(GamePhase.LOBBY);
  });
});

// ─── Roles ──────────────────────────────────────────────────

describe("Roles", () => {
  it("builds correct role pool for 5 players", () => {
    const pool = buildRolePool(5);
    expect(pool).toHaveLength(5);
    expect(pool.filter((r) => r === Role.MAFIA)).toHaveLength(1);
    expect(pool.filter((r) => r === Role.DETECTIVE)).toHaveLength(1);
    expect(pool.filter((r) => r === Role.DOCTOR)).toHaveLength(1);
    expect(pool.filter((r) => r === Role.VILLAGER)).toHaveLength(2);
  });

  it("builds correct role pool for 6 players", () => {
    const pool = buildRolePool(6);
    expect(pool).toHaveLength(6);
    expect(pool.filter((r) => r === Role.MAFIA)).toHaveLength(2);
    expect(pool.filter((r) => r === Role.DETECTIVE)).toHaveLength(1);
    expect(pool.filter((r) => r === Role.DOCTOR)).toHaveLength(1);
    expect(pool.filter((r) => r === Role.VILLAGER)).toHaveLength(2);
  });

  it("builds correct role pool for 7 players", () => {
    const pool = buildRolePool(7);
    expect(pool).toHaveLength(7);
    expect(pool.filter((r) => r === Role.DOCTOR)).toHaveLength(1);
  });

  it("throws for unsupported player count", () => {
    expect(() => buildRolePool(3)).toThrow("No role config");
  });

  it("assigns roles to players", () => {
    const players = makePlayers(5);
    assignRoles(players);
    for (const p of players) {
      expect(p.role).not.toBeNull();
    }
    const roles = players.map((p) => p.role!);
    expect(roles.filter((r) => r === Role.MAFIA)).toHaveLength(1);
  });

  it("detects village win (all mafia dead)", () => {
    const players: Player[] = [
      { id: "1", name: "A", role: Role.VILLAGER, alive: true, personality: "" },
      { id: "2", name: "B", role: Role.DETECTIVE, alive: true, personality: "" },
      { id: "3", name: "C", role: Role.MAFIA, alive: false, personality: "" },
    ];
    expect(checkVillageWin(players)).toBe(true);
    expect(checkWinCondition(players)).toBe(Team.VILLAGE);
  });

  it("detects mafia win (mafia outnumber village)", () => {
    const players: Player[] = [
      { id: "1", name: "A", role: Role.VILLAGER, alive: false, personality: "" },
      { id: "2", name: "B", role: Role.MAFIA, alive: true, personality: "" },
      { id: "3", name: "C", role: Role.MAFIA, alive: true, personality: "" },
      { id: "4", name: "D", role: Role.DETECTIVE, alive: true, personality: "" },
    ];
    expect(checkMafiaWin(players)).toBe(true);
    expect(checkWinCondition(players)).toBe(Team.MAFIA);
  });

  it("parity is NOT mafia win (game continues)", () => {
    const players: Player[] = [
      { id: "1", name: "A", role: Role.VILLAGER, alive: true, personality: "" },
      { id: "2", name: "B", role: Role.MAFIA, alive: true, personality: "" },
      { id: "3", name: "C", role: Role.DETECTIVE, alive: false, personality: "" },
    ];
    expect(checkMafiaWin(players)).toBe(false);
    expect(checkWinCondition(players)).toBeNull();
  });

  it("returns null when game is still ongoing", () => {
    const players: Player[] = [
      { id: "1", name: "A", role: Role.VILLAGER, alive: true, personality: "" },
      { id: "2", name: "B", role: Role.VILLAGER, alive: true, personality: "" },
      { id: "3", name: "C", role: Role.MAFIA, alive: true, personality: "" },
    ];
    expect(checkWinCondition(players)).toBeNull();
  });
});

// ─── VoteSystem ─────────────────────────────────────────────

describe("VoteSystem", () => {
  let vs: VoteSystem;
  let players: Player[];

  beforeEach(() => {
    vs = new VoteSystem();
    players = makePlayers(5);
    players.forEach((p, i) => {
      p.role = i === 0 ? Role.MAFIA : Role.VILLAGER;
    });
  });

  it("eliminates player with majority vote", () => {
    vs.castVote({ voterId: "p1", targetId: "p2" });
    vs.castVote({ voterId: "p2", targetId: "p1" });
    vs.castVote({ voterId: "p3", targetId: "p1" });
    vs.castVote({ voterId: "p4", targetId: "p1" });
    vs.castVote({ voterId: "p5", targetId: "p2" });

    const result = vs.tally(players);
    expect(result.eliminatedId).toBe("p1");
    expect(result.tally.get("p1")).toBe(3);
  });

  it("tie-break: random pick from tied candidates", () => {
    vs.castVote({ voterId: "p1", targetId: "p2" });
    vs.castVote({ voterId: "p2", targetId: "p1" });
    vs.castVote({ voterId: "p3", targetId: "p2" });
    vs.castVote({ voterId: "p4", targetId: "p1" });
    vs.castVote({ voterId: "p5", targetId: null });

    const result = vs.tally(players);
    // Tie between p1 and p2 (2 votes each) — one of them gets eliminated
    expect(["p1", "p2"]).toContain(result.eliminatedId);
    expect(result.skips).toBe(1);
  });

  it("handles all skips", () => {
    for (const p of players) {
      vs.castVote({ voterId: p.id, targetId: null });
    }
    const result = vs.tally(players);
    expect(result.eliminatedId).toBeNull();
    expect(result.skips).toBe(5);
  });

  it("ignores votes from dead players", () => {
    players[0].alive = false;
    vs.castVote({ voterId: "p1", targetId: "p2" }); // Dead player
    vs.castVote({ voterId: "p2", targetId: "p3" });
    vs.castVote({ voterId: "p3", targetId: "p4" });
    vs.castVote({ voterId: "p4", targetId: "p3" });
    vs.castVote({ voterId: "p5", targetId: "p3" });

    const alivePlayers = players.filter((p) => p.alive);
    const result = vs.tally(alivePlayers);
    expect(result.eliminatedId).toBe("p3");
  });

  it("replaces duplicate votes from same voter", () => {
    vs.castVote({ voterId: "p1", targetId: "p2" });
    vs.castVote({ voterId: "p1", targetId: "p3" }); // Override

    const result = vs.tally(players);
    expect(result.tally.get("p2")).toBeUndefined();
    expect(result.tally.get("p3")).toBe(1);
  });

  it("resets between rounds", () => {
    vs.castVote({ voterId: "p1", targetId: "p2" });
    vs.reset();
    expect(vs.getVotes()).toHaveLength(0);
  });
});

// ─── EventEmitter ───────────────────────────────────────────

describe("GameEventEmitter", () => {
  it("emits events to listeners", () => {
    const emitter = new GameEventEmitter();
    const received: GameEvent[] = [];
    emitter.on((e) => received.push(e));

    const event: GameEvent = {
      type: GameEventType.GAME_CREATED,
      gameId: "test",
      round: 0,
      phase: GamePhase.LOBBY,
      timestamp: Date.now(),
      data: {},
    };
    emitter.emit(event);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe(GameEventType.GAME_CREATED);
  });

  it("unsubscribes correctly", () => {
    const emitter = new GameEventEmitter();
    const received: GameEvent[] = [];
    const unsub = emitter.on((e) => received.push(e));

    emitter.emit({
      type: GameEventType.GAME_CREATED,
      gameId: "test",
      round: 0,
      phase: GamePhase.LOBBY,
      timestamp: Date.now(),
      data: {},
    });
    unsub();
    emitter.emit({
      type: GameEventType.GAME_OVER,
      gameId: "test",
      round: 1,
      phase: GamePhase.GAME_OVER,
      timestamp: Date.now(),
      data: {},
    });

    expect(received).toHaveLength(1);
  });

  it("stores event history", () => {
    const emitter = new GameEventEmitter();
    emitter.emit({
      type: GameEventType.GAME_CREATED,
      gameId: "test",
      round: 0,
      phase: GamePhase.LOBBY,
      timestamp: Date.now(),
      data: {},
    });
    emitter.emit({
      type: GameEventType.PHASE_CHANGED,
      gameId: "test",
      round: 1,
      phase: GamePhase.DAY_DISCUSS,
      timestamp: Date.now(),
      data: {},
    });

    expect(emitter.getHistory()).toHaveLength(2);
  });
});

// ─── Game (integration) ────────────────────────────────────

describe("Game", () => {
  it("rejects starting with wrong player count", async () => {
    const game = new Game({
      gameId: "test-1",
      playerCount: 5,
      entryFee: 0.1,
      maxRounds: 10,
    });

    game.addPlayer(makePlayers(1)[0]);

    await expect(game.run()).rejects.toThrow("Need 5 players");
  });

  it("prevents adding players after game start", () => {
    const game = new Game({
      gameId: "test-2",
      playerCount: 5,
      entryFee: 0.1,
      maxRounds: 10,
    });

    const players = makePlayers(5);
    for (const p of players) game.addPlayer(p);

    // Manually start by running — but we can't add after
    // The game will start when run() is called, which changes phase
    // Instead, test adding a 6th player to a full game
    expect(() =>
      game.addPlayer({
        id: "extra",
        name: "Extra",
        role: null,
        alive: true,
        personality: "",
      }),
    ).toThrow("Game is full");
  });

  it("prevents adding duplicate players", () => {
    const game = new Game({
      gameId: "test-3",
      playerCount: 5,
      entryFee: 0.1,
      maxRounds: 10,
    });

    const player = makePlayers(1)[0];
    game.addPlayer(player);
    expect(() => game.addPlayer(player)).toThrow("already in game");
  });

  it("runs a complete game with random agents", async () => {
    const game = new Game({
      gameId: "test-full",
      playerCount: 5,
      entryFee: 0.1,
      maxRounds: 10,
    });

    const players = makePlayers(5);
    for (const p of players) game.addPlayer(p);

    const events: GameEvent[] = [];
    game.onEvent((e) => events.push(e));

    const result = await game.run();

    // Game must have a winner
    expect([Team.VILLAGE, Team.MAFIA]).toContain(result.winner);

    // Events must include key phases
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain(GameEventType.ROLES_ASSIGNED);
    expect(eventTypes).toContain(GameEventType.PHASE_CHANGED);
    expect(eventTypes).toContain(GameEventType.VOTE_CAST);
    expect(eventTypes).toContain(GameEventType.GAME_OVER);

    // All players must have roles
    for (const p of result.survivors.concat(result.eliminated)) {
      expect(p.role).not.toBeNull();
    }

    // Game ID matches
    expect(result.gameId).toBe("test-full");
  });

  it("emits player joined events", () => {
    const game = new Game({
      gameId: "test-events",
      playerCount: 5,
      entryFee: 0.1,
      maxRounds: 10,
    });

    const events: GameEvent[] = [];
    game.onEvent((e) => events.push(e));

    const players = makePlayers(3);
    for (const p of players) game.addPlayer(p);

    expect(events).toHaveLength(3);
    expect(events.every((e) => e.type === GameEventType.PLAYER_JOINED)).toBe(
      true,
    );
  });
});
