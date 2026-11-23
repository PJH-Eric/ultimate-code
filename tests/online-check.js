/* ===== tests/online-check.js — 線上端對端測試（真的開伺服器、用 WebSocket 連）=====
 * 用法：node tests/online-check.js   （Node 22 以上內建 WebSocket）
 * 驗證：/health、沒有 /api/presence、建房、邀請加入、觀戰、準備與開局、倒數、輪流出手、道具、
 *       密碼不外洩（玩家與觀戰者）、聊天頻道、完整一局結算、再開一場、重連回原座位（resumeRoomId）、
 *       不存在的房間回 resume_fail、零人關房、壞訊息不當機。
 */
'use strict';
process.env.PORT = '0';
process.env.UC_COUNTDOWN_MS = '300';
process.env.UC_BETWEEN_MS = '300';
const assert = require('assert');
const { server } = require('../server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(port, name, cid) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const msgs = [], waiters = [];
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.type === 'hb') { ws.send(JSON.stringify({ type: 'hb' })); return; }
      msgs.push(m);
      for (const w of waiters.slice()) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.to); w.res(m); }
    };
    ws.onerror = reject;
    ws.onopen = () => {
      const c = {
        ws, msgs, cid: cid || 'test-' + name + '-' + Math.random().toString(36).slice(2),
        send: o => ws.send(JSON.stringify(o)),
        wait: (pred, ms) => new Promise((res, rej) => { const w = { pred, res }; w.to = setTimeout(() => rej(new Error(name + ' 等不到訊息')), ms || 4000); waiters.push(w); }),
        room: () => { const r = msgs.filter(m => m.type === 'room').pop(); return r && r.room; },
        close: () => ws.close()
      };
      c.send({ type: 'hello', name: name, clientId: c.cid, resumeRoomId: c.resume });
      c.wait(m => m.type === 'welcome').then(() => resolve(c), reject);
    };
  });
}
async function resumeClient(port, name, cid, roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const msgs = [];
    ws.onmessage = ev => { const m = JSON.parse(ev.data); msgs.push(m); };
    ws.onerror = reject;
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', name, clientId: cid, resumeRoomId: roomId })); setTimeout(() => resolve({ ws, msgs }), 400); };
  });
}
/** 讓目前輪到的人出手，直到這局結束；回傳輪過的人 */
async function playOut(cs, kind) {
  for (let guard = 0; guard < 200; guard++) {
    const r = cs[0].room();
    if (!r || r.status !== 'playing' || !r.match.game || r.match.game.over) return;
    const g = r.match.game;
    const cur = g.current;
    const c = cs.find(x => x.room() && x.room().you.seat === cur);
    if (!c) { await sleep(50); continue; }
    if (kind === 'count') c.send({ type: 'act', kind: 'add', value: Math.min(3, 100 - g.total) });
    else c.send({ type: 'act', kind: 'guess', value: g.lo });
    await sleep(240);
  }
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const health = await (await fetch('http://127.0.0.1:' + port + '/health')).json();
  assert.strictEqual(health.ok, true);
  assert.strictEqual(health.game, 'ultimate-code');
  assert.ok(!('rooms' in health && Array.isArray(health.rooms)), '健康檢查不輸出房間內容');
  assert.notStrictEqual((await fetch('http://127.0.0.1:' + port + '/api/presence')).status, 200, '不提供 /api/presence');

  const A = await client(port, '甲'), B = await client(port, '乙'), S = await client(port, '丙');
  A.send({ type: 'create', name: '甲', settings: { mode: 'range', turnSec: 30, rounds: 1 } });
  const r1 = await A.wait(m => m.type === 'room');
  const id = r1.room.id, token = r1.room.invite.token;
  assert.ok(token, '房主拿得到邀請 token');
  B.send({ type: 'join', roomId: id, token, name: '乙', want: 'player' });
  const rb = await B.wait(m => m.type === 'room' && m.room.you.role === 'player');
  assert.strictEqual(rb.room.invite, null, '非房主拿不到 token');
  S.send({ type: 'join', roomId: id, name: '丙', want: 'spectator' });
  await S.wait(m => m.type === 'room' && m.room.you.role === 'spectator');

  A.send({ type: 'start' });
  assert.strictEqual((await A.wait(m => m.type === 'error')).code, 'start_not_ready');
  B.send({ type: 'ready', value: true });
  await A.wait(m => m.type === 'room' && m.room.seats[1] && m.room.seats[1].ready);
  A.send({ type: 'start' });
  await A.wait(m => m.type === 'room' && m.room.status === 'playing');
  await sleep(50);
  for (const c of [A, B, S]) assert.strictEqual(c.room().match.game.secret, null, '對局中沒有人拿得到密碼');
  /* 倒數中出手會被擋 */
  const cur0 = A.room().match.game.current;
  const first = cur0 === 0 ? A : B;
  first.send({ type: 'act', kind: 'guess', value: 50 });
  assert.strictEqual((await first.wait(m => m.type === 'error')).code, 'not_started');
  await sleep(350);
  /* 不是自己的回合 */
  const second = first === A ? B : A;
  second.send({ type: 'act', kind: 'guess', value: 50 });
  assert.strictEqual((await second.wait(m => m.type === 'error')).code, 'not_turn');
  /* 道具：跳過 */
  first.send({ type: 'act', kind: 'item', item: 'skip' });
  await first.wait(m => m.type === 'room' && m.room.match.game.history.length === 1);
  assert.strictEqual(A.room().match.game.items[cur0].skip, 0);
  /* 聊天：觀戰頻道不送給玩家 */
  S.send({ type: 'chat', text: '觀戰聊天' });
  await S.wait(m => m.type === 'chat');
  await sleep(100);
  assert.ok(!A.msgs.some(m => m.type === 'chat' && m.msg.text === '觀戰聊天'), '玩家收不到觀戰訊息');
  A.send({ type: 'chat', text: '<b>hi</b>' });
  const ch = await B.wait(m => m.type === 'chat');
  assert.strictEqual(ch.msg.text, '<b>hi</b>', '聊天原文送出（前端當文字顯示）');

  /* 重連：B 斷線後用同一個 clientId＋resumeRoomId 回來 */
  const bCid = B.cid;
  B.close();
  await A.wait(m => m.type === 'room' && m.room.seats[1] && m.room.seats[1].connected === false);
  const B2 = await resumeClient(port, '乙', bCid, id);
  const back = B2.msgs.filter(m => m.type === 'room').pop();
  assert.ok(back && back.room.id === id && back.room.you.seat === 1, '重連回原房號與座位');
  const Bx = { msgs: B2.msgs, ws: B2.ws, send: o => B2.ws.send(JSON.stringify(o)), room: () => { const r = B2.msgs.filter(m => m.type === 'room').pop(); return r && r.room; } };
  B2.ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.type === 'hb') { B2.ws.send('{"type":"hb"}'); return; } B2.msgs.push(m); };

  /* 打完這一局（一局制）→ finished，密碼揭曉 */
  await playOut([A, Bx], 'range');
  await sleep(300);
  const fin = A.room();
  assert.strictEqual(fin.status, 'finished');
  assert.ok(fin.match.result && fin.match.result.winners.length === 1);
  assert.ok(fin.match.log[0].secret >= 1, '結算後密碼揭曉');
  assert.ok(S.room().match.log[0].secret >= 1);

  /* 再開一場（累加模式），也能打完 */
  A.send({ type: 'settings', settings: { mode: 'count', turnSec: 15 } });
  await A.wait(m => m.type === 'room' && m.room.settings.mode === 'count');
  Bx.send({ type: 'ready', value: true });
  await sleep(150);
  A.send({ type: 'start' });
  await A.wait(m => m.type === 'room' && m.room.status === 'playing' && m.room.match.no === 2);
  await sleep(350);
  await playOut([A, Bx], 'count');
  await sleep(300);
  assert.strictEqual(A.room().status, 'finished');
  { const g = A.room().match.game; assert.ok(g.loser != null && g.total >= g.secret, '累加模式有人踩到或跨過地雷'); assert.ok(g.secret >= 1 && g.secret <= 100, '結算後地雷公開'); }

  /* 不存在的房間：resume_fail */
  const Z = await resumeClient(port, '丁', 'zzz-' + Date.now(), 'NOPE');
  assert.ok(Z.msgs.some(m => m.type === 'resume_fail' && m.roomId === 'NOPE'), '不存在的房間回 resume_fail');
  Z.ws.close();

  /* 壞訊息 */
  A.ws.send('not json'); A.ws.send(JSON.stringify({ type: 'act', kind: { a: 1 } })); A.ws.send(JSON.stringify({ type: 'settings', settings: null })); A.ws.send('x'.repeat(5000));
  await sleep(150);
  assert.strictEqual((await (await fetch('http://127.0.0.1:' + port + '/health')).json()).ok, true, '壞訊息不會讓伺服器掛掉');

  /* 零人關房：兩位玩家都離開，觀戰者收到 closed */
  A.send({ type: 'leave' }); Bx.send({ type: 'leave' });
  const closed = await S.wait(m => m.type === 'closed');
  assert.strictEqual(closed.reason, 'no_players');
  const h2 = await (await fetch('http://127.0.0.1:' + port + '/health')).json();
  assert.strictEqual(h2.rooms, 0);

  console.log('線上端對端測試通過');
  for (const c of [A, S]) c.close();
  B2.ws.close();
  server.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
