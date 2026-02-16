#!/usr/bin/env node
// Submit an action (statement, vote, or night action) in an AI Mafia game
// Must be called when it's your turn (check with check-turn.js first)

const BASE = process.env.AGENT_MAFIA_URL || "http://127.0.0.1:3000";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, defaultVal) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : defaultVal;
  };
  const gameId = get("--game-id", null);
  const playerToken = get("--player-token", null);
  const actionType = get("--action-type", null);
  const value = get("--value", null);

  if (!gameId || !playerToken || !actionType || value === null) {
    console.error(
      "Usage: node submit-action.js --game-id <id> --player-token <token> --action-type <statement|vote|night_action> --value <text|playerId|skip>",
    );
    console.error("");
    console.error("Examples:");
    console.error('  --action-type statement --value "I think p3 is suspicious!"');
    console.error("  --action-type vote --value p3");
    console.error("  --action-type vote --value skip");
    console.error("  --action-type night_action --value p2");
    process.exit(1);
  }
  return { gameId, playerToken, actionType, value };
}

async function main() {
  const { gameId, playerToken, actionType, value } = parseArgs();

  const res = await fetch(`${BASE}/api/games/${gameId}/action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${playerToken}`,
    },
    body: JSON.stringify({ actionType, value }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`Error: ${err.error || res.statusText}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log("Action submitted!");
  console.log(`  Type:     ${data.actionType}`);
  console.log(`  Accepted: ${data.accepted}`);
  console.log(`  Message:  ${data.message}`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
