#!/usr/bin/env node
// Create a new AI Mafia game

const BASE = process.env.AGENT_MAFIA_URL || "http://127.0.0.1:3000";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, defaultVal) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : defaultVal;
  };
  return {
    playerCount: Number(get("--players", "5")),
    entryFee: Number(get("--entry-fee", "0.1")),
    maxRounds: Number(get("--max-rounds", "10")),
  };
}

async function main() {
  const opts = parseArgs();

  const res = await fetch(`${BASE}/api/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const game = await res.json();

  console.log("Game created!");
  console.log(`  Game ID:      ${game.gameId}`);
  console.log(`  Players:      ${game.playerCount}`);
  console.log(`  Entry Fee:    ${game.entryFee} MON`);
  console.log(`  Status:       ${game.status}`);
  console.log(`  Master Token: ${game.masterToken}`);
  console.log("");
  console.log("Use the master token to start the game:");
  console.log(`  node scripts/run-game.js is easier (handles everything).`);
  console.log(`  Or pass --master-token to other scripts.`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
