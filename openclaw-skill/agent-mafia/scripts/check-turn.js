#!/usr/bin/env node
// Check if it's your turn in an AI Mafia game
// Returns action context (role, alive players, instructions) when it's your turn

const BASE = process.env.AGENT_MAFIA_URL || "http://127.0.0.1:3000";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, defaultVal) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : defaultVal;
  };
  const gameId = get("--game-id", null);
  const playerToken = get("--player-token", null);
  if (!gameId || !playerToken) {
    console.error(
      "Usage: node check-turn.js --game-id <id> --player-token <token>",
    );
    process.exit(1);
  }
  return { gameId, playerToken };
}

async function main() {
  const { gameId, playerToken } = parseArgs();

  const res = await fetch(`${BASE}/api/games/${gameId}/my-turn`, {
    headers: { Authorization: `Bearer ${playerToken}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`Error: ${err.error || res.statusText}`);
    process.exit(1);
  }

  const data = await res.json();

  if (data.isYourTurn) {
    const ctx = data.actionRequired;
    console.log("IT IS YOUR TURN!");
    console.log(`  Action:       ${ctx.actionType}`);
    console.log(`  Round:        ${ctx.round}`);
    console.log(`  Phase:        ${ctx.phase}`);
    console.log(`  Role:         ${ctx.role}`);
    console.log(`  Timeout:      ${ctx.timeoutMs / 1000}s`);
    console.log(`  Instructions: ${ctx.instructions}`);
    console.log("");
    console.log("Alive players:");
    for (const p of ctx.alivePlayers) {
      console.log(`  ${p.id}: ${p.name}${p.id === ctx.playerId ? " (you)" : ""}`);
    }
    console.log("");

    // Show recent events summary
    const events = ctx.recentEvents.slice(-10);
    if (events.length > 0) {
      console.log("Recent events:");
      for (const e of events) {
        const d = e.data;
        if (e.type === "statement_made") {
          console.log(`  [R${e.round}] ${d.playerName}: "${d.content}"`);
        } else if (e.type === "vote_cast") {
          console.log(`  [R${e.round}] ${d.voterName} voted for ${d.targetName || "skip"}`);
        } else if (e.type === "player_eliminated") {
          console.log(`  [R${e.round}] ${d.playerName} eliminated (${d.role})`);
        } else if (e.type === "player_killed") {
          console.log(`  [R${e.round}] ${d.playerName} killed by mafia (${d.role})`);
        } else {
          console.log(`  [R${e.round}] ${e.type}`);
        }
      }
    }
  } else {
    console.log("Not your turn yet.");
    console.log(`  Game Status: ${data.gameStatus}`);
    console.log(`  Phase:       ${data.currentPhase}`);
    console.log(`  Round:       ${data.currentRound}`);
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
