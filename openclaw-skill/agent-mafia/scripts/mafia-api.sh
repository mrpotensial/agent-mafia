#!/usr/bin/env bash
# Agent Mafia API Helper Script
# Usage: mafia-api.sh <command> [args...]
#
# Commands:
#   list                          List all games
#   create [players] [fee]        Create a new game (default: 5 players, 0.1 fee)
#   get <game-id>                 Get game state
#   start <game-id> <token>       Start a game (master token required)
#   run [players]                 Create + fill + start a game (one-shot)
#   wager <game-id> <prediction>  Place a team wager (village/mafia)
#   events <game-id>              Get game events
#   results <game-id>             Get final game results
#   health                        Check server health
#   join <game-id> [name]         Join game as external player
#   turn <game-id> <token>        Check if it's your turn
#   act <game-id> <token> <type> <value>  Submit an action

set -euo pipefail

API_URL="${AGENT_MAFIA_URL:-http://localhost:3000}"

# Pretty-print JSON (try python3, python, then raw output)
pretty() {
  python3 -m json.tool 2>/dev/null || python -m json.tool 2>/dev/null || tee
}

case "${1:-help}" in
  list)
    curl -s "$API_URL/api/games" | pretty
    ;;
  create)
    PLAYERS="${2:-5}"
    FEE="${3:-0.1}"
    curl -s "$API_URL/api/games" \
      -X POST -H "Content-Type: application/json" \
      -d "{\"playerCount\": $PLAYERS, \"entryFee\": $FEE}" | pretty
    ;;
  get)
    if [ -z "${2:-}" ]; then echo "Usage: mafia-api.sh get <game-id>"; exit 1; fi
    curl -s "$API_URL/api/games/$2" | pretty
    ;;
  start)
    if [ -z "${2:-}" ] || [ -z "${3:-}" ]; then
      echo "Usage: mafia-api.sh start <game-id> <master-token>"; exit 1
    fi
    curl -s "$API_URL/api/games/$2/start" \
      -X POST -H "Content-Type: application/json" \
      -d "{\"masterToken\": \"$3\"}" | pretty
    ;;
  run)
    PLAYERS="${2:-5}"
    # Create game
    RESP=$(curl -s "$API_URL/api/games" \
      -X POST -H "Content-Type: application/json" \
      -d "{\"playerCount\": $PLAYERS, \"entryFee\": 0.1}")
    GAME_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['gameId'])" 2>/dev/null)
    TOKEN=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['masterToken'])" 2>/dev/null)
    echo "Created game: $GAME_ID"
    # Autofill
    curl -s "$API_URL/api/games/$GAME_ID/autofill" -X POST | pretty
    # Start
    echo "Starting game..."
    curl -s "$API_URL/api/games/$GAME_ID/start" \
      -X POST -H "Content-Type: application/json" \
      -d "{\"masterToken\": \"$TOKEN\"}" | pretty
    ;;
  wager)
    if [ -z "${2:-}" ] || [ -z "${3:-}" ]; then
      echo "Usage: mafia-api.sh wager <game-id> <village|mafia> [amount]"; exit 1
    fi
    AMOUNT="${4:-0.1}"
    curl -s "$API_URL/api/games/$2/wager" \
      -X POST -H "Content-Type: application/json" \
      -d "{\"bettorId\": \"openclaw-agent\", \"prediction\": \"$3\", \"amount\": $AMOUNT}" | pretty
    ;;
  events)
    if [ -z "${2:-}" ]; then echo "Usage: mafia-api.sh events <game-id>"; exit 1; fi
    curl -s "$API_URL/api/games/$2/events" | pretty
    ;;
  results)
    if [ -z "${2:-}" ]; then echo "Usage: mafia-api.sh results <game-id>"; exit 1; fi
    curl -s "$API_URL/api/games/$2" | pretty
    ;;
  health)
    curl -s "$API_URL/health" | pretty
    ;;
  join)
    if [ -z "${2:-}" ]; then echo "Usage: mafia-api.sh join <game-id> [name]"; exit 1; fi
    NAME="${3:-OpenClaw}"
    curl -s "$API_URL/api/games/$2/join" \
      -X POST -H "Content-Type: application/json" \
      -d "{\"name\": \"$NAME\"}" | pretty
    ;;
  turn)
    if [ -z "${2:-}" ] || [ -z "${3:-}" ]; then
      echo "Usage: mafia-api.sh turn <game-id> <player-token>"; exit 1
    fi
    curl -s "$API_URL/api/games/$2/my-turn" \
      -H "Authorization: Bearer $3" | pretty
    ;;
  act)
    if [ -z "${2:-}" ] || [ -z "${3:-}" ] || [ -z "${4:-}" ] || [ -z "${5:-}" ]; then
      echo "Usage: mafia-api.sh act <game-id> <player-token> <statement|vote|night_action> <value>"; exit 1
    fi
    curl -s "$API_URL/api/games/$2/action" \
      -X POST -H "Content-Type: application/json" \
      -H "Authorization: Bearer $3" \
      -d "{\"actionType\": \"$4\", \"value\": \"$5\"}" | pretty
    ;;
  help|*)
    echo "Agent Mafia API Helper"
    echo ""
    echo "Usage: mafia-api.sh <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  list                              List all games"
    echo "  create [players] [fee]            Create a new game"
    echo "  get <game-id>                     Get game state"
    echo "  start <game-id> <token>           Start a game"
    echo "  run [players]                     One-shot: create + fill + start"
    echo "  wager <game-id> <team> [amount]   Place a team wager"
    echo "  events <game-id>                  Get game events"
    echo "  results <game-id>                 Get game results"
    echo "  health                            Check server health"
    echo "  join <game-id> [name]             Join as external player"
    echo "  turn <game-id> <token>            Check if it's your turn"
    echo "  act <game-id> <token> <type> <v>  Submit an action"
    echo ""
    echo "Environment:"
    echo "  AGENT_MAFIA_URL  API endpoint (default: http://localhost:3000)"
    ;;
esac
