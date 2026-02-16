import { describe, it, expect, beforeEach } from "vitest";
import { RandomAgent } from "../src/agents/base-agent.js";
import { AgentManager } from "../src/agents/agent-adapter.js";
import { AgentMemory } from "../src/agents/memory.js";
import {
  PERSONALITIES,
  pickPersonalities,
} from "../src/agents/personalities.js";
import {
  buildSystemPrompt,
  buildDiscussionPrompt,
  buildVotePrompt,
  buildNightPrompt,
} from "../src/agents/prompts.js";
import {
  parseVoteResponse,
  parseTargetResponse,
  extractStructuredResponse,
  enforceWordLimit,
} from "../src/agents/parse-utils.js";
import { Game } from "../src/engine/game.js";
import {
  GamePhase,
  GameEventType,
  Role,
  Team,
} from "../src/types.js";
import type { Player, GameEvent } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────

function makePlayer(id: string, name: string, role: Role): Player {
  return { id, name, role, alive: true, personality: "analytical" };
}

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    role: null,
    alive: true,
    personality: "analytical",
  }));
}

// ─── Personalities ──────────────────────────────────────────

describe("Personalities", () => {
  it("has 10 personality types", () => {
    expect(Object.keys(PERSONALITIES)).toHaveLength(10);
  });

  it("each personality has required fields", () => {
    for (const [key, p] of Object.entries(PERSONALITIES)) {
      expect(p.name).toBeTruthy();
      expect(p.traits).toBeTruthy();
      expect(p.speechStyle).toBeTruthy();
      expect(p.asMafia).toBeTruthy();
      expect(p.asVillage).toBeTruthy();
      expect(p.aggression).toBeGreaterThanOrEqual(0);
      expect(p.aggression).toBeLessThanOrEqual(1);
      expect(p.trustLevel).toBeGreaterThanOrEqual(0);
      expect(p.trustLevel).toBeLessThanOrEqual(1);
    }
  });

  it("pickPersonalities returns unique selections", () => {
    const picked = pickPersonalities(5);
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
    for (const key of picked) {
      expect(PERSONALITIES[key]).toBeDefined();
    }
  });

  it("pickPersonalities throws for too many", () => {
    expect(() => pickPersonalities(11)).toThrow();
  });
});

// ─── Prompts ────────────────────────────────────────────────

describe("Prompts", () => {
  const player = makePlayer("p1", "Alice", Role.MAFIA);
  const personality = PERSONALITIES.manipulative;
  const memory = new AgentMemory("p1");

  it("builds system prompt with role and personality", () => {
    const prompt = buildSystemPrompt(player, personality);
    expect(prompt).toContain("Alice");
    expect(prompt).toContain("Manipulative");
    expect(prompt).toContain("MAFIA");
    expect(prompt).toContain("LIE");
  });

  it("builds discussion prompt with alive players", () => {
    const players = [
      player,
      makePlayer("p2", "Bob", Role.VILLAGER),
      makePlayer("p3", "Carol", Role.DETECTIVE),
    ];
    const prompt = buildDiscussionPrompt(player, players, 1, memory);
    expect(prompt).toContain("ROUND 1");
    expect(prompt).toContain("Bob");
    expect(prompt).toContain("Carol");
  });

  it("builds vote prompt with candidates", () => {
    const alivePlayers = [
      player,
      makePlayer("p2", "Bob", Role.VILLAGER),
      makePlayer("p3", "Carol", Role.DETECTIVE),
    ];
    const prompt = buildVotePrompt(player, alivePlayers, 1, memory);
    expect(prompt).toContain("Bob");
    expect(prompt).toContain("Carol");
    expect(prompt).not.toContain("- Alice\n"); // Self not listed as candidate
    expect(prompt).toContain("VOTE:"); // Chain-of-thought format
  });

  it("builds night prompt for mafia", () => {
    const alivePlayers = [
      player,
      makePlayer("p2", "Bob", Role.VILLAGER),
    ];
    const prompt = buildNightPrompt(player, alivePlayers, 1, memory);
    expect(prompt).toContain("ELIMINATE");
  });

  it("builds night prompt for detective", () => {
    const detective = makePlayer("p3", "Carol", Role.DETECTIVE);
    const alivePlayers = [
      detective,
      makePlayer("p1", "Alice", Role.MAFIA),
    ];
    const prompt = buildNightPrompt(detective, alivePlayers, 1, memory);
    expect(prompt).toContain("INVESTIGATE");
  });

  it("builds night prompt for doctor", () => {
    const doctor = makePlayer("p4", "Dave", Role.DOCTOR);
    const alivePlayers = [
      doctor,
      makePlayer("p1", "Alice", Role.MAFIA),
    ];
    const prompt = buildNightPrompt(doctor, alivePlayers, 1, memory);
    expect(prompt).toContain("PROTECT");
  });
});

// ─── AgentMemory ────────────────────────────────────────────

describe("AgentMemory", () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = new AgentMemory("p1");
  });

  it("records statements", () => {
    memory.record({
      type: GameEventType.STATEMENT_MADE,
      gameId: "g1",
      round: 1,
      phase: GamePhase.DAY_DISCUSS,
      timestamp: Date.now(),
      data: { playerId: "p2", content: "I think p3 is suspicious" },
    });
    expect(memory.getEntries()).toHaveLength(1);
    expect(memory.getRecentSummary()).toContain("p2");
  });

  it("records votes", () => {
    memory.record({
      type: GameEventType.VOTE_CAST,
      gameId: "g1",
      round: 1,
      phase: GamePhase.DAY_VOTE,
      timestamp: Date.now(),
      data: { voterId: "p2", targetId: "p3" },
    });
    expect(memory.getRecentSummary()).toContain("voted for p3");
  });

  it("records eliminations", () => {
    memory.record({
      type: GameEventType.PLAYER_ELIMINATED,
      gameId: "g1",
      round: 1,
      phase: GamePhase.ELIMINATION,
      timestamp: Date.now(),
      data: {
        playerId: "p3",
        name: "Carol",
        role: "villager",
        reason: "voted_out",
      },
    });
    expect(memory.getRecentSummary()).toContain("voted out");
    expect(memory.getRecentSummary()).toContain("villager");
  });

  it("records investigation results", () => {
    memory.record({
      type: GameEventType.INVESTIGATION_RESULT,
      gameId: "g1",
      round: 1,
      phase: GamePhase.NIGHT,
      timestamp: Date.now(),
      data: { targetId: "p2", isMafia: true },
    });
    expect(memory.getKnowledge()).toContain("IS MAFIA");
    expect(memory.getSuspicions().get("p2")).toBe(1.0);
  });

  it("tracks suspicion levels", () => {
    memory.adjustSuspicion("p2", 0.3);
    expect(memory.getSuspicions().get("p2")).toBeCloseTo(0.8); // 0.5 + 0.3
    memory.adjustSuspicion("p2", -0.5);
    expect(memory.getSuspicions().get("p2")).toBeCloseTo(0.3);
  });

  it("clamps suspicion between 0 and 1", () => {
    memory.adjustSuspicion("p2", 2.0);
    expect(memory.getSuspicions().get("p2")).toBe(1.0);
    memory.adjustSuspicion("p2", -5.0);
    expect(memory.getSuspicions().get("p2")).toBe(0.0);
  });

  it("returns empty string when no knowledge", () => {
    expect(memory.getKnowledge()).toBe("");
  });

  it("returns empty string when no entries", () => {
    expect(memory.getRecentSummary()).toBe("");
  });
});

// ─── RandomAgent ────────────────────────────────────────────

describe("RandomAgent", () => {
  const personality = PERSONALITIES.aggressive;

  it("generates a statement", async () => {
    const player = makePlayer("p1", "Alice", Role.VILLAGER);
    const agent = new RandomAgent(player, personality);
    const players = [
      player,
      makePlayer("p2", "Bob", Role.MAFIA),
      makePlayer("p3", "Carol", Role.DETECTIVE),
    ];
    const statement = await agent.makeStatement(players, 1, []);
    expect(statement).toBeTruthy();
    expect(typeof statement).toBe("string");
  });

  it("casts a vote", async () => {
    const player = makePlayer("p1", "Alice", Role.VILLAGER);
    const agent = new RandomAgent(player, personality);
    const alivePlayers = [
      player,
      makePlayer("p2", "Bob", Role.MAFIA),
    ];

    // Run multiple times — should either return a player id or null
    for (let i = 0; i < 10; i++) {
      const vote = await agent.castVote(alivePlayers, 1, []);
      if (vote !== null) {
        expect(vote).toBe("p2"); // Only possible target
      }
    }
  });

  it("performs night action", async () => {
    const player = makePlayer("p1", "Alice", Role.MAFIA);
    const agent = new RandomAgent(player, personality);
    const alivePlayers = [
      player,
      makePlayer("p2", "Bob", Role.VILLAGER),
      makePlayer("p3", "Carol", Role.DETECTIVE),
    ];
    const target = await agent.nightAction(alivePlayers, 1, []);
    expect(["p2", "p3"]).toContain(target);
  });
});

// ─── AgentManager ───────────────────────────────────────────

describe("AgentManager", () => {
  it("registers and retrieves agents", () => {
    const manager = new AgentManager();
    const player = makePlayer("p1", "Alice", Role.VILLAGER);
    const agent = new RandomAgent(player, PERSONALITIES.analytical);
    manager.register(agent);
    expect(manager.get("p1")).toBe(agent);
  });

  it("broadcasts events to all agents", () => {
    const manager = new AgentManager();
    const p1 = makePlayer("p1", "Alice", Role.VILLAGER);
    const p2 = makePlayer("p2", "Bob", Role.MAFIA);
    const a1 = new RandomAgent(p1, PERSONALITIES.analytical);
    const a2 = new RandomAgent(p2, PERSONALITIES.aggressive);
    manager.register(a1);
    manager.register(a2);

    const event: GameEvent = {
      type: GameEventType.STATEMENT_MADE,
      gameId: "g1",
      round: 1,
      phase: GamePhase.DAY_DISCUSS,
      timestamp: Date.now(),
      data: { playerId: "p1", content: "Test statement" },
    };
    manager.broadcastEvent(event);

    expect(a1.memory.getEntries()).toHaveLength(1);
    expect(a2.memory.getEntries()).toHaveLength(1);
  });
});

// ─── Parse Utils ───────────────────────────────────────────

describe("parseVoteResponse", () => {
  const alivePlayers: Player[] = [
    makePlayer("p1", "Alice", Role.VILLAGER),
    makePlayer("p2", "Bob", Role.MAFIA),
    makePlayer("p3", "Carol", Role.DETECTIVE),
  ];

  it("parses structured VOTE format", () => {
    const response = "REASONING: Bob has been suspicious.\nVOTE: Bob";
    expect(parseVoteResponse(response, alivePlayers, "p1")).toBe("p2");
  });

  it("parses plain name", () => {
    expect(parseVoteResponse("Bob", alivePlayers, "p1")).toBe("p2");
  });

  it("parses skip", () => {
    expect(parseVoteResponse("skip", alivePlayers, "p1")).toBeNull();
    expect(parseVoteResponse("VOTE: skip", alivePlayers, "p1")).toBeNull();
  });

  it("handles case-insensitive names", () => {
    expect(parseVoteResponse("BOB", alivePlayers, "p1")).toBe("p2");
    expect(parseVoteResponse("carol", alivePlayers, "p1")).toBe("p3");
  });

  it("handles quoted names", () => {
    expect(parseVoteResponse('VOTE: "Bob"', alivePlayers, "p1")).toBe("p2");
  });

  it("handles name in longer text", () => {
    expect(parseVoteResponse("I vote for Bob because he is suspicious", alivePlayers, "p1")).toBe("p2");
  });

  it("never votes for self", () => {
    const result = parseVoteResponse("Alice", alivePlayers, "p1");
    expect(result).not.toBe("p1");
  });

  it("falls back to random on gibberish", () => {
    const result = parseVoteResponse("xyzzy999", alivePlayers, "p1");
    expect(["p2", "p3"]).toContain(result);
  });
});

describe("parseTargetResponse", () => {
  const alivePlayers: Player[] = [
    makePlayer("p1", "Alice", Role.MAFIA),
    makePlayer("p2", "Bob", Role.VILLAGER),
    makePlayer("p3", "Carol", Role.DETECTIVE),
  ];

  it("parses structured TARGET format", () => {
    const response = "REASONING: Carol seems like the Detective.\nTARGET: Carol";
    expect(parseTargetResponse(response, alivePlayers, "p1")).toBe("p3");
  });

  it("parses plain name", () => {
    expect(parseTargetResponse("Bob", alivePlayers, "p1")).toBe("p2");
  });
});

describe("extractStructuredResponse", () => {
  it("extracts REASONING and VOTE", () => {
    const response = "REASONING: Bob is suspicious.\nVOTE: Bob";
    const result = extractStructuredResponse(response, "VOTE");
    expect(result.reasoning).toBe("Bob is suspicious.");
    expect(result.value).toBe("Bob");
  });

  it("extracts REASONING and TARGET", () => {
    const response = "REASONING: Carol leads the investigation.\nTARGET: Carol";
    const result = extractStructuredResponse(response, "TARGET");
    expect(result.reasoning).toBe("Carol leads the investigation.");
    expect(result.value).toBe("Carol");
  });

  it("returns empty strings when tags not found", () => {
    const result = extractStructuredResponse("Just a plain text", "VOTE");
    expect(result.reasoning).toBe("");
    expect(result.value).toBe("");
  });
});

describe("enforceWordLimit", () => {
  it("returns short text unchanged", () => {
    expect(enforceWordLimit("Hello world")).toBe("Hello world");
  });

  it("truncates long text", () => {
    const longText = Array(300).fill("word").join(" ");
    const result = enforceWordLimit(longText);
    expect(result.split(/\s+/).length).toBeLessThanOrEqual(201); // 200 + "..."
  });
});

// ─── Memory Expansion ──────────────────────────────────────

describe("AgentMemory expansion", () => {
  it("getRecentSummary returns ALL rounds, not just last 2", () => {
    const memory = new AgentMemory("p1");
    // Record events across 4 rounds
    for (let round = 1; round <= 4; round++) {
      memory.record({
        type: GameEventType.STATEMENT_MADE,
        gameId: "g1",
        round,
        phase: GamePhase.DAY_DISCUSS,
        timestamp: Date.now(),
        data: { playerId: "p2", content: `Statement in round ${round}` },
      });
    }
    const summary = memory.getRecentSummary();
    expect(summary).toContain("Round 1");
    expect(summary).toContain("Round 2");
    expect(summary).toContain("Round 3");
    expect(summary).toContain("Round 4");
  });

  it("getVotingHistory tracks votes across rounds", () => {
    const memory = new AgentMemory("p1");
    memory.setNameMap([
      { id: "p1", name: "Alice" },
      { id: "p2", name: "Bob" },
      { id: "p3", name: "Carol" },
    ]);
    memory.record({
      type: GameEventType.VOTE_CAST,
      gameId: "g1", round: 1, phase: GamePhase.DAY_VOTE, timestamp: Date.now(),
      data: { voterId: "p2", targetId: "p3" },
    });
    memory.record({
      type: GameEventType.VOTE_CAST,
      gameId: "g1", round: 2, phase: GamePhase.DAY_VOTE, timestamp: Date.now(),
      data: { voterId: "p2", targetId: "p1" },
    });
    const history = memory.getVotingHistory();
    expect(history).toContain("Round 1");
    expect(history).toContain("Round 2");
    expect(history).toContain("Bob");
  });

  it("getSuspicionSummary formats suspicion levels", () => {
    const memory = new AgentMemory("p1");
    memory.setNameMap([
      { id: "p2", name: "Bob" },
      { id: "p3", name: "Carol" },
    ]);
    // Simulate detective investigation
    memory.record({
      type: GameEventType.INVESTIGATION_RESULT,
      gameId: "g1", round: 1, phase: GamePhase.NIGHT, timestamp: Date.now(),
      data: { targetId: "p2", isMafia: true },
    });
    memory.record({
      type: GameEventType.INVESTIGATION_RESULT,
      gameId: "g1", round: 2, phase: GamePhase.NIGHT, timestamp: Date.now(),
      data: { targetId: "p3", isMafia: false },
    });
    const summary = memory.getSuspicionSummary();
    expect(summary).toContain("Bob: CONFIRMED MAFIA");
    expect(summary).toContain("Carol: confirmed innocent");
  });

  it("getSuspicionSummary returns empty when no suspicions", () => {
    const memory = new AgentMemory("p1");
    expect(memory.getSuspicionSummary()).toBe("");
  });

  it("getVotingHistory returns empty when no votes", () => {
    const memory = new AgentMemory("p1");
    expect(memory.getVotingHistory()).toBe("");
  });

  it("truncates statements at 250 chars, not 100", () => {
    const memory = new AgentMemory("p1");
    const longStatement = "A".repeat(300);
    memory.record({
      type: GameEventType.STATEMENT_MADE,
      gameId: "g1", round: 1, phase: GamePhase.DAY_DISCUSS, timestamp: Date.now(),
      data: { playerId: "p2", content: longStatement },
    });
    const summary = memory.getRecentSummary();
    // Should contain more than 100 chars of the statement
    expect(summary.length).toBeGreaterThan(150);
    // Should end with ... (truncated)
    expect(summary).toContain("...");
  });
});

// ─── Personality-Driven Prompts ─────────────────────────────

describe("Personality-driven prompts", () => {
  it("includes aggression and trust levels in system prompt", () => {
    const player = makePlayer("p1", "Alice", Role.MAFIA);
    const personality = PERSONALITIES.aggressive;
    const prompt = buildSystemPrompt(player, personality);
    expect(prompt).toContain("Aggression: 0.9");
    expect(prompt).toContain("Trust: 0.3");
  });

  it("includes behavioral tendencies for high aggression", () => {
    const player = makePlayer("p1", "Alice", Role.VILLAGER);
    const prompt = buildSystemPrompt(player, PERSONALITIES.aggressive);
    expect(prompt).toContain("accuse early");
  });

  it("includes behavioral tendencies for low aggression", () => {
    const player = makePlayer("p1", "Alice", Role.VILLAGER);
    const prompt = buildSystemPrompt(player, PERSONALITIES.quiet_observer);
    expect(prompt).toContain("observe carefully");
  });

  it("includes voting pattern tracking instruction", () => {
    const player = makePlayer("p1", "Alice", Role.VILLAGER);
    const prompt = buildSystemPrompt(player, PERSONALITIES.analytical);
    expect(prompt).toContain("voting patterns");
  });

  it("discussion prompt includes voting history when available", () => {
    const player = makePlayer("p1", "Alice", Role.VILLAGER);
    const players = [player, makePlayer("p2", "Bob", Role.MAFIA)];
    const memory = new AgentMemory("p1");
    memory.setNameMap(players);
    memory.record({
      type: GameEventType.VOTE_CAST,
      gameId: "g1", round: 1, phase: GamePhase.DAY_VOTE, timestamp: Date.now(),
      data: { voterId: "p2", targetId: "p1" },
    });
    const prompt = buildDiscussionPrompt(player, players, 2, memory);
    expect(prompt).toContain("VOTING PATTERNS");
  });
});

// ─── New Personalities ──────────────────────────────────────

describe("New personalities", () => {
  it("strategist exists with correct stats", () => {
    expect(PERSONALITIES.strategist).toBeDefined();
    expect(PERSONALITIES.strategist.name).toBe("Strategist");
    expect(PERSONALITIES.strategist.aggression).toBe(0.5);
  });

  it("jester exists with correct stats", () => {
    expect(PERSONALITIES.jester).toBeDefined();
    expect(PERSONALITIES.jester.name).toBe("Jester");
  });

  it("loyal exists with correct stats", () => {
    expect(PERSONALITIES.loyal).toBeDefined();
    expect(PERSONALITIES.loyal.name).toBe("Loyal");
    expect(PERSONALITIES.loyal.trustLevel).toBe(0.9);
  });

  it("can pick up to 10 personalities for larger games", () => {
    const picked = pickPersonalities(10);
    expect(picked).toHaveLength(10);
    expect(new Set(picked).size).toBe(10);
  });
});

// ─── Full Game with RandomAgents ────────────────────────────

describe("Game with RandomAgents", () => {
  it("runs a complete game with agent adapter", async () => {
    const game = new Game({
      gameId: "agent-test",
      playerCount: 5,
      entryFee: 0.1,
      maxRounds: 10,
    });

    const players = makePlayers(5);
    const personalityKeys = pickPersonalities(5);
    const manager = new AgentManager();

    for (let i = 0; i < players.length; i++) {
      game.addPlayer(players[i]);
      const personality = PERSONALITIES[personalityKeys[i]];
      const agent = new RandomAgent(players[i], personality);
      manager.register(agent);
    }

    // Wire up event broadcasting
    game.onEvent((event) => manager.broadcastEvent(event));
    game.setAgentAdapter(manager);

    const result = await game.run();

    expect([Team.VILLAGE, Team.MAFIA]).toContain(result.winner);
    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(result.events.length).toBeGreaterThan(0);
  });
});
