#!/bin/bash
# ╔══════════════════════════════════════════════════╗
# ║     Agent Mafia — VPS Deploy Script              ║
# ║     Safe: does NOT touch existing OpenClaw       ║
# ╚══════════════════════════════════════════════════╝
#
# Usage (run from project root):
#   bash scripts/deploy-vps.sh
#
# Prerequisites:
#   - .env file must exist (copy from .env.example)
#   - Git repo already cloned

set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_DIR="$HOME/.openclaw/workspace/skills/agent-mafia"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     Agent Mafia — VPS Deploy                     ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Project dir: $APP_DIR"
echo ""

# ─── 1. Check Node.js 22+ ────────────────────────────────
echo "[1/7] Checking Node.js..."

if ! command -v node &>/dev/null; then
  echo "  Node.js not found. Installing Node.js 22..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    yum install -y nodejs
  else
    echo "  ERROR: Cannot auto-install Node.js. Install Node.js 22+ manually."
    echo "  https://nodejs.org/en/download/"
    exit 1
  fi
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 22 ]; then
  echo "  ERROR: Node.js 22+ required for native fetch API."
  echo "  Current: $(node -v)"
  echo "  Install: https://nodejs.org/en/download/"
  exit 1
fi
echo "  Node.js $(node -v) — OK"

# ─── 2. Install pm2 (process manager) ────────────────────
echo "[2/7] Checking pm2..."

if ! command -v pm2 &>/dev/null; then
  echo "  Installing pm2..."
  npm install -g pm2
fi
echo "  pm2 $(pm2 -v) — OK"

# ─── 3. Install dependencies ─────────────────────────────
echo "[3/7] Installing dependencies..."
cd "$APP_DIR"
npm install
echo "  Dependencies installed — OK"

# ─── 4. Build TypeScript ─────────────────────────────────
echo "[4/7] Building TypeScript..."
npm run build
echo "  Build complete — OK"

# ─── 5. Check .env ───────────────────────────────────────
echo "[5/7] Checking .env..."
mkdir -p "$APP_DIR/data"

if [ ! -f "$APP_DIR/.env" ]; then
  if [ -f "$APP_DIR/.env.example" ]; then
    echo "  WARNING: No .env found. Copying from .env.example..."
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    echo "  IMPORTANT: Edit .env and set your API key!"
    echo "    nano $APP_DIR/.env"
    echo ""
    echo "  Then re-run this script."
    exit 1
  else
    echo "  ERROR: No .env or .env.example found."
    exit 1
  fi
fi

# Quick validation: check if API key is set
if grep -q "YOUR_API_KEY_HERE" "$APP_DIR/.env" 2>/dev/null; then
  echo "  ERROR: .env still has placeholder API key. Edit it first:"
  echo "    nano $APP_DIR/.env"
  exit 1
fi
echo "  .env exists — OK"

# ─── 6. Start server with pm2 ────────────────────────────
echo "[6/7] Starting server..."

# Stop existing instance if running
pm2 stop agent-mafia 2>/dev/null || true
pm2 delete agent-mafia 2>/dev/null || true

# Start fresh
cd "$APP_DIR"
pm2 start dist/api/server.js --name agent-mafia --cwd "$APP_DIR"
pm2 save --force

echo "  Server started — OK"

# ─── 7. Install OpenClaw skill ───────────────────────────
echo "[7/7] Installing OpenClaw skill..."

if [ -d "$HOME/.openclaw" ]; then
  mkdir -p "$SKILL_DIR"
  cp -r "$APP_DIR/openclaw-skill/"* "$SKILL_DIR/"
  echo "  Skill installed at $SKILL_DIR — OK"
else
  echo "  OpenClaw not found at ~/.openclaw — skipping skill install"
  echo "  (You can manually copy later: cp -r openclaw-skill/ ~/.openclaw/workspace/skills/agent-mafia/)"
fi

# ─── Health Check ─────────────────────────────────────────
echo ""
echo "Waiting for server to start..."
sleep 3

if curl -sf http://127.0.0.1:3000/health > /dev/null 2>&1; then
  PUBLIC_IP=$(curl -sf ifconfig.me 2>/dev/null || echo "unknown")
  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║           DEPLOY SUCCESS!                        ║"
  echo "╠══════════════════════════════════════════════════╣"
  echo "║  Local:    http://127.0.0.1:3000                 ║"
  echo "║  Public:   http://$PUBLIC_IP:3000"
  echo "║  Frontend: http://$PUBLIC_IP:3000"
  echo "║                                                  ║"
  echo "║  pm2 status           — check process            ║"
  echo "║  pm2 logs agent-mafia — view logs                ║"
  echo "║  pm2 restart agent-mafia — restart               ║"
  echo "║                                                  ║"
  echo "║  OpenClaw: skill ready for use                   ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""
  echo "Test OpenClaw integration:"
  echo "  node $SKILL_DIR/scripts/run-game.js --players 5"
  echo ""
else
  echo ""
  echo "ERROR: Health check failed!"
  echo "Check logs: pm2 logs agent-mafia"
  echo ""
  pm2 logs agent-mafia --lines 20 --nostream
  exit 1
fi
