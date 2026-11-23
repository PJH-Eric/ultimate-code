/* ===== scripts/flow-check.cjs — 瀏覽器流程檢查（開發用，需要 playwright 與執行中的伺服器）=====
 * 單人（規則同線上，可收手）：一般．單人收手計分 → 結算 → 分享圖片（Esc 只關分享）→ 再來一局（重新倒數、新 matchId）；
 * 猜中密碼 → 全螢幕爆炸播完才出結算、分數 0；累加．單人按鈕列出會踩到的數字、跨過地雷爆炸、收手計分；
 * 紀錄去重；切換語言不清空選取；鍵盤輸入；首頁與單人沒有任何後端連線。
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

  /* 一般．單人：倒數期間不能操作 */
  await p.evaluate(() => Solo.start({ kind: 'crack', secret: 40 }));
  assert.ok(await p.evaluate(() => !document.getElementById('countdown').hidden), '開局有倒數');
  assert.strictEqual(await p.evaluate(() => GameView.vm.canAct), false, '倒數中不能操作');
  assert.ok(await p.evaluate(() => document.getElementById('k-bank').disabled), '還沒猜就不能收手');
  await p.waitForTimeout(3300);
  const id1 = await p.evaluate(() => Solo.active.id);
  await p.evaluate(() => GameView._pick(20));
  await p.evaluate(() => I18N.setLang('en'));
  assert.ok(await p.evaluate(() => document.querySelector('.cell.sel') && document.querySelector('.cell.sel').textContent === '20'), '切換語言後選取還在');
  await p.evaluate(() => I18N.setLang('zh-Hant'));
  await p.evaluate(() => GameView._submit());          // 20 太小：排除 1～20
  await p.evaluate(() => { GameView._pick(70); GameView._submit(); });   // 70 太大：排除 70～100
  assert.strictEqual(await p.evaluate(() => GameView.vm.bankScore), 51, '目前分數＝排除 51 個數字');
  await p.click('#k-bank');
  await p.waitForTimeout(1200);
  assert.ok(await p.evaluate(() => Result.visible()), '收手後出現結算');
  assert.strictEqual(await p.evaluate(() => Store.get('stats').crack.best), 51);
  assert.strictEqual(await p.evaluate(() => document.querySelectorAll('.res-actions button').length), 3, '結算三顆按鈕');
  assert.ok(await p.evaluate(() => document.querySelector('[data-act="room"]').disabled), '單人「回到房間」停用');
  assert.strictEqual(await p.evaluate(() => Store.recordMatch({ id: Solo.active.id, kind: 'crack', result: 'win', metric: 99 }).counted), false, '同一個 matchId 不重複計');
  /* 分享圖片：Esc 只關分享視窗 */
  await p.waitForTimeout(300);
  await p.click('.result-share-trigger');
  await p.waitForSelector('.result-share-dialog-layer:not([hidden]) .result-share-image', { timeout: 15000 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  assert.ok(await p.evaluate(() => !document.querySelector('.result-share-dialog-layer:not([hidden])') && Result.visible()), 'Esc 只關分享視窗、結算仍在');
  /* 再來一局 */
  await p.click('[data-act="again"]');
  await p.waitForTimeout(200);
  assert.ok(await p.evaluate(() => !Result.visible() && !document.getElementById('countdown').hidden), '再來一局重新倒數');
  assert.notStrictEqual(await p.evaluate(() => Solo.active.id), id1, '再來一局換新 matchId');
  assert.strictEqual(await p.evaluate(() => document.querySelectorAll('#history .h-row').length), 0, '紀錄清空');

  /* 猜中密碼：全螢幕爆炸播完才出結算，分數 0 */
  await p.evaluate(() => Solo.start({ kind: 'crack', skipCountdown: true, secret: 33 }));
  await p.evaluate(() => { GameView._pick(33); GameView._submit(); });
  await p.waitForTimeout(150);
  assert.ok(await p.evaluate(() => !!document.getElementById('boom-layer')), '踩中跳出全螢幕爆炸遮罩');
  assert.ok(await p.evaluate(() => !Result.visible()), '爆炸播放中還沒出結算');
  await p.waitForTimeout(2600);
  assert.ok(await p.evaluate(() => !document.getElementById('boom-layer') && Result.visible()), '爆炸播完才出結算');
  assert.strictEqual(await p.evaluate(() => Solo.active.st.score), 0);

  /* 累加．單人：按鈕列出會踩到的數字；跨過地雷爆炸 */
  await p.evaluate(() => Solo.start({ kind: 'step', skipCountdown: true, secret: 10 }));
  await p.evaluate(() => { GameView._add(3); GameView._add(3); GameView._add(3); });   // 9
  const on3 = await p.evaluate(() => [...document.querySelectorAll('[data-add="3"] .step-on i')].map(i => i.textContent).join(','));
  assert.strictEqual(on3, '10,11,12', '+3 按鈕列出 10、11、12');
  await p.evaluate(() => GameView._add(3));                                              // 9 → 12 跨過 10
  assert.ok(await p.evaluate(() => Solo.active.st.hit && !!document.getElementById('boom-layer')), '跨過地雷也爆炸');
  await p.waitForTimeout(2600);
  assert.ok(await p.evaluate(() => Result.visible()));
  /* 累加．單人收手 */
  await p.evaluate(() => Solo.start({ kind: 'step', skipCountdown: true, secret: 100 }));
  await p.evaluate(() => { for (let i = 0; i < 24; i++) GameView._add(3); });             // 72
  await p.click('#k-bank');
  await p.waitForTimeout(1200);
  assert.deepStrictEqual(await p.evaluate(() => [Solo.active.st.score, Solo.active.st.stars]), [72, 3], '收手 72 分 3 星');
  assert.ok(await p.evaluate(() => !!Store.get('ach').step_3star), '解鎖累加 3 星成就');

  /* 離開確認：進行中按返回會先問 */
  await p.evaluate(() => Solo.start({ kind: 'crack', skipCountdown: true, secret: 77 }));
  await p.evaluate(() => { GameView._pick(10); GameView._submit(); });
  await p.click('#btn-back');
  await p.waitForTimeout(250);
  assert.ok(await p.evaluate(() => !!document.querySelector('.modal')), '進行中離開會先確認');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  assert.strictEqual(await p.evaluate(() => App.screen), 'game', 'Esc 取消後留在遊戲');

  /* 鍵盤輸入：打 4、2、Enter */
  await p.evaluate(() => Solo.start({ kind: 'crack', skipCountdown: true, secret: 90 }));
  await p.keyboard.type('42'); await p.keyboard.press('Enter');
  await p.waitForTimeout(100);
  assert.strictEqual(await p.evaluate(() => Solo.active.st.history[0] && Solo.active.st.history[0].value), 42, '鍵盤輸入可以猜');

  assert.deepStrictEqual(net, [], '首頁與單人沒有後端連線：' + net.join(','));
  assert.deepStrictEqual(errors, [], 'JS 錯誤：' + errors.join(' | '));
  console.log('單人流程檢查通過');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
