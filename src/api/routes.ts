import type { FastifyInstance } from "fastify";
import { gameStore } from "./game-manager.js";
import type { OnChainData } from "./game-manager.js";
import {
  CreateGameSchema,
  GameIdParamSchema,
  AddPlayerSchema,
  PlaceWagerSchema,
} from "./schemas.js";
import { broadcastToGame } from "./websocket.js";
import { OffChainWagerSystem, WagerType } from "../blockchain/wagering.js";
import {
  createOnChainGame,
  finishOnChainGame,
  buildRoleCommitments,
  commitRolesOnChain,
  revealRolesOnChain,
} from "../blockchain/contracts.js";
import { config } from "../config.js";
import { Role, GamePhase, GameEventType } from "../types.js";
import type { GameEvent, GameResult } from "../types.js";
import { SpectatorManager } from "./spectator-manager.js";
import { StatsTracker } from "./stats-tracker.js";
import {
  getPendingAction,
  resolvePendingAction,
} from "./pending-actions.js";

/**
 * Redact sensitive events for spectators when external (human) players are in the game.
 * - roles_assigned → replace actual roles with "???"
 * - investigation_result → hide completely
 * - night_action → hide completely
 * Returns null if the event should be suppressed entirely.
 */
function redactForSpectators(event: GameEvent): GameEvent | null {
  switch (event.type) {
    case GameEventType.ROLES_ASSIGNED:
      return {
        ...event,
        data: {
          ...event.data,
          roles: (event.data.roles as { playerId: string; role: string }[]).map(
            (r) => ({ playerId: r.playerId, role: "???" }),
          ),
        },
      };
    case GameEventType.INVESTIGATION_RESULT:
    case GameEventType.NIGHT_ACTION:
      return null; // suppress entirely
    default:
      return event;
  }
}

const EXPLORER_BASE = config.blockchain.explorerUrl;
const wagerSystem = new OffChainWagerSystem();
const spectatorManager = new SpectatorManager();
const statsTracker = new StatsTracker();

/** Check if blockchain integration is available. */
function isBlockchainEnabled(): boolean {
  return !!(
    config.blockchain.factoryContractAddress &&
    config.blockchain.deployerPrivateKey &&
    config.blockchain.factoryContractAddress !== "0x..."
  );
}

/** Settle wagers after a game finishes, record stats, and broadcast results. */
function settleGameWagers(gameId: string, result: GameResult): void {
  const eliminatedIds = result.eliminated.map((p) => p.id);
  const mafiaIds = [
    ...result.survivors.filter((p) => p.role === Role.MAFIA).map((p) => p.id),
    ...result.eliminated.filter((p) => p.role === Role.MAFIA).map((p) => p.id),
  ];
  const settled = wagerSystem.settle(gameId, result.winner, eliminatedIds, mafiaIds);
  const totalPool = settled.reduce((s, w) => s + w.amount, 0);
  const fee = +(totalPool * OffChainWagerSystem.PLATFORM_FEE_PCT).toFixed(4);

  // Record character stats
  const managed = gameStore.get(gameId);
  if (managed) {
    const allPlayers = managed.game.getPlayers();
    const survivorIds = result.survivors.map((p) => p.id);
    statsTracker.recordGame(managed.sessionId, gameId, result.winner, allPlayers, survivorIds);
  }

  // Broadcast settlement results via WebSocket
  broadcastToGame(gameId, {
    type: GameEventType.GAME_OVER,
    gameId,
    round: result.rounds,
    phase: GamePhase.GAME_OVER,
    timestamp: Date.now(),
    data: {
      customType: "wagers_settled",
      results: settled.map((w) => ({
        bettor: w.bettor,
        type: w.wagerType,
        prediction: w.prediction,
        amount: w.amount,
        won: w.won,
        payout: w.payout,
      })),
      totalPool,
      platformFee: fee,
      winner: result.winner,
    },
  });
}

/** Place auto-spectator wagers and broadcast each. */
function placeAutoSpectatorWagers(gameId: string): void {
  const managed = gameStore.get(gameId);
  if (!managed) return;

  const players = managed.game.getPlayers();
  const formGuide = statsTracker.getFormGuide(players.map((p) => p.name));
  const wagers = spectatorManager.placeAutoWagers(
    gameId, players, wagerSystem, undefined, formGuide.length > 0 ? formGuide : undefined,
  );

  for (const w of wagers) {
    broadcastToGame(gameId, {
      type: GameEventType.GAME_CREATED,
      gameId,
      round: 0,
      phase: GamePhase.LOBBY,
      timestamp: Date.now(),
      data: {
        customType: "wager_placed",
        bettor: w.bettor,
        wagerType: w.wagerType,
        prediction: w.prediction,
        amount: w.amount,
        pool: wagerSystem.getPool(gameId),
      },
    });
  }

  console.log(`[Spectators] ${wagers.length} auto-wagers placed for ${gameId}`);
}

/** Record game result on-chain (non-blocking). */
async function recordOnChain(gameId: string, result: GameResult): Promise<void> {
  const managed = gameStore.get(gameId);
  if (!managed?.onChain) return;

  try {
    // Winner indices: indices of winning team survivors
    const allPlayers = managed.game.getPlayers();
    const winnerIndices = result.survivors
      .filter((p) => {
        if (result.winner === "village") return p.role !== Role.MAFIA;
        return p.role === Role.MAFIA;
      })
      .map((p) => allPlayers.findIndex((ap) => ap.id === p.id))
      .filter((i) => i >= 0);

    const txHash = await finishOnChainGame(
      managed.onChain.gameAddress,
      result.winner,
      winnerIndices,
    );
    managed.onChain.finishTxHash = txHash;
    console.log(`[OnChain] Game ${gameId} finished → tx ${txHash}`);

    // Commit-Reveal: reveal roles on-chain after game ends
    if (managed.onChain.roleSalt && managed.onChain.commitTxHash) {
      try {
        const allPlayers = managed.game.getPlayers();
        const roles = allPlayers.map((p) => p.role ?? "villager");
        const revealTxHash = await revealRolesOnChain(
          managed.onChain.gameAddress,
          roles,
          managed.onChain.roleSalt,
        );
        managed.onChain.revealTxHash = revealTxHash;
        console.log(`[CommitReveal] Roles revealed for ${gameId} → tx ${revealTxHash}`);
      } catch (revealErr) {
        console.error(`[CommitReveal] Failed to reveal roles:`, revealErr);
      }
    }
  } catch (err) {
    console.error(`[OnChain] Failed to finish game on-chain:`, err);
  }
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ─── Health ─────────────────────────────────────────────────

  app.get("/health", async () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  }));

  // ─── List Games ─────────────────────────────────────────────

  app.get("/api/games", async () => {
    const allGames = gameStore.list();
    // Only show the latest game per session (hide superseded games in next-game chains)
    const supersededIds = new Set(
      allGames.filter((g) => g.previousGameId).map((g) => g.previousGameId!),
    );
    const games = allGames.filter((g) => !supersededIds.has(g.config.gameId));
    return games.map((g) => ({
      gameId: g.config.gameId,
      playerCount: g.config.playerCount,
      currentPlayers: g.game.getPlayers().length,
      status: g.status,
      entryFee: g.config.entryFee,
      useLLM: g.useLLM,
      pool: wagerSystem.getPool(g.config.gameId),
      wagerCount: wagerSystem.getByGame(g.config.gameId).length,
      sessionId: g.sessionId,
      matchNumber: g.matchNumber,
      players: g.game.getPlayers().map((p) => ({ id: p.id, name: p.name, alive: p.alive })),
      onChain: g.onChain
        ? { gameAddress: g.onChain.gameAddress }
        : null,
    }));
  });

  // ─── Create Game ────────────────────────────────────────────

  app.post("/api/games", async (request, reply) => {
    const MAX_ACTIVE_GAMES = 10;

    // Per-masterToken limit: if caller already has an active game, reject
    const authHeader = request.headers.authorization;
    const callerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (callerToken) {
      const existingActive = gameStore.list().find(
        (g) => g.masterToken === callerToken && g.status !== "finished",
      );
      if (existingActive) {
        reply.code(429);
        return {
          error: "You already have an active game",
          existingGameId: existingActive.config.gameId,
        };
      }
    }

    const allGames = gameStore.list();
    const activeGames = allGames.filter((g) => g.status !== "finished");

    // Global safety cap: cleanup oldest idle lobbies to make room
    if (activeGames.length >= MAX_ACTIVE_GAMES) {
      const lobbies = allGames
        .filter((g) => g.status === "lobby")
        .sort((a, b) => a.lastActivity - b.lastActivity);
      for (const g of lobbies) {
        gameStore.cleanup(g.config.gameId);
        if (gameStore.list().filter((x) => x.status !== "finished").length < MAX_ACTIVE_GAMES) break;
      }
      // Still at capacity after cleanup?
      if (gameStore.list().filter((g) => g.status !== "finished").length >= MAX_ACTIVE_GAMES) {
        reply.code(429);
        return { error: "Too many active games. Wait for existing games to finish." };
      }
    }

    const input = CreateGameSchema.parse(request.body);
    const managed = gameStore.create(input);

    // Deploy on-chain game in background (non-blocking — game works without it)
    if (isBlockchainEnabled()) {
      const gameId = managed.config.gameId;
      createOnChainGame(managed.config.playerCount, String(managed.config.entryFee))
        .then((result) => {
          managed.onChain = {
            gameAddress: result.gameAddress,
            createTxHash: result.txHash,
            explorerBase: EXPLORER_BASE,
          };
          console.log(`[OnChain] Game ${gameId} → ${result.gameAddress}`);
        })
        .catch((err) => {
          console.error(`[OnChain] Failed to create game on-chain:`, err);
        });
    }

    reply.code(201);
    return {
      gameId: managed.config.gameId,
      masterToken: managed.masterToken,
      playerCount: managed.config.playerCount,
      entryFee: managed.config.entryFee,
      status: managed.status,
    };
  });

  // ─── Get Game ───────────────────────────────────────────────

  app.get("/api/games/:gameId", async (request, reply) => {
    const { gameId } = GameIdParamSchema.parse(request.params);
    const managed = gameStore.get(gameId);
    if (!managed) {
      reply.code(404);
      return { error: "Game not found" };
    }

    // Hide roles from public API when external players are in a running game
    const hideRoles =
      managed.externalPlayers.length > 0 && managed.status === "running";

    return {
      gameId: managed.config.gameId,
      sessionId: managed.sessionId,
      matchNumber: managed.matchNumber,
      status: managed.status,
      players: managed.game.getPlayers().map((p) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        personality: p.personality,
        role: hideRoles ? null : p.role,
      })),
      round: managed.game.round,
      phase: managed.game.phase,
      eventCount: managed.events.length,
      result: managed.result
        ? {
            winner: managed.result.winner,
            rounds: managed.result.rounds,
            survivors: managed.result.survivors.map((p) => ({
              id: p.id,
              name: p.name,
              role: p.role,
            })),
            eliminated: managed.result.eliminated.map((p) => ({
              id: p.id,
              name: p.name,
              role: p.role,
            })),
          }
        : null,
      onChain: managed.onChain
        ? {
            gameAddress: managed.onChain.gameAddress,
            createTxHash: managed.onChain.createTxHash,
            finishTxHash: managed.onChain.finishTxHash ?? null,
            commitTxHash: managed.onChain.commitTxHash ?? null,
            revealTxHash: managed.onChain.revealTxHash ?? null,
            rolesVerified: !!(managed.onChain.commitTxHash && managed.onChain.revealTxHash),
            explorerUrl: `${EXPLORER_BASE}/address/${managed.onChain.gameAddress}`,
          }
        : null,
    };
  });

  // ─── Add Player ─────────────────────────────────────────────

  app.post("/api/games/:gameId/players", async (request, reply) => {
    const { gameId } = GameIdParamSchema.parse(request.params);
    const body = AddPlayerSchema.parse(request.body ?? {});

    try {
      const player = gameStore.addPlayer(gameId, body.name, body.personality);
      reply.code(201);
      return player;
    } catch (error) {
      reply.code(400);
      return { error: (error as Error).message };
    }
  });

  // ─── Auto-fill Game ─────────────────────────────────────────

  app.post("/api/games/:gameId/autofill", async (request, reply) => {
    const { gameId } = GameIdParamSchema.parse(request.params);

    try {
      const added = gameStore.autoFill(gameId);
      return { added: added.length, players: added };
    } catch (error) {
      reply.code(400);
      return { error: (error as Error).message };
    }
  });

  // ─── Join as External Player ────────────────────────────────

  app.post("/api/games/:gameId/join", async (request, reply) => {
    const { gameId } = GameIdParamSchema.parse(request.params);
    const body = (request.body ?? {}) as { name?: string };
    const name = typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 32)
      : "OpenClaw";

    try {
      const external = gameStore.addExternalPlayer(gameId, name);

      // Broadcast player joined event
      broadcastToGame(gameId, {
        type: GameEventType.PLAYER_JOINED,
        gameId,
        round: 0,
        phase: GamePhase.LOBBY,
        timestamp: Date.now(),
        data: {
          playerId: external.playerId,
          playerName: external.playerName,
          isExternal: true,
        },
      });

      reply.code(201);
      return {
        gameId,
        playerId: external.playerId,
        playerName: external.playerName,
        playerToken: external.playerToken,
        message: "Joined as external player. Use playerToken to authenticate actions.",
      };
    } catch (error) {
      reply.code(400);
      return { error: (error as Error).message };
    }
  });

  // ─── Check My Turn (External Player) ──────────────────────

  app.get("/api/games/:gameId/my-turn", async (request, reply) => {
    const { gameId } = GameIdParamSchema.parse(request.params);
    const managed = gameStore.get(gameId);
    if (!managed) {
      reply.code(404);
      return { error: "Game not found" };
    }

    // Authenticate playerToken
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      reply.code(401);
      return { error: "Missing Authorization: Bearer <playerToken>" };
    }

    const external = gameStore.getExternalPlayerByToken(gameId, token);
    if (!external) {
      reply.code(401);
      return { error: "Invalid playerToken" };
    }

    const pending = getPendingAction(gameId, external.playerId);
    if (pending) {
      return {
        isYourTurn: true,
        actionRequired: pending.context,
      };
    }

    return {
      isYourTurn: false,
      gameStatus: managed.status,
      currentPhase: managed.game.phase,
      currentRound: managed.game.round,
    };
  });

  // ─── Submit Action (External Player) ──────────────────────

  app.post("/api/games/:gameId/action", async (request, reply) => {
    const { gameId } = GameIdParamSchema.parse(request.params);
    const managed = gameStore.get(gameId);
    if (!managed) {
      reply.code(404);
      return { error: "Game not found" };
    }

    // Authenticate playerToken
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      reply.code(401);
      return { error: "Missing Authorization: Bearer <playerToken>" };
    }

    const external = gameStore.getExternalPlayerByToken(gameId, token);
    if (!external) {
      reply.code(401);
      return { error: "Invalid playerToken" };
    }

    const body = (request.body ?? {}) as {
      actionType?: string;
      value?: string;
    };
    if (!body.actionType || body.value === undefined) {
      reply.code(400);
      return { error: "Missing actionType or value" };
    }

    // Check pending action exists
    const pending = getPendingAction(gameId, external.playerId);
    if (!pending) {
      reply.code(400);
      return { error: "No pending action — it's not your turn" };
    }

    // Validate actionType matches
    if (body.actionType !== pending.actionType) {
      reply.code(400);
      return {
        error: `Expected actionType "${pending.actionType}", got "${body.actionType}"`,
      };
    }

    // Validate target for vote/night_action
    let value: string | null = body.value;
    if (body.actionType === "vote") {
      if (value === "skip" || value === "null" || value === "") {
        value = null;
      } else {
        // Validate target is a valid alive player
        const valid = pending.context.alivePlayers.some(
          (p) => p.id === value && p.id !== external.playerId,
        );
        if (!valid) {
          reply.code(400);
          return { error: `Invalid vote target: ${value}` };
        }
      }
    } else if (body.actionType === "night_action") {
      const valid = pending.context.alivePlayers.some(
        (p) => p.id === value && p.id !== external.playerId,
      );
      if (!valid) {
        reply.code(400);
        return { error: `Invalid night action target: ${value}` };
      }
    }

    const resolved = resolvePendingAction(gameId, external.playerId, value);
    if (!resolved) {
      reply.code(400);
      return { error: "Action already submitted or timed out" };
    }

    return {
      accepted: true,
      actionType: body.actionType,
      message: "Action submitted successfully.",
    };
  });

  // ─── Start Game ─────────────────────────────────────────────

  app.post("/api/games/:gameId/start", async (request, reply) => {
    const { gameId } = GameIdParamSchema.parse(request.params);
    const managed = gameStore.get(gameId);
    if (!managed) {
      reply.code(404);
      return { error: "Game not found" };
    }

    // Validate master token
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (token && token !== managed.masterToken) {
      reply.code(403);
      return { error: "Only the room master can start the game" };
    }

    // Wire up WebSocket broadcasting (redact sensitive events when human players exist)
    const hasExternalPlayers = managed.externalPlayers.length > 0;
    managed.game.onEvent((event) => {
      if (hasExternalPlayers) {
        const safe = redactForSpectators(event);
        if (safe) broadcastToGame(gameId, safe);
      } else {
        broadcastToGame(gameId, event);
      }

      // Commit-Reveal: when roles are assigned, commit hashes on-chain (non-blocking)
      if (
        event.type === GameEventType.ROLES_ASSIGNED &&
        managed.onChain?.gameAddress &&
        isBlockchainEnabled()
      ) {
        const roles = (
          event.data.roles as { playerId: string; role: string }[]
        ).map((r) => r.role);
        const { salt, commitments } = buildRoleCommitments(roles);
        managed.onChain.roleSalt = salt;
        managed.onChain.roleCommitments = commitments;

        commitRolesOnChain(managed.onChain.gameAddress, commitments)
          .then((txHash) => {
            managed.onChain!.commitTxHash = txHash;
            console.log(`[CommitReveal] Roles committed for ${gameId} → tx ${txHash}`);
          })
          .catch((err) => {
            console.error(`[CommitReveal] Failed to commit roles:`, err);
          });
      }
    });

    try {
      // Place auto-spectator wagers before game starts
      placeAutoSpectatorWagers(gameId);

      // Start game in background and return immediately
      const resultPromise = gameStore.startGame(gameId);

      // For quick random games WITHOUT external players, await the result
      if (!managed.useLLM && !hasExternalPlayers) {
        const result = await resultPromise;
        settleGameWagers(gameId, result);
        // Record on-chain in background (don't block response)
        recordOnChain(gameId, result).catch(() => {});
        return {
          status: "finished",
          winner: result.winner,
          rounds: result.rounds,
          survivors: result.survivors.map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role,
          })),
          eliminated: result.eliminated.map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role,
          })),
          totalEvents: result.events.length,
          onChain: managed.onChain
            ? {
                gameAddress: managed.onChain.gameAddress,
                explorerUrl: `${EXPLORER_BASE}/address/${managed.onChain.gameAddress}`,
              }
            : null,
        };
      }

      // For LLM games or games with external players, start in background
      resultPromise
        .then((result) => {
          settleGameWagers(gameId, result);
          return recordOnChain(gameId, result);
        })
        .catch((err) => {
          console.error(`Game ${gameId} failed:`, err);
        });

      reply.code(202);
      return {
        status: "running",
        message: hasExternalPlayers
          ? "Game started with external players. Poll /my-turn for your actions."
          : "Game started. Connect to WebSocket for real-time updates.",
        websocket: `/ws/${gameId}`,
        externalPlayers: managed.externalPlayers.map((ep) => ({
          playerId: ep.playerId,
          playerName: ep.playerName,
        })),
      };
    } catch (error) {
      reply.code(400);
      return { error: (error as Error).message };
    }
  });

  // ─── Get Game Events ────────────────────────────────────────

  app.get("/api/games/:gameId/events", async (request, reply) => {
    const { gameId } = GameIdParamSchema.parse(request.params);
    const managed = gameStore.get(gameId);
    if (!managed) {
      reply.code(404);
      return { error: "Game not found" };
    }

    // Redact sensitive events when external players are in a running game
    const needsRedaction =
      managed.externalPlayers.length > 0 && managed.status === "running";
    const events = needsRedaction
      ? managed.events
          .map(redactForSpectators)
          .filter((e): e is GameEvent => e !== null)
      : managed.events;

    return {
      gameId,
      count: events.length,
      events,
    };
  });

  // ─── Place Wager ──────────────────────────────────────────

  app.post("/api/games/:gameId/wagers", async (request, reply) => {
    const { gameId } = GameIdParamSchema.parse(request.params);
    const managed = gameStore.get(gameId);
    if (!managed) {
      reply.code(404);
      return { error: "Game not found" };
    }

    // Only allow wagers during lobby phase (before game starts)
    if (managed.status !== "lobby") {
      reply.code(400);
      return { error: "Wagers only allowed before game starts (lobby phase)" };
    }

    const body = PlaceWagerSchema.parse(request.body ?? {});

    const wager = wagerSystem.place(
      gameId,
      body.bettor,
      WagerType.TeamBet,
      body.prediction,
      body.amount,
    );

    // Broadcast wager event via WebSocket
    broadcastToGame(gameId, {
      type: GameEventType.GAME_CREATED,
      gameId,
      round: 0,
      phase: GamePhase.LOBBY,
      timestamp: Date.now(),
      data: {
        customType: "wager_placed",
        bettor: wager.bettor,
        wagerType: wager.wagerType,
        prediction: wager.prediction,
        amount: wager.amount,
        pool: wagerSystem.getPool(gameId),
      },
    });

    reply.code(201);
    return wager;
  });

  // ─── Get Wagers ───────────────────────────────────────────

  app.get("/api/games/:gameId/wagers", async (request, reply) => {
    const { gameId } = GameIdParamSchema.parse(request.params);
    const wagers = wagerSystem.getByGame(gameId);
    return {
      gameId,
      count: wagers.length,
      pool: wagerSystem.getPool(gameId),
      wagers,
    };
  });

  // ─── Get Odds ───────────────────────────────────────────

  app.get("/api/games/:gameId/odds", async (request, reply) => {
    const { gameId } = GameIdParamSchema.parse(request.params);
    const wagers = wagerSystem.getByGame(gameId);
    const pool = wagerSystem.getPool(gameId);

    // Team bet breakdown (only bet type — wagers placed in lobby before roles assigned)
    const villagePool = wagers
      .filter((w) => w.prediction === "village")
      .reduce((s, w) => s + w.amount, 0);
    const mafiaPool = wagers
      .filter((w) => w.prediction === "mafia")
      .reduce((s, w) => s + w.amount, 0);
    const teamTotal = villagePool + mafiaPool;

    return {
      gameId,
      totalPool: +pool.toFixed(4),
      totalBets: wagers.length,
      team: {
        villagePool: +villagePool.toFixed(4),
        mafiaPool: +mafiaPool.toFixed(4),
        total: +teamTotal.toFixed(4),
        villageOdds: teamTotal > 0 && villagePool > 0
          ? +(teamTotal * 0.9 / villagePool).toFixed(2)
          : 0,
        mafiaOdds: teamTotal > 0 && mafiaPool > 0
          ? +(teamTotal * 0.9 / mafiaPool).toFixed(2)
          : 0,
      },
    };
  });

  // ─── Next Game (Continuous Mode) ───────────────────────────

  app.post("/api/games/:gameId/next-game", async (request, reply) => {
    const { gameId } = GameIdParamSchema.parse(request.params);

    // Validate master token
    const prev = gameStore.get(gameId);
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (prev && token && token !== prev.masterToken) {
      reply.code(403);
      return { error: "Only the room master can create next game" };
    }

    try {
      const managed = gameStore.createNextGame(gameId);

      reply.code(201);
      return {
        gameId: managed.config.gameId,
        sessionId: managed.sessionId,
        previousGameId: managed.previousGameId,
        matchNumber: managed.matchNumber,
        playerCount: managed.config.playerCount,
        players: managed.game.getPlayers().map((p) => ({
          id: p.id,
          name: p.name,
          personality: p.personality,
        })),
        status: managed.status,
      };
    } catch (error) {
      reply.code(400);
      return { error: (error as Error).message };
    }
  });

  // ─── Stats: Global Leaderboard ─────────────────────────────

  app.get("/api/stats/leaderboard", async () => {
    const leaderboard = statsTracker.getGlobalLeaderboard();
    return {
      count: leaderboard.length,
      leaderboard: leaderboard.map((s) => ({
        name: s.name,
        personality: s.personality,
        gamesPlayed: s.gamesPlayed,
        wins: s.wins,
        losses: s.losses,
        winRate: s.gamesPlayed > 0 ? +(s.wins / s.gamesPlayed).toFixed(3) : 0,
        survived: s.survived,
        eliminated: s.eliminated,
        survivalRate: s.gamesPlayed > 0 ? +(s.survived / s.gamesPlayed).toFixed(3) : 0,
        hotStreak: s.hotStreak,
        bestStreak: s.bestStreak,
        roles: {
          mafia: s.timesWasMafia,
          villager: s.timesWasVillage,
          detective: s.timesWasDetective,
          doctor: s.timesWasDoctor,
        },
      })),
    };
  });

  // ─── Stats: Session Leaderboard ────────────────────────────

  app.get("/api/stats/session/:sessionId", async (request, reply) => {
    const { sessionId } = (request.params as { sessionId: string });
    const session = statsTracker.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }

    const leaderboard = statsTracker.getSessionLeaderboard(sessionId);
    return {
      sessionId,
      gamesPlayed: session.gameIds.length,
      gameIds: session.gameIds,
      leaderboard: leaderboard.map((s) => ({
        name: s.name,
        personality: s.personality,
        gamesPlayed: s.gamesPlayed,
        wins: s.wins,
        losses: s.losses,
        winRate: s.gamesPlayed > 0 ? +(s.wins / s.gamesPlayed).toFixed(3) : 0,
        survived: s.survived,
        survivalRate: s.gamesPlayed > 0 ? +(s.survived / s.gamesPlayed).toFixed(3) : 0,
        hotStreak: s.hotStreak,
      })),
    };
  });

  // ─── Stats: Form Guide (for wager UI) ─────────────────────

  app.get("/api/stats/form-guide", async (request) => {
    const query = request.query as { gameId?: string };
    let playerNames: string[] = [];

    if (query.gameId) {
      const managed = gameStore.get(query.gameId);
      if (managed) {
        playerNames = managed.game.getPlayers().map((p) => p.name);
      }
    }

    const formGuide = statsTracker.getFormGuide(playerNames);
    return {
      count: formGuide.length,
      formGuide,
    };
  });
}
