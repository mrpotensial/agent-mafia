import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { config } from "../config.js";
import { registerRoutes } from "./routes.js";
import { registerWebSocket } from "./websocket.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp(opts?: { logger?: boolean }) {
  const app = Fastify({
    logger: opts?.logger ?? false,
  });

  // Register WebSocket support
  await app.register(fastifyWebsocket);

  // Serve frontend static files
  await app.register(fastifyStatic, {
    root: join(__dirname, "../../frontend"),
    prefix: "/",
  });

  // Register routes
  await registerRoutes(app);
  await registerWebSocket(app);

  return app;
}

export async function startServer() {
  const app = await buildApp({ logger: true });

  try {
    await app.listen({ port: config.server.port, host: config.server.host });
    console.log(`
╔══════════════════════════════════════════════════╗
║           AGENT MAFIA - Game Server              ║
╠══════════════════════════════════════════════════╣
║  REST API:  http://localhost:${config.server.port}/api/games      ║
║  WebSocket: ws://localhost:${config.server.port}/ws/{gameId}      ║
║  Health:    http://localhost:${config.server.port}/health          ║
╚══════════════════════════════════════════════════╝
    `);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] ${signal} received, shutting down gracefully...`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return app;
}

// Run if executed directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("server.ts") ||
    process.argv[1].endsWith("server.js"));
if (isMain) {
  startServer();
}
