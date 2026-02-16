#!/usr/bin/env node
// Get the final results of a completed AI Mafia game

const BASE = process.env.AGENT_MAFIA_URL || "http://127.0.0.1:3000";

function getGameId() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--game-id");
  if (i === -1 || !args[i + 1]) {
    console.error("Usage: node get-results.js --game-id <gameId>");
    process.exit(1);
  }
  return args[i + 1];
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error("Game not found");
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const gameId = getGameId();

  // Fetch game state, events, and wagers in parallel
  const [game, eventsData, wagersData] = await Promise.all([
    fetchJson(`${BASE}/api/games/${gameId}`),
    fetchJson(`${BASE}/api/games/${gameId}/events`),
    fetchJson(`${BASE}/api/games/${gameId}/wagers`),
  ]);

  if (game.status !== "finished" || !game.result) {
    console.log(`Game ${gameId} is not finished yet.`);
    console.log(`Status: ${game.status.toUpperCase()}`);
    console.log(`Phase: ${game.phase || "N/A"}  |  Round: ${game.round || 0}`);
    return;
  }

  const r = game.result;
  const events = eventsData.events;

  console.log(`=== GAME RESULTS: ${gameId} ===`);
  console.log("");
  console.log(`Winner: ${r.winner.toUpperCase()}`);
  console.log(`Rounds: ${r.rounds}`);

  console.log("");
  console.log("Survivors:");
  for (const p of r.survivors) {
    console.log(`  ${p.name} — ${p.role.toUpperCase()}`);
  }

  console.log("");
  console.log("Eliminated:");
  for (const p of r.eliminated) {
    console.log(`  ${p.name} — ${p.role.toUpperCase()}`);
  }

  // Key statistics
  const eliminations = events.filter((e) => e.type === "player_eliminated");
  const votedOut = eliminations.filter((e) => e.data?.reason === "voted_out");
  const kills = events.filter((e) => e.type === "player_killed");
  const saves = events.filter((e) => e.type === "player_saved");
  const statements = events.filter((e) => e.type === "statement_made");

  console.log("");
  console.log("Key Stats:");
  console.log(`  Total events:   ${events.length}`);
  console.log(`  Statements:     ${statements.length}`);
  console.log(`  Voted out:      ${votedOut.length}`);
  console.log(`  Night kills:    ${kills.length}`);
  console.log(`  Doctor saves:   ${saves.length}`);

  // Wager info
  if (wagersData.count > 0) {
    console.log("");
    console.log("Wagers:");
    console.log(`  Total bets:     ${wagersData.count}`);
    console.log(`  Pool:           ${wagersData.pool} MON`);

    const settled = wagersData.wagers.filter((w) => w.settled);
    const winners = settled.filter((w) => w.won);
    if (settled.length > 0) {
      console.log(`  Settled:        ${settled.length}`);
      console.log(`  Winners:        ${winners.length}`);
    }
  }

  // On-chain info
  if (game.onChain) {
    console.log("");
    console.log("Blockchain:");
    console.log(`  Explorer: ${game.onChain.explorerUrl}`);
    if (game.onChain.createTxHash) console.log(`  Create TX:  ${game.onChain.createTxHash}`);
    if (game.onChain.finishTxHash) console.log(`  Finish TX:  ${game.onChain.finishTxHash}`);
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
