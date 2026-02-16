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

/** Helper to create a game and return gameId + masterToken. */
async function createGame(playerCount = 5) {
  const res = await app.inject({
    method: "POST",
    url: "/api/games",
    payload: { playerCount },
  });
  return res.json() as { gameId: string; masterToken: string };
}

/** Helper to join as external player. */
async function joinAsPlayer(gameId: string, name = "TestPlayer") {
  const res = await app.inject({
    method: "POST",
    url: `/api/games/${gameId}/join`,
    payload: { name },
  });
  return {
    status: res.statusCode,
    body: res.json() as {
      gameId: string;
      playerId: string;
      playerName: string;
      playerToken: string;
      error?: string;
    },
  };
}

// ─── Join as External Player ────────────────────────────────

describe("POST /api/games/:gameId/join", () => {
  it("joins a game as external player", async () => {
    const game = await createGame();
    const { status, body } = await joinAsPlayer(game.gameId, "ClawBot");

    expect(status).toBe(201);
    expect(body.playerId).toBe("p1");
    expect(body.playerName).toBe("ClawBot");
    expect(body.playerToken).toBeTruthy();
    expect(body.gameId).toBe(game.gameId);
  });

  it("multiple external players can join", async () => {
    const game = await createGame();
    const p1 = await joinAsPlayer(game.gameId, "Alpha");
    const p2 = await joinAsPlayer(game.gameId, "Beta");

    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);
    expect(p1.body.playerId).toBe("p1");
    expect(p2.body.playerId).toBe("p2");
    expect(p1.body.playerToken).not.toBe(p2.body.playerToken);
  });

  it("rejects join when game is full", async () => {
    const game = await createGame(5);
    // Fill all 5 slots
    for (let i = 0; i < 5; i++) {
      await joinAsPlayer(game.gameId, `Player${i}`);
    }
    const { status, body } = await joinAsPlayer(game.gameId, "Extra");
    expect(status).toBe(400);
    expect(body.error).toContain("full");
  });

  it("rejects join after game started", async () => {
    const game = await createGame(5);
    // Start with AI players
    await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/autofill`,
    });
    await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/start`,
      headers: { authorization: `Bearer ${game.masterToken}` },
    });

    const { status, body } = await joinAsPlayer(game.gameId, "Late");
    expect(status).toBe(400);
    expect(body.error).toContain("already started");
  });
});

// ─── Check My Turn ──────────────────────────────────────────

describe("GET /api/games/:gameId/my-turn", () => {
  it("returns 401 without token", async () => {
    const game = await createGame();
    const res = await app.inject({
      method: "GET",
      url: `/api/games/${game.gameId}/my-turn`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const game = await createGame();
    const res = await app.inject({
      method: "GET",
      url: `/api/games/${game.gameId}/my-turn`,
      headers: { authorization: "Bearer invalid-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns not your turn when game is in lobby", async () => {
    const game = await createGame();
    const { body: player } = await joinAsPlayer(game.gameId, "ClawBot");

    const res = await app.inject({
      method: "GET",
      url: `/api/games/${game.gameId}/my-turn`,
      headers: { authorization: `Bearer ${player.playerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isYourTurn).toBe(false);
    expect(body.gameStatus).toBe("lobby");
  });
});

// ─── Submit Action ──────────────────────────────────────────

describe("POST /api/games/:gameId/action", () => {
  it("returns 401 without token", async () => {
    const game = await createGame();
    const res = await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/action`,
      payload: { actionType: "statement", value: "hello" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when no pending action", async () => {
    const game = await createGame();
    const { body: player } = await joinAsPlayer(game.gameId, "ClawBot");

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/action`,
      headers: { authorization: `Bearer ${player.playerToken}` },
      payload: { actionType: "statement", value: "hello" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("not your turn");
  });
});

// ─── Full External Player Game Flow ─────────────────────────

describe("External player game flow", () => {
  it("external player completes a full game with short timeout", async () => {
    const game = await createGame(5);

    // Join as external player
    const { body: player } = await joinAsPlayer(game.gameId, "ClawBot");
    expect(player.playerToken).toBeTruthy();

    // Autofill remaining 4 slots with AI
    await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/autofill`,
      headers: { authorization: `Bearer ${game.masterToken}` },
    });

    // Start the game (returns 202 because has external players)
    const startRes = await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/start`,
      headers: { authorization: `Bearer ${game.masterToken}` },
    });
    expect(startRes.statusCode).toBe(202);
    const startBody = startRes.json();
    expect(startBody.status).toBe("running");
    expect(startBody.externalPlayers).toHaveLength(1);

    // The game is running in the background.
    // The external player has a 60s timeout, but for testing we just
    // let it timeout (which would take too long). Instead, we actively
    // poll and submit actions.

    // Poll and submit actions until game finishes (max 30 iterations)
    let gameFinished = false;
    for (let i = 0; i < 60; i++) {
      // Check game status
      const statusRes = await app.inject({
        method: "GET",
        url: `/api/games/${game.gameId}`,
      });
      const status = statusRes.json();
      if (status.status === "finished") {
        gameFinished = true;
        break;
      }

      // Check if it's our turn
      const turnRes = await app.inject({
        method: "GET",
        url: `/api/games/${game.gameId}/my-turn`,
        headers: { authorization: `Bearer ${player.playerToken}` },
      });
      const turn = turnRes.json();

      if (turn.isYourTurn) {
        const ctx = turn.actionRequired;
        let value: string;

        if (ctx.actionType === "statement") {
          value = "I think someone here is suspicious!";
        } else if (ctx.actionType === "vote") {
          // Vote for first alive player that isn't us
          const target = ctx.alivePlayers.find(
            (p: { id: string }) => p.id !== player.playerId,
          );
          value = target ? target.id : "skip";
        } else {
          // Night action: pick first valid target
          const target = ctx.alivePlayers.find(
            (p: { id: string }) => p.id !== player.playerId,
          );
          value = target!.id;
        }

        const actionRes = await app.inject({
          method: "POST",
          url: `/api/games/${game.gameId}/action`,
          headers: { authorization: `Bearer ${player.playerToken}` },
          payload: { actionType: ctx.actionType, value },
        });
        expect(actionRes.statusCode).toBe(200);
        expect(actionRes.json().accepted).toBe(true);
      } else {
        // Not our turn — wait a bit
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    expect(gameFinished).toBe(true);

    // Verify game result
    const resultRes = await app.inject({
      method: "GET",
      url: `/api/games/${game.gameId}`,
    });
    const result = resultRes.json();
    expect(result.status).toBe("finished");
    expect(result.result).toBeTruthy();
    expect(["village", "mafia"]).toContain(result.result.winner);
  }, 30_000); // 30s timeout for full game
});
