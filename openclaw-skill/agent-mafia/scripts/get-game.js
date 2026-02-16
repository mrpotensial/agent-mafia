#!/usr/bin/env node
// Get the current state of an AI Mafia game

const BASE = process.env.AGENT_MAFIA_URL || "http://127.0.0.1:3000";

function getGameId() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--game-id");
  if (i === -1 || !args[i + 1]) {
    console.error("Usage: node get-game.js --game-id <gameId>");
    process.exit(1);
  }
  return args[i + 1];
}

async function main() {
  const gameId = getGameId();

  const res = await fetch(`${BASE}/api/games/${gameId}`);
  if (!res.ok) {
    if (res.status === 404) {
      console.error(`Game not found: ${gameId}`);
      process.exit(1);
    }
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const game = await res.json();

  console.log(`Game: ${game.gameId}`);
  console.log(`Status: ${game.status.toUpperCase()}`);
  console.log(`Phase: ${game.phase || "N/A"}  |  Round: ${game.round || 0}`);
  console.log(`Events: ${game.eventCount}`);
  console.log("");

  if (game.players.length > 0) {
    console.log(`Players (${game.players.length}):`);
    for (const p of game.players) {
      const alive = p.alive ? "ALIVE" : "DEAD";
      const role = p.role ? p.role.toUpperCase() : "???";
      console.log(`  ${p.id} ${p.name} (${p.personality}) — ${role} — ${alive}`);
    }
  } else {
    console.log("No players yet.");
  }

  if (game.result) {
    console.log("");
    console.log(`RESULT: ${game.result.winner.toUpperCase()} WINS in ${game.result.rounds} round(s)`);
    console.log(`Survivors: ${game.result.survivors.map((p) => `${p.name}(${p.role})`).join(", ")}`);
    console.log(`Eliminated: ${game.result.eliminated.map((p) => `${p.name}(${p.role})`).join(", ")}`);
  }

  if (game.onChain) {
    console.log("");
    console.log(`On-chain: ${game.onChain.explorerUrl}`);
    if (game.onChain.createTxHash) console.log(`  Create TX: ${game.onChain.createTxHash}`);
    if (game.onChain.finishTxHash) console.log(`  Finish TX: ${game.onChain.finishTxHash}`);
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
