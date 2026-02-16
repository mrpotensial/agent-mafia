// ─── State ──────────────────────────────────────────────────

const API = window.location.origin;
let currentGameId = null;
let currentSessionId = null;
let masterToken = null;
let isMaster = false;
let ws = null;
let players = {};
let speechQueue = [];
let speechTimer = null;
let lobbyInterval = null;

// ─── Room Persistence (localStorage) ────────────────────────

function saveRoomState() {
  if (currentGameId) {
    const state = { gameId: currentGameId, sessionId: currentSessionId, masterToken };
    localStorage.setItem("agentmafia_room", JSON.stringify(state));
  }
}

function loadRoomState() {
  try {
    const raw = localStorage.getItem("agentmafia_room");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function clearRoomState() {
  localStorage.removeItem("agentmafia_room");
}

function updateMasterUI() {
  // Show/hide master-only controls
  btnStart.disabled = !isMaster;
  if (btnNextGame && !btnNextGame.classList.contains("hidden")) {
    btnNextGame.disabled = !isMaster;
  }
  // Show indicator
  const indicator = document.getElementById("master-indicator");
  if (indicator) {
    indicator.textContent = isMaster ? "Room Master" : "Spectator";
    indicator.className = isMaster ? "label master-label" : "label spectator-label";
  }
}

// ─── Personality Sprites ────────────────────────────────────

const PERSONALITY_SPRITES = {
  aggressive: 'assets/characters/aggressive.svg',
  analytical: 'assets/characters/analytical.svg',
  manipulative: 'assets/characters/manipulative.svg',
  paranoid: 'assets/characters/paranoid.svg',
  charismatic: 'assets/characters/charismatic.svg',
  quiet_observer: 'assets/characters/quiet_observer.svg',
  emotional: 'assets/characters/emotional.svg',
  strategist: 'assets/characters/strategist.svg',
  jester: 'assets/characters/jester.svg',
  loyal: 'assets/characters/loyal.svg',
};

const PERSONALITY_DESCRIPTIONS = {
  aggressive: "Direct, confrontational. Pressures others into responding. Uses short, accusatory sentences.",
  analytical: "Logical, evidence-based. Tracks patterns and inconsistencies with structured arguments.",
  manipulative: "Cunning, redirects blame. Plays both sides and creates confusion with suggestive questions.",
  paranoid: "Suspicious of everyone. Sees conspiracies and questions all motives constantly.",
  charismatic: "Natural leader. Builds alliances, uses persuasion, humor, and charm to influence votes.",
  quiet_observer: "Silent most of the time. Strikes at critical moments with devastating insights.",
  emotional: "Appeals to feelings. Uses loyalty and betrayal narratives with passionate declarations.",
  strategist: "Cold, calculating. Speaks in game theory terms. Always optimizing the odds.",
  jester: "Chaotic wildcard. Unpredictable, contradicts self, uses sarcasm and random tangents.",
  loyal: "Picks an ally early and defends them fiercely. Values loyalty above all else.",
};

// ─── DOM ────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const btnCreate = $("#btn-create");
const btnStart = $("#btn-start");
const selectPlayers = $("#select-players");
const gameIdLabel = $("#game-id");
const gameStatusLabel = $("#game-status");
const wsStatusLabel = $("#ws-status");
const playersList = $("#players-list");
const logContainer = $("#log-container");
const currentPhase = $("#current-phase");
const currentRound = $("#current-round");
const aliveCount = $("#alive-count");
const resultDisplay = $("#result-display");
const winnerText = $("#winner-text");
const gameSummary = $("#game-summary");
const wagerSection = $("#wager-section");
const wagerInputArea = $("#wager-input-area");
const onchainSection = $("#onchain-section");
const onchainAddress = $("#onchain-address");
const onchainCreateTx = $("#onchain-create-tx");
const onchainFinishTx = $("#onchain-finish-tx");
const onchainFinishRow = $("#onchain-finish-row");
const townScene = $("#town-scene");
const townCharacters = $("#town-characters");
const nightOverlay = $("#night-overlay");
const cardModal = $("#card-modal");
const yugiohCard = $("#yugioh-card");
const btnNextGame = $("#btn-next-game");
const lobbyList = $("#lobby-list");
const formGuideSection = $("#form-guide-section");
const formGuideList = $("#form-guide-list");
const leaderboardSection = $("#leaderboard-section");
const leaderboardList = $("#leaderboard-list");

// ─── API Calls ──────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  // Send master token for authenticated endpoints
  if (masterToken) {
    opts.headers["Authorization"] = `Bearer ${masterToken}`;
  }
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ─── On-Chain Display ───────────────────────────────────────

function shortenHash(hash) {
  if (!hash) return "--";
  return hash.slice(0, 8) + "..." + hash.slice(-6);
}

function showOnChainInfo(onChain) {
  if (!onChain) {
    onchainSection.classList.add("hidden");
    return;
  }
  onchainSection.classList.remove("hidden");

  // Derive explorer base from the explorerUrl returned by the API
  const explorerBase = onChain.explorerUrl
    ? onChain.explorerUrl.replace(/\/address\/.*$/, "")
    : "https://monadvision.com";

  if (onChain.gameAddress) {
    onchainAddress.textContent = shortenHash(onChain.gameAddress);
    onchainAddress.href = `${explorerBase}/address/${onChain.gameAddress}`;
  }
  if (onChain.createTxHash) {
    onchainCreateTx.textContent = shortenHash(onChain.createTxHash);
    onchainCreateTx.href = `${explorerBase}/tx/${onChain.createTxHash}`;
  }
  if (onChain.finishTxHash) {
    onchainFinishRow.classList.remove("hidden");
    onchainFinishTx.textContent = shortenHash(onChain.finishTxHash);
    onchainFinishTx.href = `${explorerBase}/tx/${onChain.finishTxHash}`;
  }

  // Commit-Reveal role verification
  const commitRow = document.getElementById("onchain-commit-row");
  const commitTx = document.getElementById("onchain-commit-tx");
  const revealRow = document.getElementById("onchain-reveal-row");
  const revealTx = document.getElementById("onchain-reveal-tx");
  const verifiedBadge = document.getElementById("onchain-verified");

  if (onChain.commitTxHash && commitRow && commitTx) {
    commitRow.classList.remove("hidden");
    commitTx.textContent = shortenHash(onChain.commitTxHash);
    commitTx.href = `${explorerBase}/tx/${onChain.commitTxHash}`;
  }
  if (onChain.revealTxHash && revealRow && revealTx) {
    revealRow.classList.remove("hidden");
    revealTx.textContent = shortenHash(onChain.revealTxHash);
    revealTx.href = `${explorerBase}/tx/${onChain.revealTxHash}`;
  }
  if (onChain.rolesVerified && verifiedBadge) {
    verifiedBadge.classList.remove("hidden");
  }
}

// ─── Create Game ────────────────────────────────────────────

btnCreate.addEventListener("click", async () => {
  btnCreate.disabled = true;
  const playerCount = Number(selectPlayers.value);

  // Close old WebSocket connection (prevents ghost clients keeping old game "active")
  if (ws && ws.readyState <= 1) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }

  // Reset state
  players = {};
  playersList.innerHTML = "";
  logContainer.innerHTML = "";
  resultDisplay.classList.add("hidden");
  wagerSection.classList.add("hidden");
  onchainSection.classList.add("hidden");
  onchainFinishRow.classList.add("hidden");
  townCharacters.innerHTML = "";
  townScene.classList.add("hidden");
  nightOverlay.classList.remove("active");
  clearSpeechBubbles();
  currentPhase.textContent = "--";
  currentRound.textContent = "--";
  aliveCount.textContent = "--";
  gameSummary.textContent = "";
  $("#wager-info").textContent = "";
  myWagers = [];
  selectedPrediction = null;
  stopOddsPolling();
  document.querySelectorAll(".predict-btn").forEach((b) => b.classList.remove("selected"));
  document.querySelectorAll(".quick-amt").forEach((b) => b.classList.remove("selected"));
  const myWagersSection = document.getElementById("my-wagers");
  if (myWagersSection) myWagersSection.classList.add("hidden");
  const settlementSection = document.getElementById("settlement-results");
  if (settlementSection) settlementSection.classList.add("hidden");
  const poolViz = document.getElementById("wager-pool-viz");
  if (poolViz) poolViz.classList.add("hidden");

  try {
    const data = await api("POST", "/api/games", { playerCount, useLLM: true });
    currentGameId = data.gameId;
    currentSessionId = data.gameId; // first game = its own session
    masterToken = data.masterToken;
    isMaster = true;
    saveRoomState();

    gameIdLabel.textContent = currentGameId;
    gameStatusLabel.textContent = "lobby";
    gameStatusLabel.className = "label status-lobby";
    updateMasterUI();

    // Auto-fill players
    const fillData = await api("POST", `/api/games/${currentGameId}/autofill`);

    // Update player list
    for (const p of fillData.players) {
      players[p.id] = p;
      renderPlayer(p);
    }

    // Show town scene with characters
    renderTownScene();
    townScene.classList.remove("hidden");

    updateAliveCount();
    btnStart.disabled = false;
    // Show wager station during lobby (betting closes when game starts)
    wagerSection.classList.remove("hidden");
    if (wagerInputArea) wagerInputArea.classList.remove("hidden");
    startOddsPolling();
    addLog("system", `Game created with ${playerCount} AI agents. Entry fee: 0.1 MON each.`);
    addLog("system", "Place your bets now! Wagers close when the game starts.");

    // Hide next game button on new create
    if (btnNextGame) btnNextGame.classList.add("hidden");

    // Refresh lobby + fetch form guide
    fetchLobby();
    fetchFormGuide();
    fetchLeaderboard();

    // Poll for on-chain deployment (happens async in backend)
    pollOnChainCreate(currentGameId);
    // Keep New Game disabled while game is active — re-enabled on finish
    // btnCreate stays disabled until showWinner()
  } catch (err) {
    addLog("system", `Error creating game: ${err.message}`);
    btnCreate.disabled = false; // re-enable only on error
  }
});

// ─── Start Game ─────────────────────────────────────────────

btnStart.addEventListener("click", async () => {
  if (!currentGameId) return;
  btnStart.disabled = true;

  // Connect WebSocket first
  connectWebSocket(currentGameId);

  gameStatusLabel.textContent = "running";
  gameStatusLabel.className = "label status-running";
  // Hide wager input — betting closes when game starts, but keep pool/info visible
  if (wagerInputArea) wagerInputArea.classList.add("hidden");

  addLog("system", "Game starting... AI agents are thinking...");

  try {
    const data = await api("POST", `/api/games/${currentGameId}/start`);
    if (data.status === "finished") {
      showResult(data);
    }
  } catch (err) {
    addLog("system", `Error starting game: ${err.message}`);
    btnStart.disabled = false;
  }
});

// ─── WebSocket ──────────────────────────────────────────────

let wsRetries = 0;
const WS_MAX_RETRIES = 5;

function connectWebSocket(gameId) {
  // Close existing connection to avoid ghost clients on server
  if (ws && ws.readyState <= 1) {
    ws.onclose = null; // prevent auto-reconnect
    ws.close();
  }
  wsRetries = 0;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}/ws/${gameId}`);

  ws.onopen = () => {
    wsStatusLabel.textContent = "WS: connected";
    wsStatusLabel.style.color = "#22c55e";
    wsRetries = 0;
    // Authenticate as master if we have a token
    if (masterToken) {
      ws.send(JSON.stringify({ type: "auth", masterToken }));
    }
  };

  ws.onclose = () => {
    wsStatusLabel.textContent = "WS: disconnected";
    wsStatusLabel.style.color = "";
    // Auto-reconnect with exponential backoff
    if (wsRetries < WS_MAX_RETRIES && currentGameId === gameId) {
      const delay = Math.min(1000 * 2 ** wsRetries, 30000);
      wsRetries++;
      setTimeout(() => connectWebSocket(gameId), delay);
    }
  };

  ws.onerror = () => {
    console.error("[WebSocket] Connection error");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleEvent(data);
    } catch (err) {
      console.error("[WebSocket] Parse error:", err);
    }
  };
}

// ─── Event Handler ──────────────────────────────────────────

function handleEvent(event) {
  switch (event.type) {
    case "phase_changed":
      // External player action required (piggybacked on phase_changed)
      if (event.data.customType === "action_required") {
        const who = event.data.playerName || event.data.playerId;
        const action = event.data.actionType === "statement" ? "make a statement"
          : event.data.actionType === "vote" ? "cast a vote" : "perform night action";
        addLog("system", `Waiting for ${who} to ${action}...`);
        break;
      }
      currentPhase.textContent = formatPhase(event.data.phase);
      currentRound.textContent = event.data.round;
      addLog("phase", `═══ ${formatPhase(event.data.phase)} (Round ${event.data.round}) ═══`);
      // Night/day overlay
      if (event.data.phase === "night") {
        nightOverlay.classList.add("active");
      } else {
        nightOverlay.classList.remove("active");
      }
      break;

    case "roles_assigned":
      if (event.data.roles) {
        for (const { playerId, role } of event.data.roles) {
          if (players[playerId]) {
            players[playerId].role = role;
            updatePlayerCard(playerId);
          }
        }
        // Show role details in log
        addLog("system", "Roles assigned! Watch who lies...");
        for (const { playerId, role } of event.data.roles) {
          const p = players[playerId];
          if (p) {
            addLog("role", `${p.name} (${p.personality}) — ${role.toUpperCase()}`);
          }
        }
      }
      break;

    case "statement_made": {
      const speakerName = players[event.data.playerId]?.name ?? event.data.playerId;
      addLog("statement", event.data.content, speakerName);
      showSpeechBubble(event.data.playerId, event.data.content);
      break;
    }

    case "vote_cast": {
      const voterName = players[event.data.voterId]?.name ?? event.data.voterId;
      const targetName = event.data.targetId
        ? (players[event.data.targetId]?.name ?? event.data.targetId)
        : null;
      const text = targetName ? `${voterName} votes for ${targetName}` : `${voterName} skips`;
      addLog("vote", text);
      break;
    }

    case "player_eliminated": {
      const { playerId, name, role, reason } = event.data;
      if (players[playerId]) {
        players[playerId].alive = false;
        players[playerId].role = role;
        updatePlayerCard(playerId);
      }
      updateAliveCount();
      if (reason === "voted_out") {
        addLog("elimination", `${name} was voted out! They were ${role.toUpperCase()}.`);
      }
      // Town scene death animation
      animateCharacterDeath(playerId);
      break;
    }

    case "player_killed": {
      const { playerId } = event.data;
      const p = players[playerId];
      if (p) {
        p.alive = false;
        updatePlayerCard(playerId);
      }
      updateAliveCount();
      const killedName = p?.name ?? playerId;
      const killedRole = p?.role ? p.role.toUpperCase() : "???";
      addLog("kill", `${killedName} was killed by Mafia! They were ${killedRole}.`);
      // Town scene death animation
      animateCharacterDeath(playerId);
      break;
    }

    case "player_saved":
      addLog("save", "The Doctor saved someone tonight!");
      break;

    case "investigation_result":
      // Only shown in log if we want to reveal (spectator mode)
      break;

    case "game_over":
      // Check for wager events (custom types piggyback on game_over event)
      if (event.data.customType) {
        handleWagerEvent(event.data);
        if (event.data.customType === "wagers_settled") {
          stopOddsPolling();
        }
        break;
      }
      showWinner(event.data.winner);
      // Poll for on-chain finish tx
      if (currentGameId) {
        pollOnChainFinish(currentGameId);
      }
      break;

    case "game_created":
      // Check for wager events piggybacked on game_created type
      if (event.data?.customType) {
        handleWagerEvent(event.data);
        break;
      }
      break;

    case "connection":
      // Initial state from WebSocket
      if (event.players) {
        for (const p of event.players) {
          players[p.id] = p;
          renderPlayer(p);
        }
        updateAliveCount();
      }
      break;

    case "player_joined": {
      // External player joined the game
      const joinedName = event.data?.playerName || event.data?.playerId || "Someone";
      const joinedId = event.data?.playerId;
      const isExternal = event.data?.isExternal;
      if (joinedId && !players[joinedId]) {
        players[joinedId] = {
          id: joinedId,
          name: joinedName,
          personality: isExternal ? "external" : "unknown",
          role: null,
          alive: true,
        };
        renderPlayer(players[joinedId]);
        renderTownScene();
        updateAliveCount();
      }
      addLog("system", `${joinedName} joined the game${isExternal ? " (external player)" : ""}.`);
      break;
    }

    case "auth_ok":
      isMaster = !!event.isMaster;
      updateMasterUI();
      addLog("system", event.message || (isMaster ? "Authenticated as room master." : "Joined as spectator."));
      break;

    case "master_promoted":
      // We've been promoted to master
      masterToken = event.masterToken || masterToken;
      isMaster = true;
      saveRoomState();
      updateMasterUI();
      addLog("system", event.message || "You are now the room master.");
      break;
  }
}

// ─── Rendering ──────────────────────────────────────────────

function renderPlayer(player) {
  const existing = document.getElementById(`player-${player.id}`);
  if (existing) existing.remove();

  const card = document.createElement("div");
  card.id = `player-${player.id}`;
  card.className = "player-card";

  card.innerHTML = `
    <div class="player-name">${escapeHtml(player.name)}</div>
    <div class="player-personality">${escapeHtml(player.personality)}</div>
    <div class="player-role"></div>
  `;
  playersList.appendChild(card);
}

function updatePlayerCard(playerId) {
  const player = players[playerId];
  if (!player) return;

  const card = document.getElementById(`player-${playerId}`);
  if (!card) return;

  card.className = "player-card" + (player.alive ? "" : " dead");

  const roleEl = card.querySelector(".player-role");
  if (player.role) {
    roleEl.textContent = player.role.toUpperCase();
    roleEl.className = `player-role role-${player.role}`;
  }

  // Also update town scene character
  updateTownCharacter(playerId);
}

function updateAliveCount() {
  const alive = Object.values(players).filter((p) => p.alive).length;
  const total = Object.values(players).length;
  aliveCount.textContent = `${alive} / ${total}`;
}

function addLog(type, text, speaker) {
  const entry = document.createElement("div");
  entry.className = `log-entry log-${type}`;

  if (type === "statement" && speaker) {
    entry.innerHTML = `<span class="speaker">${escapeHtml(speaker)}:</span> ${escapeHtml(text)}`;
  } else if (type === "winner") {
    entry.className = `log-winner ${text}`;
    entry.textContent = `${text.toUpperCase()} WINS!`;
  } else {
    entry.textContent = text;
  }

  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function showResult(data) {
  gameStatusLabel.textContent = "finished";
  gameStatusLabel.className = "label status-finished";
  stopOddsPolling();

  showWinner(data.winner);

  // Show on-chain data if available
  if (data.onChain) {
    showOnChainInfo(data.onChain);
  }

  // Reveal all roles
  if (data.survivors) {
    for (const p of data.survivors) {
      if (players[p.id]) {
        players[p.id].role = p.role;
        players[p.id].alive = true;
        updatePlayerCard(p.id);
      }
    }
  }
  if (data.eliminated) {
    for (const p of data.eliminated) {
      if (players[p.id]) {
        players[p.id].role = p.role;
        players[p.id].alive = false;
        updatePlayerCard(p.id);
      }
    }
  }
  updateAliveCount();

  // Poll for on-chain finish tx (recorded asynchronously)
  if (currentGameId) {
    pollOnChainFinish(currentGameId);
  }
}

function showWinner(team) {
  resultDisplay.classList.remove("hidden");
  winnerText.textContent = `${team.toUpperCase()} WINS!`;
  winnerText.style.color = team === "village" ? "#22c55e" : "#ef4444";
  addLog("winner", team);

  gameStatusLabel.textContent = "finished";
  gameStatusLabel.className = "label status-finished";

  // Build summary
  const survivors = Object.values(players).filter((p) => p.alive);
  const eliminated = Object.values(players).filter((p) => !p.alive);
  const survivorNames = survivors.map((p) => `${p.name} (${p.role})`).join(", ");
  const eliminatedNames = eliminated.map((p) => `${p.name} (${p.role})`).join(", ");
  gameSummary.innerHTML = `
    Survivors: ${escapeHtml(survivorNames)}<br>
    Eliminated: ${escapeHtml(eliminatedNames)}
  `;

  // Re-enable New Game button now that game is finished
  btnCreate.disabled = false;

  // Show Next Game button (continuous mode — only master can start next)
  if (btnNextGame) {
    btnNextGame.classList.remove("hidden");
    btnNextGame.disabled = !isMaster;
  }

  // Refresh leaderboard and lobby
  fetchLeaderboard();
  fetchFormGuide();
  fetchLobby();
}

function formatPhase(phase) {
  const map = {
    lobby: "Lobby",
    role_assign: "Role Assignment",
    day_discuss: "Day Discussion",
    day_vote: "Day Vote",
    elimination: "Elimination",
    night: "Night",
    dawn: "Dawn",
    game_over: "Game Over",
  };
  return map[phase] || phase;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ─── On-Chain Polling ───────────────────────────────────────

async function pollOnChainCreate(gameId) {
  // Poll for the on-chain game deployment (async in backend)
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (currentGameId !== gameId) return; // game changed
    try {
      const data = await api("GET", `/api/games/${gameId}`);
      if (data.onChain?.gameAddress) {
        showOnChainInfo(data.onChain);
        addLog("system", `On-chain game deployed at ${shortenHash(data.onChain.gameAddress)}`);
        return;
      }
    } catch {
      // ignore
    }
  }
}

async function pollOnChainFinish(gameId) {
  // Poll a few times for the finish tx (on-chain recording is async)
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const data = await api("GET", `/api/games/${gameId}`);
      if (data.onChain?.finishTxHash) {
        showOnChainInfo(data.onChain);
        addLog("system", `Game result recorded on-chain: ${shortenHash(data.onChain.finishTxHash)}`);
        return;
      }
    } catch {
      // ignore
    }
  }
}

// ─── Wager Buttons ──────────────────────────────────────────

// ─── Town Scene Rendering ────────────────────────────────────

function renderTownScene() {
  townCharacters.innerHTML = "";
  const playerList = Object.values(players);

  for (const player of playerList) {
    const charEl = document.createElement("div");
    charEl.className = "town-char";
    charEl.id = `town-char-${player.id}`;
    charEl.dataset.playerId = player.id;

    const sprite = PERSONALITY_SPRITES[player.personality] || 'assets/characters/aggressive.svg';

    charEl.innerHTML = `
      <img src="${sprite}" alt="${escapeHtml(player.personality)}" />
      <span class="char-name">${escapeHtml(player.name)}</span>
      <span class="char-role-indicator"></span>
    `;

    charEl.addEventListener("click", () => showInfoCard(player.id));
    townCharacters.appendChild(charEl);
  }
}

function updateTownCharacter(playerId) {
  const player = players[playerId];
  if (!player) return;
  const charEl = document.getElementById(`town-char-${playerId}`);
  if (!charEl) return;

  if (!player.alive) {
    charEl.classList.add("dead");
  }

  const roleIndicator = charEl.querySelector(".char-role-indicator");
  if (player.role && roleIndicator) {
    roleIndicator.textContent = player.role.toUpperCase();
    roleIndicator.className = `char-role-indicator role-${player.role}`;
  }
}

function animateCharacterDeath(playerId) {
  const charEl = document.getElementById(`town-char-${playerId}`);
  if (!charEl) return;

  charEl.classList.add("dying");
  setTimeout(() => {
    charEl.classList.remove("dying");
    charEl.classList.add("dead");
  }, 1000);
}

// ─── Speech Bubbles ──────────────────────────────────────────

function showSpeechBubble(playerId, text) {
  const charEl = document.getElementById(`town-char-${playerId}`);
  if (!charEl || !players[playerId]?.alive) return;

  // Remove existing bubble on this character
  const existing = charEl.querySelector(".speech-bubble");
  if (existing) existing.remove();

  // Remove speaking class from all
  document.querySelectorAll(".town-char.speaking").forEach(el => el.classList.remove("speaking"));

  // Add speaking animation
  charEl.classList.add("speaking");

  // Truncate text
  const truncated = text.length > 80 ? text.slice(0, 77) + "..." : text;

  const bubble = document.createElement("div");
  bubble.className = "speech-bubble";
  bubble.textContent = truncated;
  charEl.appendChild(bubble);

  // Remove after 4 seconds
  setTimeout(() => {
    bubble.classList.add("fade-out");
    charEl.classList.remove("speaking");
    setTimeout(() => bubble.remove(), 300);
  }, 4000);
}

function clearSpeechBubbles() {
  document.querySelectorAll(".speech-bubble").forEach(b => b.remove());
  document.querySelectorAll(".town-char.speaking").forEach(el => el.classList.remove("speaking"));
}

// ─── Yu-Gi-Oh Info Card ──────────────────────────────────────

function showInfoCard(playerId) {
  const player = players[playerId];
  if (!player) return;

  const card = yugiohCard;
  const sprite = PERSONALITY_SPRITES[player.personality] || 'assets/characters/aggressive.svg';
  const desc = PERSONALITY_DESCRIPTIONS[player.personality] || "A mysterious agent...";

  // Set card content
  $("#card-name").textContent = player.name;
  $("#card-type").textContent = player.personality ? player.personality.replace(/_/g, " ").toUpperCase() : "UNKNOWN";
  $("#card-portrait-img").src = sprite;
  $("#card-desc-text").textContent = desc;

  // Role badge
  const roleBadge = $("#card-role-badge");
  if (player.role) {
    roleBadge.textContent = player.role.toUpperCase();
    roleBadge.className = `card-role-badge role-${player.role}`;
    roleBadge.classList.remove("hidden");
  } else {
    roleBadge.textContent = "???";
    roleBadge.className = "card-role-badge";
    roleBadge.classList.remove("hidden");
  }

  // Card border color based on role
  card.className = "yugioh-card";
  if (player.role) {
    card.classList.add(`role-${player.role}`);
  }

  // Stats
  const statusEl = $("#card-stat-status");
  statusEl.textContent = player.alive ? "ALIVE" : "ELIMINATED";
  statusEl.className = player.alive ? "card-stat" : "card-stat stat-dead";

  const roleEl = $("#card-stat-role");
  roleEl.textContent = player.role ? `ROLE: ${player.role.toUpperCase()}` : "ROLE: ???";

  // Show modal
  cardModal.classList.remove("hidden");
}

function closeInfoCard() {
  cardModal.classList.add("hidden");
}

// Card modal close handlers
document.querySelector(".card-modal-backdrop")?.addEventListener("click", closeInfoCard);
document.querySelector(".card-close")?.addEventListener("click", closeInfoCard);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeInfoCard();
});

// ─── Wager Station ──────────────────────────────────────────

let selectedPrediction = null;
let myWagers = [];
let oddsInterval = null;

// Team prediction buttons
document.querySelectorAll(".predict-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".predict-btn").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedPrediction = btn.dataset.pred;
  });
});

// Quick amount buttons
document.querySelectorAll(".quick-amt").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".quick-amt").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    document.getElementById("wager-amount").value = btn.dataset.amt;
  });
});

// Place wager
document.getElementById("place-wager-btn")?.addEventListener("click", async () => {
  if (!currentGameId) return;
  const info = $("#wager-info");
  info.className = "";
  info.textContent = "";

  const amount = parseFloat(document.getElementById("wager-amount").value);
  if (isNaN(amount) || amount < 0.01) {
    info.textContent = "Invalid amount";
    info.className = "error";
    return;
  }

  const prediction = selectedPrediction;
  if (!prediction) {
    info.textContent = "Select Village or Mafia first";
    info.className = "error";
    return;
  }

  try {
    const wager = await api("POST", `/api/games/${currentGameId}/wagers`, {
      bettor: "You",
      type: "team",
      prediction,
      amount,
    });

    myWagers.push(wager);
    info.textContent = `Wager placed: ${prediction} wins (${amount} MON)`;

    renderMyWagers();
    fetchOdds();
  } catch (err) {
    info.textContent = `Wager placed: ${prediction} (demo mode)`;
  }
});

// Render my wagers list
function renderMyWagers() {
  const container = document.getElementById("my-wagers-list");
  const section = document.getElementById("my-wagers");
  if (!container || !section) return;

  if (myWagers.length === 0) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  container.innerHTML = "";

  for (const w of myWagers) {
    const div = document.createElement("div");
    div.className = "wager-item";
    div.innerHTML = `
      <span class="wager-item-type">TEAM</span>
      <span>${escapeHtml(w.prediction)}</span>
      <span class="wager-item-amount">${w.amount} MON</span>
    `;
    container.appendChild(div);
  }
}

// Fetch and display odds
async function fetchOdds() {
  if (!currentGameId) return;

  try {
    const odds = await api("GET", `/api/games/${currentGameId}/odds`);

    // Update odds display
    const villageOdds = document.getElementById("odds-village");
    const mafiaOdds = document.getElementById("odds-mafia");
    if (villageOdds) villageOdds.textContent = odds.team.villageOdds > 0 ? `${odds.team.villageOdds}x` : "--";
    if (mafiaOdds) mafiaOdds.textContent = odds.team.mafiaOdds > 0 ? `${odds.team.mafiaOdds}x` : "--";

    // Update pool visualization
    updatePoolViz(odds);
  } catch {
    // ignore
  }
}

// Update pool bar visualization
function updatePoolViz(odds) {
  const poolViz = document.getElementById("wager-pool-viz");
  if (!poolViz) return;

  if (odds.totalPool <= 0) {
    poolViz.classList.add("hidden");
    return;
  }

  poolViz.classList.remove("hidden");

  const villageBar = document.getElementById("pool-village-bar");
  const mafiaBar = document.getElementById("pool-mafia-bar");
  const poolTotal = document.getElementById("pool-total");
  const poolBets = document.getElementById("pool-bets");

  const teamTotal = odds.team.total || 1;
  const vPct = (odds.team.villagePool / teamTotal * 100).toFixed(0);
  const mPct = (odds.team.mafiaPool / teamTotal * 100).toFixed(0);

  if (villageBar) villageBar.style.width = `${vPct}%`;
  if (mafiaBar) mafiaBar.style.width = `${mPct}%`;
  if (poolTotal) poolTotal.textContent = `Total: ${odds.totalPool.toFixed(2)} MON`;
  if (poolBets) poolBets.textContent = `${odds.totalBets} bets`;
}

// Start polling odds
function startOddsPolling() {
  stopOddsPolling();
  fetchOdds();
  oddsInterval = setInterval(fetchOdds, 5000);
}

function stopOddsPolling() {
  if (oddsInterval) {
    clearInterval(oddsInterval);
    oddsInterval = null;
  }
}

// Handle wager WebSocket events
function handleWagerEvent(data) {
  if (data.customType === "wager_placed") {
    addLog("system", `${data.bettor} wagered ${data.amount} MON on ${data.prediction} wins`);
    fetchOdds();
  } else if (data.customType === "wagers_settled") {
    showSettlementResults(data);
  }
}

// ─── Lobby ──────────────────────────────────────────────────

async function fetchLobby() {
  try {
    const games = await api("GET", "/api/games");
    renderLobby(games);
  } catch {
    // ignore
  }
}

function renderLobby(games) {
  if (!lobbyList) return;

  if (games.length === 0) {
    lobbyList.innerHTML = '<div class="lobby-empty">No active games. Create one below.</div>';
    return;
  }

  let html = `<table class="lobby-table">
    <tr><th>Game</th><th>Match</th><th>Status</th><th>Players</th><th>Pool</th><th>Action</th></tr>`;

  for (const g of games) {
    const isCurrent = g.gameId === currentGameId;
    const shortId = g.sessionId.split("-").slice(0, 2).join("-");
    const matchNum = g.matchNumber || 1;
    html += `<tr>
      <td>${shortId}${isCurrent ? " *" : ""}</td>
      <td>#${matchNum}</td>
      <td><span class="lobby-status ${g.status}">${g.status}</span></td>
      <td>${g.currentPlayers}/${g.playerCount}</td>
      <td>${g.pool.toFixed(2)} (${g.wagerCount})</td>
      <td>`;

    if (!isCurrent && (g.status === "lobby" || g.status === "running")) {
      html += `<button class="lobby-btn" onclick="joinAsSpectator('${g.gameId}')">Watch</button>`;
    } else if (isCurrent) {
      html += `<span style="color:var(--accent);font-size:10px">Current</span>`;
    }
    html += `</td></tr>`;
  }

  html += `</table>`;
  lobbyList.innerHTML = html;
}

function startLobbyPolling() {
  stopLobbyPolling();
  fetchLobby();
  lobbyInterval = setInterval(fetchLobby, 5000);
}

function stopLobbyPolling() {
  if (lobbyInterval) {
    clearInterval(lobbyInterval);
    lobbyInterval = null;
  }
}

// Join a game (spectator or rejoin as master if we have the token)
window.joinAsSpectator = async function(gameId) {
  try {
    const data = await api("GET", `/api/games/${gameId}`);
    currentGameId = gameId;
    currentSessionId = data.sessionId || null;

    // Check if we have master credentials for this game/session
    const saved = loadRoomState();
    if (saved && saved.masterToken &&
        (saved.gameId === gameId || saved.sessionId === data.sessionId)) {
      masterToken = saved.masterToken;
      isMaster = true; // optimistic — server confirms via auth_ok
    } else {
      masterToken = null;
      isMaster = false;
    }

    gameIdLabel.textContent = gameId;
    gameStatusLabel.textContent = data.status;
    gameStatusLabel.className = `label status-${data.status}`;

    // Load players
    players = {};
    playersList.innerHTML = "";
    for (const p of data.players) {
      players[p.id] = p;
      renderPlayer(p);
    }
    renderTownScene();
    townScene.classList.remove("hidden");
    updateAliveCount();

    updateMasterUI();

    // Connect WebSocket
    connectWebSocket(gameId);

    // Show wager section — input only for lobby, info only for running
    wagerSection.classList.remove("hidden");
    if (data.status === "lobby") {
      if (wagerInputArea) wagerInputArea.classList.remove("hidden");
      startOddsPolling();
    } else {
      if (wagerInputArea) wagerInputArea.classList.add("hidden");
    }

    addLog("system", `Joined game ${gameId} as spectator.`);
    fetchLobby();
  } catch (err) {
    addLog("system", `Error joining game: ${err.message}`);
  }
};

// Start lobby polling on page load
startLobbyPolling();

// ─── Auto-Rejoin from localStorage ──────────────────────────
(async function autoRejoin() {
  const saved = loadRoomState();
  if (!saved || !saved.gameId) return;

  try {
    const data = await api("GET", `/api/games/${saved.gameId}`);
    // Game still exists — rejoin it
    currentGameId = saved.gameId;
    currentSessionId = saved.sessionId || data.sessionId || null;
    masterToken = saved.masterToken || null;
    isMaster = !!masterToken; // optimistic — server confirms via auth_ok

    gameIdLabel.textContent = currentGameId;
    gameStatusLabel.textContent = data.status;
    gameStatusLabel.className = `label status-${data.status}`;
    updateMasterUI();

    // Load players
    players = {};
    playersList.innerHTML = "";
    for (const p of data.players) {
      players[p.id] = p;
      renderPlayer(p);
    }
    renderTownScene();
    townScene.classList.remove("hidden");
    updateAliveCount();

    // Connect WebSocket (will send auth message with masterToken)
    connectWebSocket(currentGameId);

    // Wager section
    wagerSection.classList.remove("hidden");
    if (data.status === "lobby") {
      if (wagerInputArea) wagerInputArea.classList.remove("hidden");
      startOddsPolling();
    } else {
      if (wagerInputArea) wagerInputArea.classList.add("hidden");
    }

    // Show next game button if finished
    if (data.status === "finished") {
      if (btnNextGame) {
        btnNextGame.classList.remove("hidden");
        btnNextGame.disabled = !isMaster;
      }
      if (data.onChain) showOnChainInfo(data.onChain);
    }

    addLog("system", `Reconnected to game ${currentGameId}.`);
    fetchFormGuide();
    fetchLeaderboard();
  } catch {
    // Game no longer exists — clear saved state
    clearRoomState();
  }
})();

// ─── Next Game (Continuous Mode) ────────────────────────────

btnNextGame?.addEventListener("click", async () => {
  if (!currentGameId) return;
  btnNextGame.disabled = true;

  try {
    const data = await api("POST", `/api/games/${currentGameId}/next-game`);
    currentGameId = data.gameId;
    currentSessionId = data.sessionId;

    // Reset UI
    logContainer.innerHTML = "";
    resultDisplay.classList.add("hidden");
    wagerSection.classList.add("hidden");
    nightOverlay.classList.remove("active");
    clearSpeechBubbles();
    currentPhase.textContent = "--";
    currentRound.textContent = "--";
    myWagers = [];
    selectedPrediction = null;
    stopOddsPolling();
    document.querySelectorAll(".predict-btn").forEach((b) => b.classList.remove("selected"));
    document.querySelectorAll(".quick-amt").forEach((b) => b.classList.remove("selected"));
    const myWagersSection = document.getElementById("my-wagers");
    if (myWagersSection) myWagersSection.classList.add("hidden");
    const settlementSection = document.getElementById("settlement-results");
    if (settlementSection) settlementSection.classList.add("hidden");
    const poolViz = document.getElementById("wager-pool-viz");
    if (poolViz) poolViz.classList.add("hidden");
    $("#wager-info").textContent = "";

    // Load same players (new game)
    players = {};
    playersList.innerHTML = "";
    for (const p of data.players) {
      players[p.id] = { ...p, role: null, alive: true };
      renderPlayer(players[p.id]);
    }
    renderTownScene();
    townScene.classList.remove("hidden");
    updateAliveCount();

    gameIdLabel.textContent = currentGameId;
    gameStatusLabel.textContent = "lobby";
    gameStatusLabel.className = "label status-lobby";
    btnStart.disabled = !isMaster;
    btnNextGame.classList.add("hidden");
    saveRoomState();
    updateMasterUI();
    // Show wager station for the new lobby (input area visible)
    wagerSection.classList.remove("hidden");
    if (wagerInputArea) wagerInputArea.classList.remove("hidden");
    startOddsPolling();

    addLog("system", `New game created (same characters). Match #${data.matchNumber || "?"}`);
    addLog("system", "Place your bets now! Wagers close when the game starts.");
    fetchLobby();
    fetchLeaderboard();
    fetchFormGuide();
  } catch (err) {
    addLog("system", `Error creating next game: ${err.message}`);
  } finally {
    btnNextGame.disabled = false;
  }
});

// ─── Form Guide ─────────────────────────────────────────────

async function fetchFormGuide() {
  if (!currentGameId) return;
  try {
    const data = await api("GET", `/api/stats/form-guide?gameId=${currentGameId}`);
    renderFormGuide(data.formGuide);
  } catch {
    // No stats yet, hide
    if (formGuideSection) formGuideSection.classList.add("hidden");
  }
}

function renderFormGuide(guide) {
  if (!formGuideList || !formGuideSection) return;

  if (!guide || guide.length === 0) {
    formGuideSection.classList.add("hidden");
    return;
  }

  formGuideSection.classList.remove("hidden");
  formGuideList.innerHTML = "";

  for (const entry of guide) {
    const wrClass = entry.winRate >= 0.6 ? "good" : entry.winRate >= 0.4 ? "mid" : "bad";
    const srClass = entry.survivalRate >= 0.6 ? "good" : entry.survivalRate >= 0.4 ? "mid" : "bad";

    const div = document.createElement("div");
    div.className = "form-guide-item";
    div.innerHTML = `
      <span class="form-guide-name">${escapeHtml(entry.name)}</span>
      <span class="form-guide-stats">
        <span class="form-guide-stat ${wrClass}" title="Win Rate">${(entry.winRate * 100).toFixed(0)}%W</span>
        <span class="form-guide-stat ${srClass}" title="Survival Rate">${(entry.survivalRate * 100).toFixed(0)}%S</span>
        ${entry.hotStreak > 0 ? `<span class="form-guide-streak" title="Hot Streak">${entry.hotStreak}W</span>` : ""}
      </span>
    `;
    formGuideList.appendChild(div);
  }
}

// ─── Leaderboard ────────────────────────────────────────────

async function fetchLeaderboard() {
  try {
    const data = await api("GET", "/api/stats/leaderboard");
    renderLeaderboard(data.leaderboard);
  } catch {
    if (leaderboardSection) leaderboardSection.classList.add("hidden");
  }
}

function renderLeaderboard(leaderboard) {
  if (!leaderboardList || !leaderboardSection) return;

  if (!leaderboard || leaderboard.length === 0) {
    leaderboardSection.classList.add("hidden");
    return;
  }

  leaderboardSection.classList.remove("hidden");
  leaderboardList.innerHTML = "";

  for (let i = 0; i < leaderboard.length; i++) {
    const entry = leaderboard[i];
    const rank = i + 1;
    const rankClass = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : "";
    const wrClass = entry.winRate >= 0.6 ? "high" : entry.winRate >= 0.4 ? "mid" : "low";

    const div = document.createElement("div");
    div.className = "leaderboard-item";
    div.innerHTML = `
      <span class="leaderboard-rank ${rankClass}">#${rank}</span>
      <span class="leaderboard-name">${escapeHtml(entry.name)}</span>
      <span class="leaderboard-wr ${wrClass}">${(entry.winRate * 100).toFixed(0)}%</span>
      <span class="leaderboard-gp">${entry.gamesPlayed}G</span>
    `;
    leaderboardList.appendChild(div);
  }
}

// Show settlement results
function showSettlementResults(data) {
  const section = document.getElementById("settlement-results");
  const list = document.getElementById("settlement-list");
  const summary = document.getElementById("settlement-summary");
  if (!section || !list || !summary) return;

  section.classList.remove("hidden");
  list.innerHTML = "";

  // Show all results
  let myTotal = 0;
  let myPayout = 0;

  for (const r of data.results) {
    const isMe = r.bettor === "You";

    const div = document.createElement("div");
    div.className = `settlement-item ${r.won ? "won" : "lost"}`;
    div.innerHTML = `
      <span>${escapeHtml(r.bettor)}</span>
      <span>${r.prediction}</span>
      <span>${r.won ? "+" + r.payout.toFixed(2) : "-" + r.amount.toFixed(2)} MON</span>
    `;
    list.appendChild(div);

    if (isMe) {
      myTotal += r.amount;
      myPayout += r.payout;
    }
  }

  // Summary for user
  if (myTotal > 0) {
    const profit = myPayout - myTotal;
    summary.textContent = profit >= 0
      ? `Your P&L: +${profit.toFixed(2)} MON`
      : `Your P&L: ${profit.toFixed(2)} MON`;
    summary.className = profit >= 0 ? "profit" : "loss";
  } else {
    summary.textContent = `Pool: ${data.totalPool.toFixed(2)} MON | Fee: ${data.platformFee.toFixed(2)} MON`;
    summary.className = "";
  }

  addLog("system", `Wagers settled! Pool: ${data.totalPool.toFixed(2)} MON, Fee: ${data.platformFee.toFixed(2)} MON`);
}
