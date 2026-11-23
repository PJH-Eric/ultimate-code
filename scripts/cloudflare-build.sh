#!/usr/bin/env bash
# ===== scripts/cloudflare-build.sh — Cloudflare Workers Builds（Git 連線）用的建置指令 =====
# Dashboard → Workers & Pages → ultimate-code-backup → Settings → Build：
#   Build command:  bash scripts/cloudflare-build.sh
#   Deploy command: npx wrangler deploy --config cloudflare/wrangler.toml
# 做的事：取得 game-lobby 的共用打包器 → 把本 repo 打包成 cloudflare/dist/worker.mjs。
# 打包器要求「<根>/<遊戲名>/server.js」，Cloudflare 的複製目錄名稱不固定，所以在暫存根目錄建一個 ultimate-code 連結。
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${CF_BUILD_WORK:-$(mktemp -d)}"
LOBBY_REF="${GAME_LOBBY_REF:-main}"

if [ ! -d "$WORK/game-lobby/.git" ]; then
  git clone --depth 1 --branch "$LOBBY_REF" https://github.com/PJH-Eric/game-lobby.git "$WORK/game-lobby"
fi
( cd "$WORK/game-lobby/cloudflare" && npm ci --no-audit --no-fund )

mkdir -p "$WORK/src"
ln -sfn "$REPO" "$WORK/src/ultimate-code" 2>/dev/null || cp -r "$REPO" "$WORK/src/ultimate-code"
mkdir -p "$REPO/cloudflare/dist"
GAME_SOURCE_ROOT="$WORK/src" node "$WORK/game-lobby/cloudflare/build.cjs" ultimate-code "$REPO/cloudflare/dist/worker.mjs"
test -s "$REPO/cloudflare/dist/worker.mjs"
echo "✓ Worker 已打包：cloudflare/dist/worker.mjs（$(wc -c < "$REPO/cloudflare/dist/worker.mjs") bytes）"
