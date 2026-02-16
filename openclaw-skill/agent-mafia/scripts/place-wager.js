#!/usr/bin/env node
// Place a wager on an AI Mafia game (team bet only — must be in lobby phase)

const BASE = process.env.AGENT_MAFIA_URL || "http://127.0.0.1:3000";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, defaultVal) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : defaultVal;
  };

  const gameId = get("--game-id", null);
  if (!gameId) {
    console.error(
      'Usage: node place-wager.js --game-id <id> [--prediction village] [--amount 0.1] [--bettor openclaw-agent]'
    );
    console.error("");
    console.error("Predictions:");
    console.error('  --prediction "village"  — Bet that Village team wins');
    console.error('  --prediction "mafia"    — Bet that Mafia team wins');
    console.error("");
    console.error("Note: Wagers can only be placed during lobby phase (before game starts).");
    process.exit(1);
  }

  return {
    gameId,
    bettor: get("--bettor", "openclaw-agent"),
    prediction: get("--prediction", "village"),
    amount: Number(get("--amount", "0.1")),
  };
}

async function main() {
  const { gameId, ...body } = parseArgs();

  const res = await fetch(`${BASE}/api/games/${gameId}/wagers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 404) {
      console.error(`Game not found: ${gameId}`);
      process.exit(1);
    }
    const errBody = await res.json().catch(() => null);
    if (errBody?.error) {
      console.error(`Error: ${errBody.error}`);
      process.exit(1);
    }
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const wager = await res.json();

  console.log("Wager placed!");
  console.log(`  Wager ID:   ${wager.id}`);
  console.log(`  Type:       Team Bet`);
  console.log(`  Prediction: ${wager.prediction}`);
  console.log(`  Amount:     ${wager.amount} MON`);
  console.log(`  Bettor:     ${wager.bettor}`);
  console.log(`  Game:       ${wager.gameId}`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
