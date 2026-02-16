/**
 * Demo Script — Scripted game showcase for hackathon video.
 * Runs a game with delays and narration for dramatic effect.
 *
 * Usage: npx tsx scripts/demo.ts
 */

import { Game } from "../src/engine/game.js";
import { AgentManager } from "../src/agents/agent-adapter.js";
import { createAgent } from "../src/agents/factory.js";
import { PERSONALITIES, pickPersonalities } from "../src/agents/personalities.js";
import { OffChainWagerSystem, WagerType } from "../src/blockchain/wagering.js";
import { createAgentWallets } from "../src/blockchain/wallet.js";
import { GameEventType, Role, Team } from "../src/types.js";
import type { GameEvent, Player } from "../src/types.js";

// ─── Colors ─────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function roleColor(role: Role | null): string {
  switch (role) {
    case Role.MAFIA: return c.red;
    case Role.DETECTIVE: return c.blue;
    case Role.DOCTOR: return c.green;
    case Role.VILLAGER: return c.yellow;
    default: return c.dim;
  }
}

// ─── Narration ──────────────────────────────────────────────

async function narrate(text: string, delayMs = 1500) {
  console.log(`\n${c.dim}${c.magenta}  ▸ ${text}${c.reset}`);
  await sleep(delayMs);
}

async function title(text: string) {
  console.log(`\n${c.bold}${c.cyan}${"═".repeat(60)}`);
  console.log(`  ${text}`);
  console.log(`${"═".repeat(60)}${c.reset}`);
  await sleep(1000);
}

// ─── Main Demo ──────────────────────────────────────────────

async function main() {
  // ─── Intro ────────────────────────────────────────────────
  console.clear();
  console.log(`
${c.bold}${c.magenta}
    ╔══════════════════════════════════════════════════════╗
    ║                                                      ║
    ║     █████╗  ██████╗ ███████╗███╗   ██╗████████╗      ║
    ║    ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝      ║
    ║    ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║         ║
    ║    ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║         ║
    ║    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║         ║
    ║    ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝         ║
    ║                                                      ║
    ║         ███╗   ███╗ █████╗ ███████╗██╗ █████╗        ║
    ║         ████╗ ████║██╔══██╗██╔════╝██║██╔══██╗       ║
    ║         ██╔████╔██║███████║█████╗  ██║███████║       ║
    ║         ██║╚██╔╝██║██╔══██║██╔══╝  ██║██╔══██║       ║
    ║         ██║ ╚═╝ ██║██║  ██║██║     ██║██║  ██║       ║
    ║         ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝       ║
    ║                                                      ║
    ║       AI Social Deduction on Monad Blockchain        ║
    ║                                                      ║
    ╚══════════════════════════════════════════════════════╝
${c.reset}`);

  await sleep(2000);

  // ─── Setup ────────────────────────────────────────────────

  await title("DEMO: 5 AI Agents Play Mafia");

  await narrate("Creating game on Monad blockchain...");

  const game = new Game({
    gameId: `demo-${Date.now().toString(36)}`,
    playerCount: 5,
    entryFee: 0.1,
    maxRounds: 10,
  });

  const names = ["Alice", "Bob", "Carol", "Dave", "Eve"];
  const personalityKeys = pickPersonalities(5);
  const manager = new AgentManager();
  const wagerSystem = new OffChainWagerSystem();
  const wallets = createAgentWallets(5);

  await narrate("Creating agent wallets...");

  for (let i = 0; i < 5; i++) {
    const player: Player = {
      id: `p${i + 1}`,
      name: names[i],
      role: null,
      alive: true,
      personality: personalityKeys[i],
    };
    game.addPlayer(player);

    const personality = PERSONALITIES[personalityKeys[i]];
    const agent = createAgent(player, personality, false);
    manager.register(agent);

    console.log(
      `  ${c.bold}${player.name}${c.reset} — ${personality.name} ` +
      `${c.dim}(${wallets[i].address.slice(0, 10)}...)${c.reset}`,
    );
    await sleep(300);
  }

  await narrate("Each agent pays 0.1 MON entry fee...");
  console.log(`  ${c.green}Total pool: 0.5 MON${c.reset}`);

  // ─── Spectator Wagers ─────────────────────────────────────

  await title("SPECTATOR WAGERING");
  await narrate("Spectators place wagers before the game starts...");

  const wagers = [
    { name: "Spectator_1", team: "village" as const, amount: 0.2 },
    { name: "Spectator_2", team: "mafia" as const, amount: 0.15 },
    { name: "Spectator_3", team: "village" as const, amount: 0.3 },
  ];

  for (const w of wagers) {
    wagerSystem.place(game["gameConfig"].gameId, w.name, WagerType.TeamBet, w.team, w.amount);
    const teamColor = w.team === "village" ? c.green : c.red;
    console.log(
      `  ${c.bold}${w.name}${c.reset} bets ${c.yellow}${w.amount} MON${c.reset} ` +
      `on ${teamColor}${w.team.toUpperCase()}${c.reset}`,
    );
    await sleep(500);
  }

  const totalWagers = wagerSystem.getPool(game["gameConfig"].gameId);
  console.log(`\n  ${c.bold}Total wager pool: ${c.yellow}${totalWagers} MON${c.reset}`);

  // ─── Game ─────────────────────────────────────────────────

  await title("GAME START");

  // Collect events and display with delays
  const events: GameEvent[] = [];
  game.onEvent(async (event) => {
    events.push(event);
    manager.broadcastEvent(event);
  });
  game.setAgentAdapter(manager);

  const result = await game.run();

  // Display events with timing
  for (const event of events) {
    switch (event.type) {
      case GameEventType.PHASE_CHANGED:
        console.log(
          `\n${c.bold}${c.cyan}  ═══ ${String(event.data.phase).toUpperCase()} ` +
          `(Round ${event.data.round}) ═══${c.reset}`,
        );
        await sleep(800);
        break;

      case GameEventType.ROLES_ASSIGNED: {
        console.log(`\n  ${c.dim}Roles assigned (secret):${c.reset}`);
        const roles = event.data.roles as { playerId: string; role: Role }[];
        for (const { playerId, role } of roles) {
          const name = names[Number(playerId.slice(1)) - 1];
          console.log(
            `    ${roleColor(role)}${name}: ${role.toUpperCase()}${c.reset}`,
          );
        }
        await sleep(1200);
        break;
      }

      case GameEventType.STATEMENT_MADE: {
        const name = names[Number(String(event.data.playerId).slice(1)) - 1];
        console.log(`  ${c.bold}${name}:${c.reset} ${event.data.content}`);
        await sleep(400);
        break;
      }

      case GameEventType.VOTE_CAST: {
        const voter = names[Number(String(event.data.voterId).slice(1)) - 1];
        const target = event.data.targetId
          ? names[Number(String(event.data.targetId).slice(1)) - 1]
          : null;
        const text = target ? `votes for ${c.bold}${target}${c.reset}` : "skips";
        console.log(`  ${c.dim}${voter} ${text}${c.reset}`);
        await sleep(300);
        break;
      }

      case GameEventType.PLAYER_ELIMINATED: {
        const { name, role, reason } = event.data as {
          name: string; role: Role; reason: string;
        };
        const action = reason === "voted_out" ? "voted out" : "killed";
        console.log(
          `\n  ${c.red}✘ ${name} was ${action}! ` +
          `Role: ${roleColor(role)}${String(role).toUpperCase()}${c.reset}`,
        );
        await sleep(1000);
        break;
      }

      case GameEventType.PLAYER_KILLED: {
        const pid = String(event.data.playerId);
        const name = names[Number(pid.slice(1)) - 1];
        console.log(`  ${c.red}☠ ${name} was found dead.${c.reset}`);
        await sleep(800);
        break;
      }

      case GameEventType.PLAYER_SAVED:
        console.log(`  ${c.green}✚ Doctor saved someone!${c.reset}`);
        await sleep(600);
        break;

      case GameEventType.GAME_OVER:
        break; // Handle below
    }
  }

  // ─── Result ───────────────────────────────────────────────

  await title("GAME OVER");

  const winColor = result.winner === Team.VILLAGE ? c.green : c.red;
  const emoji = result.winner === Team.VILLAGE ? "VILLAGE" : "MAFIA";
  console.log(`\n  ${c.bold}${winColor}${emoji} WINS!${c.reset}`);
  console.log(`  Rounds: ${result.rounds}`);
  await sleep(500);

  console.log(`\n  ${c.bold}Survivors:${c.reset}`);
  for (const p of result.survivors) {
    console.log(`    ${roleColor(p.role)}${p.name} (${p.role})${c.reset}`);
  }
  console.log(`\n  ${c.bold}Eliminated:${c.reset}`);
  for (const p of result.eliminated) {
    console.log(`    ${c.dim}${p.name} (${p.role})${c.reset}`);
  }

  // ─── Wager Settlement ─────────────────────────────────────

  await title("WAGER SETTLEMENT");

  const mafiaIds = result.eliminated
    .concat(result.survivors)
    .filter((p) => p.role === Role.MAFIA)
    .map((p) => p.id);

  const eliminatedIds = result.eliminated.map((p) => p.id);

  const settled = wagerSystem.settle(
    game["gameConfig"].gameId,
    result.winner as unknown as "village" | "mafia",
    eliminatedIds,
    mafiaIds,
  );

  for (const w of settled) {
    const icon = w.won ? `${c.green}✓ WON` : `${c.red}✗ LOST`;
    const payout = w.won ? ` → ${c.yellow}${w.payout} MON` : "";
    console.log(
      `  ${icon}${c.reset} ${w.bettor}: bet ${w.amount} MON on ${w.prediction}${payout}${c.reset}`,
    );
    await sleep(400);
  }

  // ─── Reward Distribution ──────────────────────────────────

  await title("ON-CHAIN REWARDS");

  const pool = 0.5; // Total entry pool
  console.log(`  Entry Pool:  ${c.yellow}${pool} MON${c.reset}`);
  console.log(`  Winners:     ${c.green}${(pool * 0.7).toFixed(3)} MON (70%)${c.reset}`);
  console.log(`  Consolation: ${c.yellow}${(pool * 0.1).toFixed(3)} MON (10%)${c.reset}`);
  console.log(`  Platform:    ${c.cyan}${(pool * 0.15).toFixed(3)} MON (15%)${c.reset}`);
  console.log(`  $MAFIA Burn: ${c.red}${(pool * 0.03).toFixed(3)} MON (3%)${c.reset}`);
  console.log(`  Host:        ${c.dim}${(pool * 0.02).toFixed(3)} MON (2%)${c.reset}`);

  // ─── Outro ────────────────────────────────────────────────

  await sleep(1000);
  console.log(`
${c.bold}${c.magenta}
  ╔══════════════════════════════════════════════════════╗
  ║                                                      ║
  ║  What happens when AI learns to lie, manipulate,     ║
  ║  and detect deception — with real money on the line? ║
  ║                                                      ║
  ║            Agent Mafia answers this.                  ║
  ║                                                      ║
  ║     github.com/agent-mafia  |  Built on Monad        ║
  ║                                                      ║
  ╚══════════════════════════════════════════════════════╝
${c.reset}`);
}

main().catch(console.error);
