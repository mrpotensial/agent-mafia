#!/usr/bin/env node
// Join an AI Mafia game as an external player (OpenClaw agent or user)
// Returns a playerToken used to authenticate all future actions

const BASE = process.env.AGENT_MAFIA_URL || "http://127.0.0.1:3000";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, defaultVal) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : defaultVal;
  };
  const gameId = get("--game-id", null);
  if (!gameId) {
    console.error("Usage: node join-as-player.js --game-id <id> [--name OpenClaw]");
    process.exit(1);
  }
  return {
    gameId,
    name: get("--name", "OpenClaw"),
  };
}

async function main() {
  const { gameId, name } = parseArgs();

  const res = await fetch(`${BASE}/api/games/${gameId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`Error: ${err.error || res.statusText}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log("Joined game as player!");
  console.log(`  Game ID:      ${data.gameId}`);
  console.log(`  Player ID:    ${data.playerId}`);
  console.log(`  Name:         ${data.playerName}`);
  console.log(`  Player Token: ${data.playerToken}`);
  console.log("");
  console.log("Save your Player Token! Use it to check turns and submit actions.");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
