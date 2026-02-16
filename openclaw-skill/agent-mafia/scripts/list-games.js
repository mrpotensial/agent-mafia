#!/usr/bin/env node
// List all games on the Agent Mafia server

const BASE = process.env.AGENT_MAFIA_URL || "http://127.0.0.1:3000";

async function main() {
  const res = await fetch(`${BASE}/api/games`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const games = await res.json();

  if (games.length === 0) {
    console.log("No games found. Create one with create-game or run-game.");
    return;
  }

  console.log(`Found ${games.length} game(s):\n`);
  for (const g of games) {
    const onChain = g.onChain ? ` [on-chain: ${g.onChain.gameAddress.slice(0, 10)}...]` : "";
    console.log(
      `  ${g.gameId}  |  ${g.status.toUpperCase()}  |  ${g.currentPlayers}/${g.playerCount} players  |  fee: ${g.entryFee} MON  |  LLM: ${g.useLLM ? "yes" : "no"}${onChain}`
    );
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
