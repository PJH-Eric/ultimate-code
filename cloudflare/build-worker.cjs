'use strict';

const fs = require('node:fs');
const path = require('node:path');
const games = require('./games.cjs');

const repoRoot = path.resolve(__dirname, '..');
/* 遊戲 ID：GAME_ID → repo 資料夾名稱 → wrangler.toml 的 Worker 名稱去掉 -backup。
   Cloudflare Workers Builds 會把 repo 複製到名叫 repo 的資料夾，所以需要最後這一層。 */
function idFromWrangler() {
  try {
    const m = fs.readFileSync(path.join(repoRoot, 'wrangler.toml'), 'utf8').match(/^name\s*=\s*"([^"]+)"/m);
    return m ? m[1].replace(/-backup$/, '') : '';
  } catch (e) { return ''; }
}
const folderId = path.basename(repoRoot);
const gameId = process.env.GAME_ID || (games[folderId] ? folderId : idFromWrangler());

if (!games[gameId]) throw new Error('No Cloudflare backend is configured for ' + gameId);

process.env.GAME_SOURCE_DIR = repoRoot;
process.env.GAME_NODE_MODULES = process.env.GAME_NODE_MODULES || path.join(__dirname, 'node_modules');

const { buildGame } = require('./build.cjs');

buildGame(gameId).then(code => {
  const outputFile = path.join(__dirname, 'dist', 'worker.mjs');
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, code, 'utf8');
  process.stdout.write('Built Cloudflare backend for ' + gameId + '\n');
}).catch(error => {
  process.stderr.write((error.stack || error.message) + '\n');
  process.exitCode = 1;
});
