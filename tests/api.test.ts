import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/api/server.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ─── Health ─────────────────────────────────────────────────

describe("Health", () => {
  it("returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});

// ─── Create Game ────────────────────────────────────────────

describe("POST /api/games", () => {
  it("creates a game with defaults", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.gameId).toBeTruthy();
    expect(body.playerCount).toBe(5);
    expect(body.status).toBe("lobby");
  });

  it("creates a game with custom settings", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { playerCount: 7, entryFee: 0.5, maxRounds: 5 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.playerCount).toBe(7);
    expect(body.entryFee).toBe(0.5);
  });
});

// ─── List Games ─────────────────────────────────────────────

describe("GET /api/games", () => {
  it("lists all games", async () => {
    const res = await app.inject({ method: "GET", url: "/api/games" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2); // From previous tests
  });
});

// ─── Get Game ───────────────────────────────────────────────

describe("GET /api/games/:gameId", () => {
  it("returns game details", async () => {
    // Create a game first
    const createRes = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: {},
    });
    const { gameId } = createRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gameId).toBe(gameId);
    expect(body.status).toBe("lobby");
    expect(body.players).toHaveLength(0);
  });

  it("returns 404 for unknown game", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/games/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Add Player ─────────────────────────────────────────────

describe("POST /api/games/:gameId/players", () => {
  it("adds a player to the game", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: {},
    });
    const { gameId } = createRes.json();

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/players`,
      payload: { name: "TestAgent", personality: "aggressive" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("TestAgent");
    expect(body.personality).toBe("aggressive");
    expect(body.id).toBe("p1");
  });
});

// ─── Autofill ───────────────────────────────────────────────

describe("POST /api/games/:gameId/autofill", () => {
  it("fills game with AI players", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { playerCount: 5 },
    });
    const { gameId } = createRes.json();

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/autofill`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(5);
    expect(body.players).toHaveLength(5);
  });
});

// ─── Start Game ─────────────────────────────────────────────

describe("POST /api/games/:gameId/start", () => {
  it("runs a complete game (random agents)", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { playerCount: 5 },
    });
    const { gameId } = createRes.json();

    // Auto-fill
    await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/autofill`,
    });

    // Start
    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/start`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("finished");
    expect(["village", "mafia"]).toContain(body.winner);
    expect(body.rounds).toBeGreaterThanOrEqual(1);
    expect(body.totalEvents).toBeGreaterThan(0);
  });

  it("auto-fills if not enough players and runs", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { playerCount: 5 },
    });
    const { gameId } = createRes.json();

    // Add only 2 players
    await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/players`,
      payload: { name: "Agent1" },
    });
    await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/players`,
      payload: { name: "Agent2" },
    });

    // Start — should auto-fill the remaining 3
    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/start`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("finished");
  });

  it("rejects starting already running game", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { playerCount: 5 },
    });
    const { gameId } = createRes.json();

    // Start once
    await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/start`,
    });

    // Start again
    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/start`,
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Get Events ─────────────────────────────────────────────

describe("GET /api/games/:gameId/events", () => {
  it("returns game events after game finishes", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { playerCount: 5 },
    });
    const { gameId } = createRes.json();

    await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/start`,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/events`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBeGreaterThan(0);
    expect(body.events.length).toBe(body.count);
  });
});
