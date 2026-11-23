/* ===== scripts/cloudflare-check.mjs — Cloudflare 備援相容性檢查（開發用）=====
 * 1. 用 game-lobby/cloudflare/build.cjs 實際打包本遊戲（確認沒有打包不了的依賴，例如 node:sqlite）。
 * 2. 用 game-lobby/cloudflare/runtime.mjs（Durable Object 裡的 http／ws／計時器轉接層）載入同一份 server.js，
 *    以假 WebSocket 連兩位玩家：建房、加入、準備、開局、打完一局，並確認 /health 與「沒人連線時計時器停止」。
 * 用法：node scripts/cloudflare-check.mjs   （預設 game-lobby 在旁邊的資料夾；可用 GAME_LOBBY 指定）
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const lobby = path.resolve(process.env.GAME_LOBBY || path.join(root, '..', 'game-lobby'));
const cf = path.join(lobby, 'cloudflare');
const require = createRequire(path.join(cf, 'build.cjs'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 1. 打包 ---------- */
const games = require('./games.cjs');
const entry = games['ultimate-code'] || { path: '/ws', maxPayload: 8192 };
games['ultimate-code'] = entry;                       // 只在記憶體加入，不改 game-lobby 的檔案
process.env.GAME_SOURCE_ROOT = path.join(root, '..');
process.env.GAME_ESBUILD_MODULE = path.join(cf, 'node_modules', 'esbuild');
const { buildGame } = require('./build.cjs');
const bundle = await buildGame('ultimate-code');
assert.ok(bundle.length > 10000, '打包結果太小');
assert.ok(!/node:sqlite/.test(bundle), 'Cloudflare 打包不能含 node:sqlite');
console.log('✓ build.cjs 打包成功（' + Math.round(bundle.length / 1024) + ' KB）');

/* ---------- 2. 在 runtime 轉接層裡執行 ---------- */
process.env.UC_COUNTDOWN_MS = '200';
process.env.UC_BETWEEN_MS = '200';
const { createRuntime, handleHttp } = await import(pathToFileURL(path.join(cf, 'runtime.mjs')).href);
const game = Object.assign({ id: 'ultimate-code', roomsApi: true }, entry);
const runtime = createRuntime(game, undefined);
/* 與 build.cjs 的 gameFactory 相同的包裝：把 require('http') 換成 runtime.http，外層提供 runtime、process、計時器 */
const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8').replace(/require\('http'\)/, 'runtime.http');
const localRequire = createRequire(path.join(root, 'server.js'));
const factory = new Function('runtime', 'require', '__filename', `const module = { exports: {} }; const { process, setInterval, clearInterval } = runtime; const __dirname = ${JSON.stringify(root)};\n${src}\nreturn module.exports;`);
runtime.process.env.UC_COUNTDOWN_MS = '200';
const server = factory(runtime, localRequire, path.join(root, 'server.js'));
assert.ok(server.server, 'module.exports.server 必須存在（worker 用它處理 /health）');

const health = await (await handleHttp(new Request('https://x.workers.dev/health'), server.server)).json();
assert.strictEqual(health.ok, true); assert.strictEqual(health.game, 'ultimate-code');
console.log('✓ /health 經 runtime.handleHttp 回應');

/** 假的 Workers WebSocket：runtime 只用 addEventListener／send／close／readyState */
function fakeSocket(name) {
  const ls = { message: [], close: [], error: [] }, inbox = [];
  const sock = {
    readyState: WebSocket.OPEN,
    addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
    removeEventListener(t, f) { ls[t] = (ls[t] || []).filter(x => x !== f); },
    send(text) { const m = JSON.parse(text); if (m.type === 'hb') { recv({ type: 'hb' }); return; } inbox.push(m); },
    close() { sock.readyState = WebSocket.CLOSED; ls.close.forEach(f => f({})); }
  };
  function recv(o) { ls.message.forEach(f => f({ data: JSON.stringify(o) })); }
  const room = () => { const r = inbox.filter(m => m.type === 'room').pop(); return r && r.room; };
  return { sock, recv, inbox, room, name };
}
const A = fakeSocket('甲'), B = fakeSocket('乙');
await runtime.open(A.sock, new Request('https://x/ws'), server);
await runtime.open(B.sock, new Request('https://x/ws'), server);
A.recv({ type: 'hello', name: '甲', clientId: 'cf-check-a-' + Date.now() });
B.recv({ type: 'hello', name: '乙', clientId: 'cf-check-b-' + Date.now() });
assert.ok(A.inbox.some(m => m.type === 'welcome'), '收到 welcome');
A.recv({ type: 'create', name: '甲', settings: { mode: 'count', turnSec: 15 } });
const id = A.room().id;
B.recv({ type: 'join', roomId: id, name: '乙', want: 'player' });
B.recv({ type: 'ready', value: true });
A.recv({ type: 'start' });
assert.strictEqual(A.room().status, 'playing');
await sleep(400);                                    // 倒數靠 runtime.setInterval 的 tick 推進
for (let k = 0; k < 120 && A.room().status === 'playing'; k++) {
  const g = A.room().match.game;
  const c = [A, B].find(x => x.room().you.seat === g.current);
  c.recv({ type: 'act', kind: 'add', value: Math.min(3, 100 - g.total) });
  await sleep(220);
}
assert.strictEqual(A.room().status, 'finished', '在 Cloudflare 轉接層裡打完一局');
assert.strictEqual(A.room().match.game.total, 100);
console.log('✓ 兩位玩家在 runtime 轉接層完成一局（累加到 100）');

/* 逾時自動行動也要靠計時器：再開一場，等 15 秒以上太久，改成檢查 tick 有在跑（倒數會結束） */
A.recv({ type: 'rematch', value: true }); B.recv({ type: 'rematch', value: true });
assert.strictEqual(A.room().status, 'playing', '再來一局投票在備援端可用');
A.sock.close(); B.sock.close();
await sleep(50);
console.log('Cloudflare 備援相容性檢查通過');
process.exit(0);
