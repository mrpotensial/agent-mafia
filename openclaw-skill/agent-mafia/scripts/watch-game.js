#!/usr/bin/env node
// Watch a running AI Mafia game by polling for new events

const BASE = process.env.AGENT_MAFIA_URL || "http://127.0.0.1:3000";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, defaultVal) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : defaultVal;
  };

  const gameId = get("--game-id", null);
  if (!gameId) {
    console.error("Usage: node watch-game.js --game-id <id> [--interval 3000] [--max-polls 100]");
    process.exit(1);
  }

  return {
    gameId,
    interval: Number(get("--interval", "3000")),
    maxPolls: Number(get("--max-polls", "100")),
  };
}

function buildNameMap(players) {
  const map = {};
  for (const p of players) {
    map[p.id] = p.name;
  }
  return map;
}

function resolveName(nameMap, playerId) {
  return nameMap[playerId] || playerId;
}

function formatEvent(event, nameMap) {
  const d = event.data || {};

  switch (event.type) {
    case "phase_changed":
      return `\n=== ${String(d.phase).toUpperCase().replace(/_/g, " ")} (Round ${d.round}) ===`;

    case "player_joined":
      return `  + ${d.name} joined the game`;

    case "roles_assigned": {
      const roles = (d.roles || []).map((r) => `${resolveName(nameMap, r.playerId)}=${r.role}`);
      return `  Roles assigned: ${roles.join(", ")}`;
    }

    case "statement_made":
      return `  ${resolveName(nameMap, d.playerId)}: "${d.content}"`;

    case "vote_cast": {
      const voter = resolveName(nameMap, d.voterId);
      const target = d.targetId ? resolveName(nameMap, d.targetId) : "SKIP";
      return `  ${voter} votes -> ${target}`;
    }

    case "player_eliminated":
      return `  ELIMINATED: ${d.name} (${String(d.role).toUpperCase()}) — ${d.reason === "voted_out" ? "voted out" : "killed by mafia"}`;

    case "night_action": {
      const actor = resolveName(nameMap, d.actorId);
      const target = resolveName(nameMap, d.targetId);
      return `  [Night] ${String(d.role).toUpperCase()} ${actor} targets ${target}`;
    }

    case "player_killed":
      return `  KILLED: ${resolveName(nameMap, d.playerId)} was found dead`;

    case "player_saved":
      return `  SAVED: The Doctor saved someone!`;

    case "investigation_result": {
      const target = resolveName(nameMap, d.targetId);
      const verdict = d.isMafia ? "IS MAFIA" : "is NOT Mafia";
      return `  [Detective] ${target} ${verdict}`;
    }

    case "game_over":
      return `\nGAME OVER — ${String(d.winner).toUpperCase()} WINS!`;

    default:
      return `  [${event.type}] ${JSON.stringify(d)}`;
  }
}

async function main() {
  const { gameId, interval, maxPolls } = parseArgs();

  // Fetch initial game state to build name map
  const stateRes = await fetch(`${BASE}/api/games/${gameId}`);
  if (!stateRes.ok) {
    if (stateRes.status === 404) {
      console.error(`Game not found: ${gameId}`);
      process.exit(1);
    }
    throw new Error(`HTTP ${stateRes.status}: ${await stateRes.text()}`);
  }

  const initialState = await stateRes.json();
  const nameMap = buildNameMap(initialState.players);

  console.log(`Watching game ${gameId} (polling every ${interval}ms, max ${maxPolls} polls)...`);
  console.log(`Players: ${initialState.players.map((p) => p.name).join(", ") || "none yet"}`);
  console.log("");

  let seenCount = 0;

  for (let poll = 0; poll < maxPolls; poll++) {
    // Fetch events
    const eventsRes = await fetch(`${BASE}/api/games/${gameId}/events`);
    if (!eventsRes.ok) {
      throw new Error(`HTTP ${eventsRes.status}: ${await eventsRes.text()}`);
    }
    const { events } = await eventsRes.json();

    // Print only new events since last poll
    for (let i = seenCount; i < events.length; i++) {
      const event = events[i];

      // Update name map from player_joined events
      if (event.type === "player_joined" && event.data?.playerId && event.data?.name) {
        nameMap[event.data.playerId] = event.data.name;
      }

      console.log(formatEvent(event, nameMap));
    }
    seenCount = events.length;

    // Check if game is over
    const checkRes = await fetch(`${BASE}/api/games/${gameId}`);
    if (checkRes.ok) {
      const state = await checkRes.json();

      // Update name map if new players appeared
      for (const p of state.players) {
        if (!nameMap[p.id]) nameMap[p.id] = p.name;
      }

      if (state.status === "finished") {
        console.log("");
        console.log("Game finished. Use get-results for full summary.");
        return;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  console.log("");
  console.log(`Max polls (${maxPolls}) reached. Game may still be running.`);
  console.log(`Resume with: node scripts/watch-game.js --game-id ${gameId}`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
