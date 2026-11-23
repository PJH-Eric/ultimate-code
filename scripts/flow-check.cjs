/* ===== scripts/flow-check.cjs — 瀏覽器流程檢查（開發用，需要 playwright 與執行中的伺服器）=====
 * 單人：破解完整一局（二分法）→ 結算 → 再來一局（重新倒數、新 matchId）；踩點最短路線過關；踩雷失敗；
 * 紀錄去重；切換語言不清空選取；首頁與單人沒有任何後端連線（不 ping、不連 WebSocket）。
 */
'use strict';
const assert = require('assert');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3110/';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const p = await ctx.newPage();
  const errors = [], net = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('request', r => { const u = r.url(); if (/\/health|\/ws|\/api\//.test(u)) net.push(u); });
  p.on('websocket', ws => net.push('ws:' + ws.url()));
  await p.goto(BASE);
  await p.waitForTimeout(300);

  /* 破解：倒數期間不能操作 */
  await p.evaluate(() => Solo.start({ kind: 'crack', seed: 'flow-1' }));
  assert.ok(await p.evaluate(() => !document.getElementById('countdown').hidden), '開局有倒數');
  assert.strictEqual(await p.evaluate(() => GameView.vm.canAct), false, '倒數中不能操作');
  await p.waitForTimeout(3300);
  assert.strictEqual(await p.evaluate(() => GameView.vm.canAct), true, '倒數結束可以操作');
  const id1 = await p.evaluate(() => Solo.active.id);
  /* 選一個數字後切換語言，選取不會被清掉 */
  await p.evaluate(() => GameView._pick(50));
  await p.evaluate(() => I18N.setLang('en'));
  assert.ok(await p.evaluate(() => document.querySelector('.cell.sel') && document.querySelector('.cell.sel').textContent === '50'), '切換語言後選取還在');
  await p.evaluate(() => I18N.setLang('zh-Hant'));
  /* 二分法一定 7 次內猜中 */
  const n = await p.evaluate(() => { let c = 0; while (!Solo.active.st.over && c < 20) { const s = Solo.active.st; const m = (s.lo + s.hi) >> 1; GameView._pick(m); GameView._submit(); c++; } return c; });
  assert.ok(n <= 7, '二分法 ' + n + ' 次');
  await p.waitForTimeout(1300);
  assert.ok(await p.evaluate(() => Result.visible()), '出現結算');
  assert.strictEqual(await p.evaluate(() => document.querySelectorAll('.res-actions button').length), 3, '結算三顆按鈕');
  assert.ok(await p.evaluate(() => document.querySelector('[data-act="room"]').disabled), '單人「回到房間」停用');
  assert.strictEqual(await p.evaluate(() => Store.get('stats').crack.wins), 1);
  /* 重複結算不重複計 */
  assert.strictEqual(await p.evaluate(() => Store.recordMatch({ id: Solo.active.id, kind: 'crack', result: 'win', metric: 3 }).counted), false, '同一個 matchId 不重複計');
  await p.waitForTimeout(400);
  assert.ok(await p.evaluate(() => !!document.querySelector('.res-main .result-share')), '結算有分享按鈕');
  await p.click('[data-act="again"]');
  await p.waitForTimeout(200);
  assert.ok(await p.evaluate(() => !Result.visible() && !document.getElementById('countdown').hidden), '再來一局重新倒數');
  const id2 = await p.evaluate(() => Solo.active.id);
  assert.notStrictEqual(id1, id2, '再來一局換新 matchId');
  assert.strictEqual(await p.evaluate(() => Solo.active.st.history.length), 0, '再來一局歸零');
  assert.strictEqual(await p.evaluate(() => document.querySelectorAll('#history .h-row').length), 0, '紀錄清空');

  /* 踩點：最短路線（BFS）過關＝3 星 */
  await p.evaluate(() => Solo.start({ kind: 'step', skipCountdown: true, seed: 'flow-2' }));
  const stars = await p.evaluate(() => {
    const st = Solo.active.st, bad = new Set(st.mines);
    const prev = { 0: null }, q = [0];
    while (q.length) { const v = q.shift(); for (const k of [1, 2, 3]) { const w = v + k; if (w > 100 || bad.has(w) || w in prev) continue; prev[w] = v; q.push(w); } }
    const path = []; for (let v = 100; v; v = prev[v]) path.unshift(v);
    let at = 0; for (const v of path) { GameView._add(v - at); at = v; }
    return [st.won, st.steps, st.best, st.stars];
  });
  assert.deepStrictEqual([stars[0], stars[1] === stars[2], stars[3]], [true, true, 3], '最短路線 3 星：' + stars);
  await p.waitForTimeout(1200);
  assert.ok(await p.evaluate(() => Result.visible() && document.querySelector('.res-badges') !== null), '過關結算顯示新成就');
  assert.ok(await p.evaluate(() => !!Store.get('ach').step_perfect), '解鎖最短路線成就');

  /* 踩雷失敗 */
  await p.evaluate(() => Solo.start({ kind: 'step', skipCountdown: true, seed: 'flow-3' }));
  await p.evaluate(() => { const st = Solo.active.st; const m = st.mines[0]; let guard = 0; while (!st.over && guard++ < 60) { const left = m - st.total; if (left <= 3) { GameView._add(left); break; } let k = 3; while (k > 1 && st.mines.includes(st.total + k)) k--; GameView._add(k); } });
  assert.strictEqual(await p.evaluate(() => Solo.active.st.fail), 'mine');
  await p.waitForTimeout(1600);
  assert.ok(await p.evaluate(() => document.querySelector('[data-act="again"]').textContent.length > 0 && Result.visible()));

  /* 離開確認：進行中按返回會先問 */
  await p.evaluate(() => Solo.start({ kind: 'crack', skipCountdown: true, seed: 'flow-4' }));
  await p.evaluate(() => { const s = Solo.active.st; GameView._pick(s.secret === 50 ? 51 : 50); GameView._submit(); });
  await p.click('#btn-back');
  await p.waitForTimeout(250);
  assert.ok(await p.evaluate(() => !!document.querySelector('.modal')), '進行中離開會先確認');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  assert.strictEqual(await p.evaluate(() => App.screen), 'game', 'Esc 取消後留在遊戲');

  /* 鍵盤輸入：打 4、2、Enter */
  await p.evaluate(() => Solo.start({ kind: 'crack', skipCountdown: true, seed: 'flow-5' }));
  await p.keyboard.type('42'); await p.keyboard.press('Enter');
  await p.waitForTimeout(100);
  assert.strictEqual(await p.evaluate(() => Solo.active.st.history[0] && Solo.active.st.history[0].value), 42, '鍵盤輸入可以猜');

  assert.deepStrictEqual(net, [], '首頁與單人沒有後端連線：' + net.join(','));
  assert.deepStrictEqual(errors, [], 'JS 錯誤：' + errors.join(' | '));
  console.log('單人流程檢查通過');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
