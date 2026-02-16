import { Game } from "../engine/game.js";
import { AgentManager } from "../agents/agent-adapter.js";
import { createAgent } from "../agents/factory.js";
import {
  PERSONALITIES,
  pickPersonalities,
} from "../agents/personalities.js";
import type { GameConfig, Player, GameEvent, GameResult } from "../types.js";
import { GameEventType } from "../types.js";
import { randomBytes } from "node:crypto";
import type { CreateGameInput } from "./schemas.js";
import { HybridAgentAdapter } from "./hybrid-adapter.js";
import { clearGamePendingActions } from "./pending-actions.js";

/** Maximum events stored per game to prevent unbounded memory growth. */
const MAX_EVENTS_PER_GAME = 2000;

/** Generate a short random token for master auth. */
function generateToken(): string {
  return randomBytes(16).toString("hex");
}

export interface OnChainData {
  gameAddress: string;
  createTxHash: string;
  finishTxHash?: string;
  commitTxHash?: string;
  revealTxHash?: string;
  /** Secret salt for commit-reveal role verification. */
  roleSalt?: string;
  /** Role commitments (hashes) stored on-chain. */
  roleCommitments?: string[];
  explorerBase: string;
}

export interface ExternalPlayer {
  playerId: string;
  playerToken: string;
  playerName: string;
}

export interface ManagedGame {
  game: Game;
  agentManager: AgentManager;
  config: GameConfig;
  useLLM: boolean;
  status: "lobby" | "running" | "finished";
  result: GameResult | null;
  events: GameEvent[];
  onChain: OnChainData | null;
  /** Session ID for continuous games (shared across next-game chain). */
  sessionId: string;
  /** Previous game ID in the chain (null for first game). */
  previousGameId: string | null;
  /** Match number within the session (1 for first game, 2 for next, etc.). */
  matchNumber: number;
  /** Secret token for room master (only master can start/control the game). */
  masterToken: string;
  /** Timestamp of last activity (for lobby cleanup). */
  lastActivity: number;
  /** External (OpenClaw/user) players who joined as active participants. */
  externalPlayers: ExternalPlayer[];
}

let gameCounter = 0;

/**
 * Manages all active game instances.
 * Handles creation, player joining, and game execution.
 */
export class GameStore {
  private games: Map<string, ManagedGame> = new Map();

  /** Create a new game and return its id. */
  create(input: CreateGameInput): ManagedGame {
    gameCounter++;
    const gameId = `game-${gameCounter}-${Date.now().toString(36)}`;

    const gameConfig: GameConfig = {
      gameId,
      playerCount: input.playerCount,
      entryFee: input.entryFee,
      maxRounds: input.maxRounds,
    };

    const game = new Game(gameConfig);
    const agentManager = new AgentManager();

    const managed: ManagedGame = {
      game,
      agentManager,
      config: gameConfig,
      useLLM: input.useLLM,
      status: "lobby",
      result: null,
      events: [],
      onChain: null,
      sessionId: gameId, // first game is its own session
      previousGameId: null,
      matchNumber: 1,
      masterToken: generateToken(),
      lastActivity: Date.now(),
      externalPlayers: [],
    };

    // Collect events (capped to prevent unbounded memory growth)
    game.onEvent((event) => {
      if (managed.events.length < MAX_EVENTS_PER_GAME) {
        managed.events.push(event);
      }
      try {
        agentManager.broadcastEvent(event);
      } catch (err) {
        console.error(`[GameStore] broadcastEvent error in ${gameId}:`, err);
      }
    });

    this.games.set(gameId, managed);
    return managed;
  }

  /** Get a game by id. */
  get(gameId: string): ManagedGame | undefined {
    return this.games.get(gameId);
  }

  /** List all games. */
  list(): ManagedGame[] {
    return Array.from(this.games.values());
  }

  /** Add an AI player to a game. */
  addPlayer(
    gameId: string,
    playerName: string,
    personalityKey?: string,
  ): Player {
    const managed = this.games.get(gameId);
    if (!managed) throw new Error(`Game ${gameId} not found`);
    if (managed.status !== "lobby") throw new Error("Game already started");

    const currentCount = managed.game.getPlayers().length;
    const playerId = `p${currentCount + 1}`;

    // Pick personality
    const key =
      personalityKey && PERSONALITIES[personalityKey]
        ? personalityKey
        : pickPersonalities(1)[0];
    const personality = PERSONALITIES[key];

    const player: Player = {
      id: playerId,
      name: playerName,
      role: null,
      alive: true,
      personality: key,
    };

    managed.game.addPlayer(player);

    // Create agent using configured provider
    const agent = createAgent(player, personality, managed.useLLM);
    managed.agentManager.register(agent);

    return player;
  }

  /** Auto-fill a game with AI players. */
  autoFill(gameId: string): Player[] {
    const managed = this.games.get(gameId);
    if (!managed) throw new Error(`Game ${gameId} not found`);

    const currentCount = managed.game.getPlayers().length;
    const needed = managed.config.playerCount - currentCount;
    if (needed <= 0) return [];

    const names = [
      "Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace",
    ];
    const personalities = pickPersonalities(needed);
    const added: Player[] = [];

    for (let i = 0; i < needed; i++) {
      const nameIndex = currentCount + i;
      const name = names[nameIndex] ?? `Agent-${nameIndex + 1}`;
      const player = this.addPlayer(gameId, name, personalities[i]);
      added.push(player);
    }

    return added;
  }

  /** Add an external (OpenClaw/user) player to a game. Does NOT create an AI agent. */
  addExternalPlayer(gameId: string, playerName: string): ExternalPlayer {
    const managed = this.games.get(gameId);
    if (!managed) throw new Error(`Game ${gameId} not found`);
    if (managed.status !== "lobby") throw new Error("Game already started");

    const currentCount = managed.game.getPlayers().length;
    if (currentCount >= managed.config.playerCount) {
      throw new Error("Game is full");
    }

    const playerId = `p${currentCount + 1}`;
    const playerToken = generateToken();

    const player: Player = {
      id: playerId,
      name: playerName,
      role: null,
      alive: true,
      personality: "external",
    };

    managed.game.addPlayer(player);
    // No agent created — HybridAgentAdapter handles external players via HTTP

    const external: ExternalPlayer = { playerId, playerToken, playerName };
    managed.externalPlayers.push(external);
    return external;
  }

  /** Look up an external player by their token. */
  getExternalPlayerByToken(
    gameId: string,
    playerToken: string,
  ): ExternalPlayer | undefined {
    const managed = this.games.get(gameId);
    if (!managed) return undefined;
    return managed.externalPlayers.find((ep) => ep.playerToken === playerToken);
  }

  /** Start a game. Returns the game result when finished. */
  async startGame(gameId: string): Promise<GameResult> {
    const managed = this.games.get(gameId);
    if (!managed) throw new Error(`Game ${gameId} not found`);
    if (managed.status !== "lobby") throw new Error("Game already started");

    // Auto-fill if needed (before status change so addPlayer still works)
    this.autoFill(gameId);

    // Set running AFTER autofill to prevent concurrent start race condition
    managed.status = "running";

    // Use HybridAgentAdapter when external players exist
    if (managed.externalPlayers.length > 0) {
      const externalIds = new Set(
        managed.externalPlayers.map((ep) => ep.playerId),
      );
      const hybrid = new HybridAgentAdapter(
        managed.agentManager,
        externalIds,
        gameId,
      );
      managed.game.setAgentAdapter(hybrid);
    } else {
      managed.game.setAgentAdapter(managed.agentManager);
    }

    try {
      const result = await managed.game.run();
      managed.status = "finished";
      managed.result = result;
      clearGamePendingActions(gameId);
      return result;
    } catch (error) {
      managed.status = "finished";
      clearGamePendingActions(gameId);
      throw error;
    }
  }

  /**
   * Create a new game reusing the same characters from a finished game.
   * Same names + personalities, new roles, fresh state.
   * Links to the same session for stats tracking.
   */
  createNextGame(previousGameId: string): ManagedGame {
    const prev = this.games.get(previousGameId);
    if (!prev) throw new Error(`Game ${previousGameId} not found`);
    if (prev.status !== "finished") throw new Error("Previous game must be finished");

    gameCounter++;
    const gameId = `game-${gameCounter}-${Date.now().toString(36)}`;

    const gameConfig: GameConfig = {
      gameId,
      playerCount: prev.config.playerCount,
      entryFee: prev.config.entryFee,
      maxRounds: prev.config.maxRounds,
    };

    const game = new Game(gameConfig);
    const agentManager = new AgentManager();

    const managed: ManagedGame = {
      game,
      agentManager,
      config: gameConfig,
      useLLM: prev.useLLM,
      status: "lobby",
      result: null,
      events: [],
      onChain: null,
      sessionId: prev.sessionId, // link to same session
      previousGameId,
      matchNumber: prev.matchNumber + 1,
      masterToken: prev.masterToken, // same master across session
      lastActivity: Date.now(),
      externalPlayers: [], // external players must re-join each game
    };

    // Collect events
    game.onEvent((event) => {
      if (managed.events.length < MAX_EVENTS_PER_GAME) {
        managed.events.push(event);
      }
      try {
        agentManager.broadcastEvent(event);
      } catch (err) {
        console.error(`[GameStore] broadcastEvent error in ${gameId}:`, err);
      }
    });

    // Register game first (addPlayer looks it up from the map)
    this.games.set(gameId, managed);

    // Re-add the same players with same names + personalities
    const prevPlayers = prev.game.getPlayers();
    for (const p of prevPlayers) {
      this.addPlayer(gameId, p.name, p.personality);
    }

    return managed;
  }

  /** Remove a game from memory (finished or stale lobby). */
  cleanup(gameId: string): boolean {
    const managed = this.games.get(gameId);
    if (!managed) return false;
    if (managed.status === "running") return false; // never clean running games
    this.games.delete(gameId);
    return true;
  }
}

/** Singleton game store. */
export const gameStore = new GameStore();
