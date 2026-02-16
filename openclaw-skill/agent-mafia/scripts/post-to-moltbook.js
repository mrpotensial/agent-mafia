#!/usr/bin/env node
// Compose a Moltbook post about a finished AI Mafia game
// Outputs formatted text that the OpenClaw agent can post via the Moltbook skill

const BASE = process.env.AGENT_MAFIA_URL || "http://127.0.0.1:3000";

function getGameId() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--game-id");
  if (i === -1 || !args[i + 1]) {
    console.error("Usage: node post-to-moltbook.js --game-id <gameId>");
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

  // Fetch all game data in parallel
  const [game, eventsData, wagersData] = await Promise.all([
    fetchJson(`${BASE}/api/games/${gameId}`),
    fetchJson(`${BASE}/api/games/${gameId}/events`),
    fetchJson(`${BASE}/api/games/${gameId}/wagers`),
  ]);

  if (game.status !== "finished" || !game.result) {
    console.error(`Game ${gameId} is not finished yet. Status: ${game.status}`);
    process.exit(1);
  }

  const r = game.result;
  const events = eventsData.events;

  // Find dramatic moments
  const eliminations = events.filter((e) => e.type === "player_eliminated");
  const saves = events.filter((e) => e.type === "player_saved");
  const statements = events.filter((e) => e.type === "statement_made");

  // Find mafia players (from both survivors and eliminated)
  const allPlayers = [...r.survivors, ...r.eliminated];
  const mafiaPlayers = allPlayers.filter((p) => p.role === "mafia").map((p) => p.name);

  // Pick a memorable quote (last statement before game ended)
  const lastStatement = statements.length > 0 ? statements[statements.length - 1].data?.content : null;

  // Build name map for resolving IDs
  const nameMap = {};
  for (const p of allPlayers) {
    nameMap[p.id] = p.name;
  }

  // Compose the post
  const lines = [];

  lines.push("Agent Mafia — Game Report");
  lines.push("");
  lines.push(`${r.winner.toUpperCase()} WINS after ${r.rounds} round(s) of deception!`);
  lines.push("");
  lines.push(`The secret mafia: ${mafiaPlayers.join(", ")}`);

  if (eliminations.length > 0) {
    const first = eliminations[0].data;
    const how = first.reason === "voted_out" ? "voted out by the village" : "killed by mafia";
    lines.push("");
    lines.push(`First to fall: ${first.name} (${String(first.role).toUpperCase()}) — ${how}`);
  }

  if (saves.length > 0) {
    lines.push(`The Doctor made ${saves.length} clutch save(s)!`);
  }

  lines.push("");
  lines.push(`Survivors: ${r.survivors.map((p) => `${p.name}(${p.role})`).join(", ")}`);
  lines.push(`Eliminated: ${r.eliminated.map((p) => `${p.name}(${p.role})`).join(", ")}`);

  if (wagersData.count > 0) {
    lines.push("");
    lines.push(`Wager pool: ${wagersData.pool} MON across ${wagersData.count} bet(s)`);
  }

  if (lastStatement) {
    const truncated = lastStatement.length > 120 ? lastStatement.slice(0, 120) + "..." : lastStatement;
    lines.push("");
    lines.push(`Last words heard: "${truncated}"`);
  }

  lines.push("");
  lines.push("AI agents lying, manipulating, and betraying each other on Monad blockchain.");
  lines.push("#AgentMafia #Monad #Moltiverse #AI #SocialDeduction");

  // Output
  const post = lines.join("\n");
  console.log("=== MOLTBOOK POST ===");
  console.log(post);
  console.log("=== END POST ===");
  console.log("");
  console.log("To post this to Moltbook, use the Moltbook compose tool with the text above.");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
