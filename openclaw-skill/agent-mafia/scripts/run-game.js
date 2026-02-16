#!/usr/bin/env node
// Run a complete AI Mafia game: create + autofill + start (one-shot)

const BASE = process.env.AGENT_MAFIA_URL || "http://127.0.0.1:3000";

function parseArgs() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--players");
  return {
    playerCount: i !== -1 && args[i + 1] ? Number(args[i + 1]) : 5,
  };
}

async function post(path, body = {}, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${path}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const { playerCount } = parseArgs();

  // 1. Create game
  console.log(`Creating ${playerCount}-player game...`);
  const game = await post("/api/games", { playerCount });
  const gameId = game.gameId;
  const masterToken = game.masterToken;
  console.log(`  Game ID: ${gameId}`);

  // 2. Auto-fill AI players (use master token)
  console.log("Auto-filling AI players...");
  const fill = await post(`/api/games/${gameId}/autofill`, {}, masterToken);
  console.log(`  Added ${fill.added} players: ${fill.players.map((p) => p.name).join(", ")}`);

  // 3. Start game (use master token)
  console.log("Starting game...");
  const result = await post(`/api/games/${gameId}/start`, {}, masterToken);

  if (result.status === "finished") {
    console.log("");
    console.log(`GAME OVER — ${result.winner.toUpperCase()} WINS!`);
    console.log(`Rounds: ${result.rounds}`);
    console.log(`Survivors: ${result.survivors.map((p) => `${p.name}(${p.role})`).join(", ")}`);
    console.log(`Eliminated: ${result.eliminated.map((p) => `${p.name}(${p.role})`).join(", ")}`);
    console.log(`Total events: ${result.totalEvents}`);
    console.log("");
    console.log(`Game ID for review/wagers: ${gameId}`);

    if (result.onChain) {
      console.log(`On-chain: ${result.onChain.explorerUrl}`);
    }
  } else {
    // LLM game — running in background
    console.log("");
    console.log("Game is running in LLM mode (async). Watch it with:");
    console.log(`  node scripts/watch-game.js --game-id ${gameId}`);
    console.log("");
    console.log(`Game ID: ${gameId}`);
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
