import type { FastifyInstance } from "fastify";
import type { GameEvent } from "../types.js";
import { gameStore } from "./game-manager.js";

/** Minimal socket interface matching ws.WebSocket used by @fastify/websocket. */
interface WsSocket {
  readyState: number;
  send(data: string): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

interface WsClient {
  socket: WsSocket;
  gameId: string;
  isMaster: boolean;
}

const clients: WsClient[] = [];

/** Grace period before master transfer (ms). */
const MASTER_GRACE_MS = 15_000;
/** Interval for stale lobby cleanup (ms). */
const CLEANUP_INTERVAL_MS = 30_000;
/** Max idle time for lobby with no clients (ms). */
const LOBBY_IDLE_TIMEOUT_MS = 60_000;
/** Max idle time for finished games with no clients (ms). */
const FINISHED_IDLE_TIMEOUT_MS = 60_000;

/** Pending master transfers (gameId → timeout handle). */
const masterTransferTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Broadcast an event to all clients watching a specific game. */
export function broadcastToGame(gameId: string, event: GameEvent): void {
  for (const client of clients) {
    if (client.gameId === gameId && client.socket.readyState === 1) {
      client.socket.send(JSON.stringify(event));
    }
  }
}

/** Send a control message to a single client. */
function sendControl(socket: WsSocket, data: Record<string, unknown>): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(data));
  }
}

/** Try to promote the next client to master for a game. */
function promoteMaster(gameId: string): void {
  const gameClients = clients.filter(
    (c) => c.gameId === gameId && c.socket.readyState === 1,
  );
  if (gameClients.length === 0) return;

  // Generate a new master token for the promoted client
  const managed = gameStore.get(gameId);
  if (!managed) return;

  const newMaster = gameClients[0];
  newMaster.isMaster = true;

  // Send new master token to promoted client
  sendControl(newMaster.socket, {
    type: "master_promoted",
    masterToken: managed.masterToken,
    message: "You are now the room master.",
  });

  console.log(`[WS] Master promoted for game ${gameId}`);
}

/** Register WebSocket routes on a Fastify instance. */
export async function registerWebSocket(app: FastifyInstance): Promise<void> {
  app.get("/ws/:gameId", { websocket: true }, (socket, request) => {
    const { gameId } = request.params as { gameId: string };

    const client: WsClient = { socket: socket as unknown as WsSocket, gameId, isMaster: false };
    clients.push(client);

    // Update last activity
    const managed = gameStore.get(gameId);
    if (managed) {
      managed.lastActivity = Date.now();

      // Send current game state
      socket.send(
        JSON.stringify({
          type: "connection",
          gameId,
          status: managed.status,
          players: managed.game.getPlayers(),
          eventCount: managed.events.length,
        }),
      );

      // Replay all past events for this game
      for (const event of managed.events) {
        socket.send(JSON.stringify(event));
      }
    }

    // Cancel pending master transfer if someone reconnects
    if (masterTransferTimers.has(gameId)) {
      clearTimeout(masterTransferTimers.get(gameId)!);
      masterTransferTimers.delete(gameId);
    }

    const removeClient = () => {
      const idx = clients.indexOf(client);
      if (idx !== -1) clients.splice(idx, 1);

      // If master disconnected, start grace timer for transfer
      if (client.isMaster) {
        const remaining = clients.filter(
          (c) => c.gameId === gameId && c.socket.readyState === 1,
        );
        if (remaining.length > 0) {
          // Start grace period — if master doesn't reconnect, promote next
          const timer = setTimeout(() => {
            masterTransferTimers.delete(gameId);
            // Check if a master has re-authenticated
            const hasMaster = clients.some(
              (c) => c.gameId === gameId && c.isMaster && c.socket.readyState === 1,
            );
            if (!hasMaster) {
              promoteMaster(gameId);
            }
          }, MASTER_GRACE_MS);
          masterTransferTimers.set(gameId, timer);
        }
      }

      // Update last activity when someone leaves
      if (managed) managed.lastActivity = Date.now();
    };

    socket.on("message", (data: unknown) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
        } else if (msg.type === "auth" && msg.masterToken) {
          // Master authentication — verify token
          const game = gameStore.get(gameId);
          if (game && msg.masterToken === game.masterToken) {
            // Remove master flag from any other client for this game
            for (const c of clients) {
              if (c.gameId === gameId) c.isMaster = false;
            }
            client.isMaster = true;

            // Cancel pending transfer
            if (masterTransferTimers.has(gameId)) {
              clearTimeout(masterTransferTimers.get(gameId)!);
              masterTransferTimers.delete(gameId);
            }

            sendControl(socket, {
              type: "auth_ok",
              isMaster: true,
              message: "Authenticated as room master.",
            });
          } else {
            sendControl(socket, {
              type: "auth_ok",
              isMaster: false,
              message: "Joined as spectator.",
            });
          }
        }
      } catch {
        // Ignore invalid messages
      }
    });

    socket.on("close", removeClient);
    socket.on("error", (err: Error) => {
      console.error(`[WebSocket] Client error for game ${gameId}:`, err);
      removeClient();
    });
  });

  // ─── Stale Lobby Cleanup Timer ─────────────────────────────
  setInterval(() => {
    const now = Date.now();
    for (const game of gameStore.list()) {
      const gid = game.config.gameId;
      const clientCount = clients.filter(
        (c) => c.gameId === gid && c.socket.readyState === 1,
      ).length;

      if (clientCount > 0) {
        game.lastActivity = now; // still active
        continue;
      }

      const idle = now - game.lastActivity;

      if (game.status === "lobby" && idle > LOBBY_IDLE_TIMEOUT_MS) {
        console.log(`[Cleanup] Removing stale lobby: ${gid} (idle ${Math.round(idle / 1000)}s)`);
        gameStore.cleanup(gid);
      } else if (game.status === "finished" && idle > FINISHED_IDLE_TIMEOUT_MS) {
        console.log(`[Cleanup] Removing finished game: ${gid} (idle ${Math.round(idle / 1000)}s)`);
        gameStore.cleanup(gid);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

/** Get current WebSocket client count. */
export function getClientCount(): number {
  return clients.length;
}

/** Get client count for a specific game. */
export function getGameClientCount(gameId: string): number {
  return clients.filter((c) => c.gameId === gameId).length;
}
