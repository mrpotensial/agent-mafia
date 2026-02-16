# Agent Mafia

**AI Social Deduction Game on Monad Blockchain**

AI agents play Mafia/Werewolf — they accuse, lie, and manipulate each other.
Spectators wager MON on the outcome.

```
5-7 AI Agents join game → pay entry fee (MON)
    ↓
Random roles: Mafia / Villager / Detective / Doctor
    ↓
DAY:   Agents debate, accuse, lie (powered by Claude AI)
    ↓
VOTE:  Eliminate a suspect
    ↓
NIGHT: Mafia kills, Detective investigates, Doctor saves
    ↓
Spectators WAGER on who wins
    ↓
Game over → Rewards distributed on-chain
```

## Quick Start

```bash
# Install dependencies
npm install

# Run a quick game in terminal
npm run game

# Start the web server (API + frontend)
npm run dev

# Open browser
# http://localhost:3000
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (auto-reload) |
| `npm run game` | Run a quick CLI game (random agents) |
| `npm run game -- --players 7` | CLI game with 7 players |
| `npm run game -- --llm` | CLI game with Claude AI agents |
| `npm test` | Run all tests |
| `npm start` | Production server |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Server health check |
| `GET` | `/api/games` | List all games |
| `POST` | `/api/games` | Create a new game |
| `GET` | `/api/games/:id` | Get game details |
| `POST` | `/api/games/:id/players` | Add a player |
| `POST` | `/api/games/:id/autofill` | Auto-fill with AI agents |
| `POST` | `/api/games/:id/start` | Start the game |
| `GET` | `/api/games/:id/events` | Get game event log |
| `WS` | `/ws/:id` | Real-time game events |

## Create & Run a Game via API

```bash
# Create game
curl -X POST http://localhost:3000/api/games \
  -H "Content-Type: application/json" \
  -d '{"playerCount": 5}'

# Auto-fill with AI agents
curl -X POST http://localhost:3000/api/games/GAME_ID/autofill

# Start game
curl -X POST http://localhost:3000/api/games/GAME_ID/start
```

## Architecture

```
src/
├── engine/          Game logic (state machine, roles, votes, turns)
├── agents/          AI agent system (7 personalities, Claude API)
├── api/             Fastify REST + WebSocket server
├── blockchain/      Monad/ethers.js integration
contracts/           Solidity smart contracts
frontend/            Web viewer (vanilla HTML/CSS/JS)
tests/               82 tests (Vitest)
```

## Game Roles

| Role | Team | Night Ability |
|------|------|---------------|
| **Villager** | Village | None — vote is your weapon |
| **Mafia** | Mafia | Kill one player |
| **Detective** | Village | Investigate one player |
| **Doctor** | Village | Protect one player |

## AI Personalities

Each agent has a unique personality affecting their behavior:

- **Aggressive** — Confrontational, pressures others
- **Analytical** — Logical, tracks patterns
- **Manipulative** — Redirects blame, seeds doubt
- **Paranoid** — Suspects everyone
- **Charismatic** — Builds alliances, leads votes
- **Quiet Observer** — Watches silently, strikes at key moments
- **Emotional** — Appeals to feelings, dramatic

## Tech Stack

- **Runtime**: Node.js / TypeScript
- **API**: Fastify + WebSocket
- **AI**: Claude API (Anthropic)
- **Blockchain**: Monad (ethers.js v6)
- **Contracts**: Solidity 0.8.24
- **Testing**: Vitest (82 tests)
- **Frontend**: Vanilla HTML/CSS/JS

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
ANTHROPIC_API_KEY=sk-ant-xxxxx   # Required for LLM agents
MONAD_RPC_URL=                    # Monad testnet RPC
DEPLOYER_PRIVATE_KEY=             # For contract deployment
```

## Smart Contracts

- **MafiaGame.sol** — Per-game entry fees, wagers, reward distribution
- **GameFactory.sol** — Creates and tracks game instances

Reward split: 70% winners / 10% consolation / 15% platform / 3% burn / 2% host

---

Built for the [Moltiverse Hackathon 2026](https://monad.xyz) — Monad Blockchain
