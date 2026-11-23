/* ===== scripts/online-flow.cjs — 線上瀏覽器流程（開發用，需要 playwright）=====
 * 自己啟動兩個伺服器程序（同一個 SQLite 檔），用兩個瀏覽器分頁實際點畫面：
 *   大廳 → 開房（組隊＋輪流出題）→ 邀請連結加入 → 選隊、準備 → 開始 → 出題者鎖密碼 → 倒數 → 點格子猜 → 道具指定（自訂選單）
 *   → 重新整理回到原座位 → 強制終止伺服器 55 秒後重啟 → 兩人回到同一房號、座位與已確認的猜測 → 打完 → 結算 overlay → 再來一局
 * 用法：node scripts/online-flow.cjs        （SKIP_RESTART=1 可略過重啟那段，省 1 分鐘）
 */
'use strict';
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = 3191;
const BASE = 'http://localhost:' + PORT + '/';
const DB = path.join(os.tmpdir(), 'uc-flow-' + Date.now() + '.db');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let proc = null;
function startServer() {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), UC_ROOM_DB_PATH: DB, UC_COUNTDOWN_MS: '800', UC_BETWEEN_MS: '800', NODE_NO_WARNINGS: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', d => process.stderr.write('[server] ' + d));
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function poll() { fetch(BASE + 'health').then(r => r.ok ? res() : setTimeout(poll, 200)).catch(() => Date.now() - t0 > 10000 ? rej(new Error('server 沒起來')) : setTimeout(poll, 200)); })();
  });
}
function killServer() { return new Promise(r => { proc.once('exit', r); proc.kill('SIGKILL'); }); }

async function waitFor(p, fn, arg, ms) { return p.waitForFunction(fn, arg, { timeout: ms || 8000 }); }
const roomOf = p => p.evaluate(() => OnlineUI.room && JSON.parse(JSON.stringify(OnlineUI.room)));

(async () => {
  await startServer();
  const browser = await chromium.launch();
  const errors = [];
  async function page(name, vw) {
    const ctx = await browser.newContext({ viewport: vw || { width: 1180, height: 820 } });
    await ctx.addInitScript(n => { try { if (!localStorage.getItem('ultimate-code:v1')) localStorage.setItem('ultimate-code:v1', JSON.stringify({ nickname: n })); } catch (e) {} }, name);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    return p;
  }
  const A = await page('房主小金'), B = await page('藍隊小明', { width: 390, height: 844 }), C = await page('紅隊小美');
  await A.goto(BASE); await A.click('#h-online');
  await waitFor(A, () => Net.status === 'open');
  /* 開房：組隊＋隊友輪流出題＋3 局，透過自訂表單 */
  await A.click('#lb-create');
  await A.click('#cs-setter [data-v="player"]');
  await A.click('#cs-teams');
  await A.click('#cs-rounds [data-v="3"]');
  await A.click('.create-modal .modal-foot .btn.primary');
  await waitFor(A, () => App.screen === 'room');
  const r0 = await roomOf(A);
  assert.ok(r0.settings.teams && r0.settings.setterMode === 'player' && r0.settings.rounds === 3, '開房設定生效');
  const invite = await A.evaluate(() => document.querySelector('.invite-url').textContent);
  assert.ok(/room=/.test(invite) && /invite=/.test(invite));
  /* 邀請連結加入（手機寬度） */
  await B.goto(invite.replace('http://localhost:' + PORT + '/', BASE));
  await waitFor(B, () => App.screen === 'room', null, 10000);
  await C.goto(invite.replace('http://localhost:' + PORT + '/', BASE));
  await waitFor(C, () => App.screen === 'room', null, 10000);
  /* B 選藍隊、C 選紅隊；都按準備 */
  await B.click('[data-team="blue"]'); await sleep(200);
  await C.click('[data-team="red"]'); await sleep(200);
  await B.click('#rm-ready'); await C.click('#rm-ready');
  await waitFor(A, () => !document.getElementById('rm-start').disabled);
  await A.click('#rm-start');
  await waitFor(A, () => App.screen === 'game');
  await waitFor(B, () => App.screen === 'game');
  /* 出題者鎖密碼 */
  const pages = [A, B, C];
  let setterPage = null;
  for (const p of pages) if (await p.evaluate(() => { const r = OnlineUI.room; return r.match.phase === 'set' && r.match.game.setter === r.you.seat; })) setterPage = p;
  assert.ok(setterPage, '有人是出題者');
  for (const p of pages) if (p !== setterPage) assert.strictEqual(await p.evaluate(() => OnlineUI.room.match.game.secret), null, '非出題者看不到密碼');
  await setterPage.click('.cell[data-v="37"]');
  await setterPage.click('#k-submit');
  await waitFor(A, () => OnlineUI.room.match.phase === 'play');
  assert.ok(await A.evaluate(() => !document.getElementById('countdown').hidden), '鎖定後倒數');
  await sleep(1000);
  /* 輪到的人點格子猜 */
  async function turnPage() {
    for (const p of pages) if (await p.evaluate(() => { const r = OnlineUI.room; return r && r.match && r.match.game && r.match.game.current === r.you.seat && r.status === 'playing'; })) return p;
    return null;
  }
  let tp = await turnPage();
  await tp.click('.cell[data-v="10"]');
  await tp.click('#k-submit');
  await waitFor(A, () => OnlineUI.room.match.game.history.length === 1);
  const g1 = (await roomOf(A)).match.game;
  assert.deepStrictEqual([g1.lo, g1.hi], [11, 100], '猜 10 → 範圍 11～100');
  /* 下一位用「指定」：自訂選單選人 */
  tp = await turnPage();
  await tp.click('[data-item="assign"]');
  await tp.waitForSelector('.menu-pop .menu-opt');
  await tp.click('.menu-pop .menu-opt');
  await waitFor(A, () => OnlineUI.room.match.game.history.length === 2);
  assert.strictEqual((await roomOf(A)).match.game.history[1].item, 'assign');
  /* 重新整理：回到原座位 */
  const seatB = (await roomOf(B)).you.seat;
  await B.reload();
  await waitFor(B, () => App.screen === 'game' && OnlineUI.room, null, 10000);
  assert.strictEqual((await roomOf(B)).you.seat, seatB, '重新整理回到原座位');

  if (!process.env.SKIP_RESTART) {
    /* 強制終止伺服器 55 秒，再用同一個 SQLite 重啟 */
    const before = (await roomOf(A)).match.game;
    await killServer();
    await sleep(2500);
    assert.ok(await A.evaluate(() => !!OnlineUI.room), '停機時客戶端保留房間');
    await sleep(52500);
    await startServer();
    for (const p of pages) await waitFor(p, () => Net.status === 'open' && OnlineUI.room && !OnlineUI.room.recovering, null, 30000);
    const after = (await roomOf(A)).match.game;
    assert.deepStrictEqual([after.lo, after.hi, after.history.length, after.current], [before.lo, before.hi, before.history.length, before.current], '重啟後局面一致');
    assert.strictEqual((await roomOf(B)).you.seat, seatB, '重啟後座位一致');
    /* 重啟後也重新整理一次 */
    await C.reload();
    await waitFor(C, () => App.screen === 'game' && OnlineUI.room && Net.status === 'open', null, 15000);
  }

  /* 打完三局：輪到的人一直猜下限 */
  for (let guard = 0; guard < 300; guard++) {
    const st = await A.evaluate(() => OnlineUI.room && OnlineUI.room.status);
    if (st === 'finished') break;
    const r = await roomOf(A);
    if (r.status === 'playing' && r.match.phase === 'set') {
      for (const p of pages) if (await p.evaluate(() => { const r = OnlineUI.room; return r.match.phase === 'set' && r.match.game.setter === r.you.seat; })) await p.evaluate(() => Net.send({ type: 'secret', value: 50 }));
      await sleep(300); continue;
    }
    tp = await turnPage();
    if (tp) await tp.evaluate(() => { const g = OnlineUI.room.match.game; if (Date.now() >= OnlineUI.room.match.goAt - 1000) Net.send({ type: 'act', kind: 'guess', value: g.lo }); });
    await sleep(260);
  }
  await waitFor(A, () => Result.visible(), null, 10000);
  assert.strictEqual(await A.evaluate(() => document.querySelectorAll('.res-actions button').length), 3);
  assert.ok(await A.evaluate(() => document.querySelectorAll('.res-ranks li').length === 3), '結算列出三人');
  const hitsTotal = await A.evaluate(() => Object.values(OnlineUI.room.match.hits).reduce((a, b) => a + b, 0));
  assert.strictEqual(hitsTotal, 3, '三局三次中標');
  assert.ok(await A.evaluate(() => Store.get('stats').online.games === 1), '線上戰績記錄一次');
  /* 再來一局：B、C 按準備下一局，房主再來一局 */
  await waitFor(B, () => Result.visible(), null, 10000);
  await B.click('[data-act="again"]');
  await waitFor(C, () => Result.visible(), null, 10000);
  await C.click('[data-act="again"]');
  await sleep(400);
  await A.click('[data-act="again"]');
  await waitFor(A, () => OnlineUI.room.match.no === 2 && App.screen === 'game', null, 8000);
  assert.ok(!(await A.evaluate(() => Result.visible())), '新的一場沒有殘留結算');

  assert.deepStrictEqual(errors, [], 'JS 錯誤：' + errors.join(' | '));
  console.log('線上瀏覽器流程通過');
  await browser.close();
  await killServer();
  for (const f of [DB, DB + '-wal', DB + '-shm']) try { fs.unlinkSync(f); } catch (e) { /* 忽略 */ }
})().catch(async e => { console.error(e); try { await killServer(); } catch (er) { /* 忽略 */ } process.exit(1); });
