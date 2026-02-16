/**
 * CLI Game Runner — Watch AI agents play Mafia in the terminal.
 *
 * Usage:
 *   npx tsx scripts/run-game.ts            # 5 random agents
 *   npx tsx scripts/run-game.ts --players 7 # 7 random agents
 *   npx tsx scripts/run-game.ts --llm       # use LLM (set AI_PROVIDER in .env)
 */

import { Game } from "../src/engine/game.js";
import { AgentManager } from "../src/agents/agent-adapter.js";
import { createAgent } from "../src/agents/factory.js";
import {
  PERSONALITIES,
  pickPersonalities,
} from "../src/agents/personalities.js";
import { config } from "../src/config.js";
import { GameEventType, Team, Role, ROLE_TEAM } from "../src/types.js";
import type { GameEvent, Player } from "../src/types.js";

// ─── Parse Args ─────────────────────────────────────────────

const args = process.argv.slice(2);
const playerCount = args.includes("--players")
  ? Number(args[args.indexOf("--players") + 1])
  : 5;
const useLLM = args.includes("--llm");

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
};

function roleColor(role: Role | null): string {
  switch (role) {
    case Role.MAFIA:
      return c.red;
    case Role.DETECTIVE:
      return c.blue;
    case Role.DOCTOR:
      return c.green;
    case Role.VILLAGER:
      return c.yellow;
    default:
      return c.dim;
  }
}

// ─── Event Logger ───────────────────────────────────────────

function logEvent(event: GameEvent): void {
  switch (event.type) {
    case GameEventType.PHASE_CHANGED:
      console.log(
        `\n${c.bold}${c.cyan}═══ ${event.data.phase} (Round ${event.data.round}) ═══${c.reset}`,
      );
      break;

    case GameEventType.ROLES_ASSIGNED: {
      console.log(`\n${c.bold}Roles assigned (hidden from players):${c.reset}`);
      const roles = event.data.roles as { playerId: string; role: Role }[];
      for (const { playerId, role } of roles) {
        console.log(
          `  ${roleColor(role)}${playerId}: ${role.toUpperCase()}${c.reset}`,
        );
      }
      break;
    }

    case GameEventType.STATEMENT_MADE: {
      const { playerId, content } = event.data as {
        playerId: string;
        content: string;
      };
      console.log(`  ${c.bold}${playerId}:${c.reset} ${content}`);
      break;
    }

    case GameEventType.VOTE_CAST: {
      const { voterId, targetId } = event.data as {
        voterId: string;
        targetId: string | null;
      };
      const action = targetId ? `votes for ${c.bold}${targetId}${c.reset}` : "skips";
      console.log(`  ${c.dim}${voterId} ${action}${c.reset}`);
      break;
    }

    case GameEventType.PLAYER_ELIMINATED: {
      const { name, role, reason } = event.data as {
        name: string;
        role: Role;
        reason: string;
      };
      const action =
        reason === "voted_out" ? "was voted out" : "was killed by Mafia";
      console.log(
        `\n  ${c.red}✘ ${name} ${action}! They were ${roleColor(role)}${role.toUpperCase()}${c.reset}`,
      );
      break;
    }

    case GameEventType.PLAYER_KILLED: {
      const { playerId } = event.data as { playerId: string };
      console.log(
        `  ${c.red}☠ ${playerId} was found dead this morning.${c.reset}`,
      );
      break;
    }

    case GameEventType.PLAYER_SAVED:
      console.log(
        `  ${c.green}✚ The Doctor saved someone tonight!${c.reset}`,
      );
      break;

    case GameEventType.GAME_OVER: {
      const { winner } = event.data as { winner: Team };
      const color = winner === Team.VILLAGE ? c.green : c.red;
      const emoji = winner === Team.VILLAGE ? "🏘️" : "🔪";
      console.log(
        `\n${c.bold}${color}════════════════════════════════════════`,
      );
      console.log(`  ${emoji} ${winner.toUpperCase()} WINS! ${emoji}`);
      console.log(`════════════════════════════════════════${c.reset}\n`);
      break;
    }
  }
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold}${c.magenta}╔══════════════════════════════════════╗`);
  console.log(`║        AGENT MAFIA - CLI Runner       ║`);
  console.log(`╚══════════════════════════════════════╝${c.reset}`);
  const modeLabel = useLLM ? `LLM (${config.ai.provider}/${config.ai.model})` : "Random";
  console.log(`Players: ${playerCount} | Mode: ${modeLabel}\n`);

  const game = new Game({
    gameId: `cli-${Date.now().toString(36)}`,
    playerCount,
    entryFee: 0.1,
    maxRounds: 10,
  });

  const names = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"];
  const personalityKeys = pickPersonalities(playerCount);
  const manager = new AgentManager();

  for (let i = 0; i < playerCount; i++) {
    const player: Player = {
      id: `p${i + 1}`,
      name: names[i],
      role: null,
      alive: true,
      personality: personalityKeys[i],
    };
    game.addPlayer(player);

    const personality = PERSONALITIES[personalityKeys[i]];
    const agent = createAgent(player, personality, useLLM);
    manager.register(agent);

    console.log(
      `  ${c.bold}${player.name}${c.reset} — ${personality.name} personality`,
    );
  }

  // Wire up events
  game.onEvent((event) => {
    manager.broadcastEvent(event);
    logEvent(event);
  });

  game.setAgentAdapter(manager);

  console.log(`\n${c.dim}Starting game...${c.reset}`);
  const result = await game.run();

  // Summary
  console.log(`${c.bold}Game Summary:${c.reset}`);
  console.log(`  Rounds: ${result.rounds}`);
  console.log(`  Winner: ${result.winner.toUpperCase()}`);
  console.log(`  Survivors:`);
  for (const p of result.survivors) {
    console.log(`    ${roleColor(p.role)}${p.name} (${p.role})${c.reset}`);
  }
  console.log(`  Eliminated:`);
  for (const p of result.eliminated) {
    console.log(`    ${roleColor(p.role)}${p.name} (${p.role})${c.reset}`);
  }
  console.log(`  Total events: ${result.events.length}`);
}

main().catch(console.error);
