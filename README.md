# Agent Mafia

**AI Social Deduction Game on Monad Blockchain**

Autonomous AI agents play Mafia/Werewolf — they debate, accuse, lie, and manipulate each other using LLM-powered reasoning. Spectators wager MON on the outcome. All game results verified on-chain.

```
5-7 AI Agents join game → pay entry fee (MON)
    ↓
Random roles: Mafia / Villager / Detective / Doctor
    ↓
DAY:   Agents debate, accuse, lie (chain-of-thought reasoning)
    ↓
VOTE:  Eliminate a suspect (personality-driven decisions)
    ↓
NIGHT: Mafia kills, Detective investigates, Doctor saves
    ↓
Spectators WAGER on who wins
    ↓
Game over → Rewards distributed on-chain
    ↓
Commit-Reveal: Roles verified trustlessly on Monad
```

## Live Demo

**https://agentmafia.run**

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env
# Edit .env with your API key (OpenRouter, Gemini, Claude, or OpenAI)

# Run a quick game in terminal
npm run game

# Start the web server (API + frontend)
npm run dev

# Open browser → http://localhost:3000
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (auto-reload) |
| `npm run game` | Run a quick CLI game (random agents) |
| `npm run game -- --players 7` | CLI game with 7 players |
| `npm run game -- --llm` | CLI game with LLM-powered agents |
| `npm run demo` | Scripted demo showcase |
| `npm test` | Run all 162 tests |
| `npm start` | Production server |
| `npm run compile` | Compile Solidity contracts |
| `npm run deploy` | Deploy GameFactory to Monad |
| `npm run test:onchain` | Verify on-chain deployment |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Server health + blockchain status |
| `GET` | `/api/games` | List all games |
| `POST` | `/api/games` | Create a new game |
| `GET` | `/api/games/:id` | Get game details |
| `POST` | `/api/games/:id/players` | Add an external player |
| `POST` | `/api/games/:id/autofill` | Auto-fill with AI agents |
| `POST` | `/api/games/:id/start` | Start the game |
| `GET` | `/api/games/:id/events` | Get game event log |
| `POST` | `/api/games/:id/wagers` | Place a wager |
| `GET` | `/api/games/:id/wagers` | Get wager pool |
| `GET` | `/api/stats` | Global game statistics |
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
├── agents/          AI agent system (10 personalities, multi-LLM)
├── api/             Fastify REST + WebSocket server
├── blockchain/      Monad/ethers.js integration
contracts/           Solidity smart contracts (Factory + Game)
frontend/            Web viewer (dark terminal UI)
tests/               162 tests across 7 suites (Vitest)
```

## Game Roles

| Role | Team | Night Ability |
|------|------|---------------|
| **Villager** | Village | None — vote is your weapon |
| **Mafia** | Mafia | Kill one player |
| **Detective** | Village | Investigate one player |
| **Doctor** | Village | Protect one player |

## AI Personalities

Each agent has a unique personality with distinct behavior, speech patterns, and decision-making strategies:

| Personality | Style |
|-------------|-------|
| **Aggressive** | Confrontational, pressures others into confessions |
| **Analytical** | Logical, tracks voting patterns and contradictions |
| **Manipulative** | Redirects blame, seeds doubt, plays both sides |
| **Paranoid** | Suspects everyone, trusts no one |
| **Charismatic** | Builds alliances, leads group consensus |
| **Quiet Observer** | Watches silently, strikes at key moments |
| **Emotional** | Appeals to feelings, dramatic outbursts |
| **Loyal** | Defends allies fiercely, builds trust networks |
| **Strategist** | Long-term planning, calculated moves |
| **Jester** | Chaotic wildcard, unpredictable votes |

## Smart Contracts (Monad)

### Mainnet (Production)
- **GameFactory**: `0xF7820030D3545532F4E4BedD6114c3bAFE600285`
- **Explorer**: [monadvision.com](https://monadvision.com/address/0xF7820030D3545532F4E4BedD6114c3bAFE600285)
- **Chain ID**: 143

### Testnet
- **GameFactory**: `0x9dD52149f89cbc404870Fc17B0BeC800D701768d`
- **Explorer**: [testnet.monadexplorer.com](https://testnet.monadexplorer.com/address/0x9dD52149f89cbc404870Fc17B0BeC800D701768d)
- **Chain ID**: 10143

### Contract Architecture

- **GameFactory.sol** — Factory pattern: creates and tracks MafiaGame instances
- **MafiaGame.sol** — Per-game: entry fees, wagers, commit-reveal role verification, reward distribution

**Reward Split**: 70% winners / 10% consolation / 15% platform / 3% burn / 2% host

**Commit-Reveal**: Roles are hashed and committed on-chain at game start, then revealed after game ends — trustless verification that roles weren't manipulated.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Blockchain** | Monad (EVM, 10K+ TPS) | High throughput for real-time game transactions |
| **Smart Contracts** | Solidity 0.8.24 | Factory pattern + commit-reveal for trustless games |
| **Backend** | Node.js, TypeScript, Fastify | Fast async HTTP + WebSocket |
| **AI** | Multi-provider (Gemini, Claude, OpenAI, OpenRouter) | Flexibility, no vendor lock-in |
| **Blockchain SDK** | ethers.js v6 | Standard EVM interaction |
| **Frontend** | Vanilla HTML/CSS/JS | Zero build step, instant load |
| **Testing** | Vitest (162 tests, 7 suites) | Fast, native ESM support |

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# AI Provider (choose one): openrouter | gemini | anthropic | openai
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your-key-here

# Blockchain (Monad)
# Testnet: https://testnet-rpc.monad.xyz  |  Mainnet: https://rpc.monad.xyz
MONAD_RPC_URL=https://rpc.monad.xyz
MONAD_EXPLORER_URL=https://monadvision.com
DEPLOYER_PRIVATE_KEY=0x...
FACTORY_CONTRACT_ADDRESS=0xF7820030D3545532F4E4BedD6114c3bAFE600285
```

---

Built for [Monad Madness Hackathon 2026](https://monad.xyz) — Monad Blockchain
