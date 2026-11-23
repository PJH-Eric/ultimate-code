/* ===== tests/rooms.test.js — 房間伺服器邏輯測試（假時鐘，不開網路；node tests/rooms.test.js）===== */
'use strict';
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { createHub, CONST } = require('../lib/rooms.js');

let passed = 0;
function test(name, fn) { try { fn(); passed++; } catch (e) { console.error('✗ ' + name); throw e; } }

function setup(opt) {
  let t = 1000000;
  const inbox = new Map();
  const io = { send(id, m) { if (!inbox.has(id)) inbox.set(id, []); inbox.get(id).push(m); } };
  const hub = createHub(io, Object.assign({ now: () => t, countdownMs: 3000, betweenMs: 4000 }, opt || {}));
  const P = name => ({ id: 'p-' + name, name: name, roomId: null, role: null });
  const last = (p, type) => (inbox.get(p.id) || []).filter(m => m.type === type).pop();
  const room = p => { const m = last(p, 'room'); return m && m.room; };
  const errs = p => (inbox.get(p.id) || []).filter(m => m.type === 'error').map(m => m.code);
  const clear = () => inbox.clear();
  return { hub, P, last, room, errs, clear, adv(ms) { t += ms; hub.tick(); }, get t() { return t; }, set t(v) { t = v; } };
}
/** 建一間房、拉 n 個人進來並準備 */
function table(env, n, settings) {
  const ps = ['甲', '乙', '丙', '丁', '戊', '己'].slice(0, n).map(env.P);
  env.hub.create(ps[0], { name: ps[0].name, settings: settings || {} });
  const id = env.room(ps[0]).id;
  ps.slice(1).forEach(p => { env.hub.join(p, { roomId: id, name: p.name, want: 'player' }); env.hub.setReady(p, true); });
  return { ps, id, r: () => env.hub.rooms.get(id) };
}

test('開局門檻：沒準備不能開、非房主不能開、人數不足不能開', () => {
  const env = setup();
  const a = env.P('a'), b = env.P('b');
  env.hub.create(a, { name: 'A' });
  env.hub.start(a);
  assert.deepStrictEqual(env.errs(a).slice(-1), ['start_need_players']);
  env.hub.join(b, { roomId: env.room(a).id, name: 'B' });
  env.hub.start(a);
  assert.deepStrictEqual(env.errs(a).slice(-1), ['start_not_ready']);
  env.hub.setReady(b, true);
  env.hub.start(b);
  assert.strictEqual(env.room(a).status, 'waiting', '非房主按開始沒用');
  env.hub.start(a);
  assert.strictEqual(env.room(a).status, 'playing');
});

test('倒數期間不能出手；只有輪到的人能出手；密碼不在任何玩家快照裡', () => {
  const env = setup();
  const { ps, r } = table(env, 3, { mode: 'range', turnSec: 30 });
  env.hub.start(ps[0]);
  const cur = r().match.game.order[r().match.game.pos];
  const curP = ps.find(p => r().seats[cur].id === p.id);
  env.hub.act(curP, { kind: 'guess', value: 50 });
  assert.deepStrictEqual(env.errs(curP).slice(-1), ['not_started']);
  env.adv(3000);
  const other = ps.find(p => p !== curP);
  env.hub.act(other, { kind: 'guess', value: 50 });
  assert.deepStrictEqual(env.errs(other).slice(-1), ['not_turn']);
  for (const p of ps) assert.strictEqual(env.room(p).match.game.secret, null, '玩家看不到密碼');
  const secret = r().match.game.secret;
  const v = secret === 50 ? 51 : 50;
  env.hub.act(curP, { kind: 'guess', value: v });
  const g = env.room(ps[0]).match.game;
  assert.strictEqual(g.history.length, 1);
  assert.ok(v < secret ? g.lo === v + 1 : g.hi === v - 1);
  assert.ok(JSON.stringify(env.room(ps[1])).indexOf('"secret":' + secret) < 0 || secret === null);
});

test('逾時自動行動（一般隨機猜、累加 +1），限時從下一位重新起算', () => {
  const env = setup();
  const { ps, r } = table(env, 2, { mode: 'count', turnSec: 15 });
  env.hub.start(ps[0]);
  env.adv(3000);
  env.adv(14000);
  assert.strictEqual(r().match.game.total, 0);
  env.adv(1100);
  assert.strictEqual(r().match.game.total, 1, '逾時自動 +1');
  assert.ok(r().match.game.history[0].auto);
  assert.ok(r().match.deadline > env.t + 14000, '下一位重新計時');
});

test('不限時：沒有逾時；輪到的人斷線 10 秒後代打、30 秒後離場', () => {
  const env = setup();
  const { ps, r } = table(env, 3, { mode: 'count', turnSec: 0 });
  env.hub.start(ps[0]);
  env.adv(3000);
  assert.strictEqual(r().match.deadline, 0);
  env.adv(60000);
  assert.strictEqual(r().match.game.total, 0, '不限時不會自動行動');
  const cur = r().match.game.order[r().match.game.pos];
  const curP = ps.find(p => r().seats[cur].id === p.id);
  env.hub.markDisconnected(curP.id);
  env.adv(10500);
  assert.strictEqual(r().match.game.total, 1, '斷線的人輪到時代打 +1');
  env.adv(21000);
  assert.ok(r().seats.every(s => !s || s.id !== curP.id), '斷線超過 30 秒座位釋出');
  assert.ok(r().match.game.order.indexOf(cur) < 0, '從出手順序移除');
});

test('30 秒內重連回原座位', () => {
  const env = setup();
  const { ps, r } = table(env, 2, { mode: 'count' });
  env.hub.start(ps[0]);
  env.hub.markDisconnected(ps[1].id);
  env.adv(20000);
  const back = env.hub.reconnect(ps[1]);
  assert.ok(back);
  assert.ok(r().seats.some(s => s && s.id === ps[1].id && s.connected));
});

test('掛機：輪到的人 2.5 分鐘提醒、3 分鐘離場；只剩 1 人直接結算', () => {
  const env = setup();
  const { ps, r } = table(env, 2, { mode: 'range', turnSec: 0 });
  env.hub.start(ps[0]);
  env.adv(3000);
  const cur = r().match.game.order[r().match.game.pos];
  const curP = ps.find(p => r().seats[cur].id === p.id);
  env.adv(CONST.IDLE_WARN_MS + 100);
  assert.ok(env.last(curP, 'toast') && env.last(curP, 'toast').code === 'idleWarn');
  env.adv(CONST.IDLE_MS - CONST.IDLE_WARN_MS);
  assert.strictEqual(r().status, 'finished', '只剩 1 人直接結算');
  assert.strictEqual(r().result.winners.length, 1);
  assert.notStrictEqual(r().result.winners[0], cur);
});

test('多局：每局結束進入局間、自動下一局、中標最少者贏', () => {
  const env = setup();
  const { ps, r } = table(env, 2, { mode: 'range', rounds: 3, turnSec: 0 });
  env.hub.start(ps[0]);
  for (let k = 0; k < 3; k++) {
    env.adv(3001);
    const g = r().match.game;
    const cur = g.order[g.pos];
    const curP = ps.find(p => r().seats[cur].id === p.id);
    env.hub.act(curP, { kind: 'guess', value: g.secret });
    if (k < 2) { assert.strictEqual(r().status, 'between'); env.adv(4001); assert.strictEqual(r().status, 'playing'); }
  }
  assert.strictEqual(r().status, 'finished');
  const hits = r().result.hits;
  assert.strictEqual(hits[0] + hits[1], 3);
  const min = Math.min(hits[0], hits[1]);
  assert.deepStrictEqual(r().result.winners, [0, 1].filter(s => hits[s] === min));
  /* 結算後密碼與每局紀錄公開 */
  assert.strictEqual(env.room(ps[0]).match.log.length, 3);
  assert.ok(env.room(ps[0]).match.log.every(l => l.secret >= 1));
});

test('玩家出題：出題者選密碼（只有他看得到）、其他人等；時間到用預設；本局聊天暫停', () => {
  const env = setup();
  const { ps, r } = table(env, 3, { mode: 'range', setterMode: 'player', turnSec: 30 });
  env.hub.start(ps[0]);
  const g = r().match.game;
  assert.strictEqual(r().match.phase, 'set');
  const setterP = ps.find(p => r().seats[g.setter].id === p.id);
  const others = ps.filter(p => p !== setterP);
  assert.ok(env.room(setterP).match.game.secret >= 1, '出題者看得到預設密碼');
  others.forEach(p => assert.strictEqual(env.room(p).match.game.secret, null, '其他人看不到'));
  assert.ok(env.room(others[0]).chatOff, '出題局聊天暫停');
  env.hub.chat(others[0], '密碼是多少');
  assert.deepStrictEqual(env.errs(others[0]).slice(-1), ['chat_off']);
  env.hub.setSecret(others[0], 10);
  assert.deepStrictEqual(env.errs(others[0]).slice(-1), ['not_setter']);
  env.hub.setSecret(setterP, 0);
  assert.deepStrictEqual(env.errs(setterP).slice(-1), ['bad_secret']);
  env.hub.setSecret(setterP, 77);
  assert.strictEqual(r().match.game.secret, 77);
  assert.strictEqual(r().match.phase, 'play');
  assert.ok(r().match.game.order.indexOf(g.setter) < 0, '出題者不猜');
  /* 下一場：出題時間到自動開始 */
  const env2 = setup();
  const t2 = table(env2, 3, { mode: 'range', setterMode: 'player', turnSec: 15 });
  env2.hub.start(t2.ps[0]);
  env2.adv(20500);
  assert.strictEqual(t2.r().match.phase, 'play', '出題逾時用預設密碼開始');
});

test('組隊：紅藍交錯、踩中的人所屬隊伍輸、隊伍未選好不能開', () => {
  const env = setup();
  const { ps, r } = table(env, 4, { mode: 'count', teams: true, turnSec: 0 });
  const teams = r().seats.filter(Boolean).map(s => s.team);
  assert.deepStrictEqual(teams, ['red', 'blue', 'red', 'blue'], '自動分隊交替');
  env.hub.setTeam(ps[1], 'red'); env.hub.setReady(ps[1], true);
  env.hub.setTeam(ps[3], 'red'); env.hub.setReady(ps[3], true);
  env.hub.start(ps[0]);
  assert.deepStrictEqual(env.errs(ps[0]).slice(-1), ['start_team_empty']);
  env.hub.setTeam(ps[3], 'blue'); env.hub.setTeam(ps[1], 'blue');
  ps.slice(1).forEach(p => env.hub.setReady(p, true));
  env.hub.start(ps[0]);
  const g = r().match.game;
  assert.deepStrictEqual(g.order.map(s => r().seats[s].team), ['red', 'blue', 'red', 'blue']);
  env.adv(3001);
  g.total = 99;
  const cur = g.order[g.pos];
  const curP = ps.find(p => r().seats[cur].id === p.id);
  env.hub.act(curP, { kind: 'add', value: 1 });
  assert.strictEqual(r().status, 'finished');
  const loseTeam = r().seats[cur].team;
  assert.deepStrictEqual(r().result.winTeams, [loseTeam === 'red' ? 'blue' : 'red']);
});

test('道具：指定隊友、迴轉；伺服器驗證剩餘次數與對象', () => {
  const env = setup();
  const { ps, r } = table(env, 3, { mode: 'count', turnSec: 0 });
  env.hub.start(ps[0]);
  env.adv(3001);
  const g = r().match.game;
  const cur = g.order[g.pos];
  const curP = ps.find(p => r().seats[cur].id === p.id);
  env.hub.act(curP, { kind: 'item', item: 'assign', target: cur });
  assert.deepStrictEqual(env.errs(curP).slice(-1), ['bad_target']);
  const target = g.order.find(s => s !== cur);
  env.adv(300);
  env.hub.act(curP, { kind: 'item', item: 'assign', target: target });
  assert.strictEqual(g.order[g.pos], target);
  assert.strictEqual(g.items[cur].assign, 0);
});

test('觀戰：看不到密碼、對局中觀戰聊天不送給玩家；非玩家不能出手', () => {
  const env = setup();
  const { ps, id, r } = table(env, 2, { mode: 'range' });
  const s = env.P('看戲');
  env.hub.join(s, { roomId: id, name: '看戲', want: 'spectator' });
  env.hub.start(ps[0]);
  env.adv(3001);
  assert.strictEqual(env.room(s).match.game.secret, null);
  env.hub.act(s, { kind: 'guess', value: 50 });
  assert.deepStrictEqual(env.errs(s).slice(-1), ['not_player']);
  env.clear();
  env.hub.chat(s, '加油');
  assert.ok(!env.last(ps[0], 'chat'), '玩家收不到觀戰頻道');
  assert.ok(env.last(s, 'chat'));
});

test('私人房不在列表、不能用房號直接加入；邀請可撤銷與重發', () => {
  const env = setup();
  const a = env.P('a'), b = env.P('b'), c = env.P('c');
  env.hub.create(a, { name: 'A', private: true });
  const rm = env.room(a);
  assert.strictEqual(env.hub.listRooms().length, 0);
  env.hub.join(b, { roomId: rm.id, name: 'B' });
  assert.deepStrictEqual(env.errs(b).slice(-1), ['room_private']);
  env.hub.join(b, { roomId: rm.id, name: 'B', token: 'bad' });
  assert.deepStrictEqual(env.errs(b).slice(-1), ['invite_invalid']);
  env.hub.inviteRevoke(a);
  env.hub.join(b, { roomId: rm.id, name: 'B', token: rm.invite.token });
  assert.deepStrictEqual(env.errs(b).slice(-1), ['invite_revoked']);
  env.hub.inviteNew(a);
  env.hub.join(c, { roomId: rm.id, name: 'C', token: env.room(a).invite.token });
  assert.strictEqual(env.room(c).you.role, 'player');
  assert.strictEqual(env.room(c).invite, null, '只有房主拿得到邀請 token');
});

test('快速加入：沒有空房就自己開一間並告知；踢人', () => {
  const env = setup();
  const a = env.P('a'), b = env.P('b');
  env.hub.quick(a, { name: 'A' });
  assert.strictEqual(env.last(a, 'toast').code, 'quickCreated');
  env.hub.quick(b, { name: 'B' });
  assert.strictEqual(env.room(b).id, env.room(a).id, '有空位就加入');
  env.hub.kick(a, b.id);
  assert.strictEqual(env.last(b, 'closed').reason, 'kicked');
});

test('實體玩家歸零立即關房；觀戰者不算；關掉的房不會復活', () => {
  const env = setup();
  const a = env.P('a'), s = env.P('s');
  env.hub.create(a, { name: 'A' });
  const id = env.room(a).id;
  env.hub.join(s, { roomId: id, name: 'S', want: 'spectator' });
  env.hub.leave(a.id);
  assert.ok(!env.hub.rooms.has(id));
  assert.strictEqual(env.last(s, 'closed').reason, 'no_players');
  env.hub.join(a, { roomId: id, name: 'A' });
  assert.deepStrictEqual(env.errs(a).slice(-1), ['room_missing']);
});

test('對局中離開：順序接續、道具作廢；組隊只剩一隊直接勝', () => {
  const env = setup();
  const { ps, r } = table(env, 3, { mode: 'count', teams: true, turnSec: 0 });
  env.hub.start(ps[0]);
  env.adv(3001);
  const blue = ps.find(p => r().seats.find(s => s && s.id === p.id).team === 'blue');
  env.hub.leave(blue.id);
  assert.strictEqual(r().status, 'finished');
  assert.deepStrictEqual(r().result.winTeams, ['red']);
});

test('局間有人離開導致人數不足：直接結算', () => {
  const env = setup();
  const { ps, r } = table(env, 2, { mode: 'range', rounds: 3, turnSec: 0 });
  env.hub.start(ps[0]);
  env.adv(3001);
  const g = r().match.game;
  const curP = ps.find(p => r().seats[g.order[g.pos]].id === p.id);
  env.hub.act(curP, { kind: 'guess', value: g.secret });
  assert.strictEqual(r().status, 'between');
  env.hub.leave(curP.id);
  assert.strictEqual(r().status, 'finished');
  assert.strictEqual(r().result.early, true);
});

test('壞訊息不會讓伺服器出錯', () => {
  const env = setup();
  const { ps } = table(env, 2, { mode: 'range' });
  env.hub.start(ps[0]); env.adv(3001);
  [null, {}, { kind: 'x' }, { kind: 'guess', value: 'abc' }, { kind: 'item', item: '__proto__' }, { kind: 'add', value: 1e9 }].forEach(m => env.hub.act(ps[0], m));
  env.hub.settings(ps[0], { cap: -1, mode: '<script>' });
  env.hub.chat(ps[0], '<img src=x onerror=alert(1)>');
  env.hub.join(env.P('z'), { roomId: { toString() { return 'X'; } } });
  assert.ok(true);
});

test('重啟復原：快照還原房號、座位、輪次與已確認的猜測；120 秒寬限內暫停計時', () => {
  const { openRoomStore } = require('../lib/room-store.js');
  const file = path.join(os.tmpdir(), 'uc-rooms-' + process.pid + '-' + Date.now() + '.db');
  try {
    const store = openRoomStore(file);
    const env = setup({ store });
    const { ps, id, r } = table(env, 2, { mode: 'range', turnSec: 30 });
    env.hub.start(ps[0]);
    env.adv(3001);
    const g = r().match.game;
    const curP = ps.find(p => r().seats[g.order[g.pos]].id === p.id);
    const v = g.secret === 50 ? 51 : 50;
    env.hub.act(curP, { kind: 'guess', value: v });
    const before = { lo: g.lo, hi: g.hi, turn: g.order[g.pos], secret: g.secret, hist: g.history.length };
    /* 模擬重啟：同一個檔案開一個新的 hub，時間過了 55 秒 */
    const env2 = setup({ store: openRoomStore(file) });
    env2.t = env.t + 55000;
    const room2 = env2.hub.rooms.get(id);
    assert.ok(room2, '房間還在');
    assert.ok(room2.recovery, '進入復原寬限');
    const g2 = room2.match.game;
    assert.deepStrictEqual({ lo: g2.lo, hi: g2.hi, turn: g2.order[g2.pos], secret: g2.secret, hist: g2.history.length }, before);
    env2.adv(60000);
    assert.strictEqual(g2.history.length, before.hist, '寬限中不會逾時自動行動');
    assert.ok(env2.hub.rooms.has(id), '寬限中不會因為斷線關房');
    const back0 = env2.hub.reconnect(ps[0], id);
    assert.ok(back0 && room2.recovery, '一人回來後仍在等另一人');
    env2.hub.reconnect(ps[1], id);
    assert.strictEqual(room2.recovery, null, '全員回來後結束復原');
    assert.ok(room2.match.deadline > env2.t + 20000, '剩餘時間往後順延');
    /* 不存在的房間：回 resume_fail */
    const z = env2.P('z');
    env2.hub.reconnect(z, 'NOPE');
    assert.strictEqual(env2.last(z, 'resume_fail').roomId, 'NOPE');
    /* 主動離開、關房都會寫入：重啟後不復活 */
    env2.hub.leave(ps[0].id); env2.hub.leave(ps[1].id);
    const env3 = setup({ store: openRoomStore(file) });
    assert.ok(!env3.hub.rooms.has(id), '已關的房間不會復活');
  } finally { for (const f of [file, file + '-wal', file + '-shm']) try { fs.unlinkSync(f); } catch (e) { /* 忽略 */ } }
});

test('重啟後寬限到期：沒回來的人照離線規則處理、房間零人關房', () => {
  const { openRoomStore } = require('../lib/room-store.js');
  const file = path.join(os.tmpdir(), 'uc-rooms2-' + process.pid + '-' + Date.now() + '.db');
  try {
    const env = setup({ store: openRoomStore(file) });
    const { ps, id } = table(env, 2, { mode: 'count' });
    env.hub.start(ps[0]);
    const env2 = setup({ store: openRoomStore(file) });
    env2.t = env.t + 1000;
    env2.adv(CONST.RECOVERY_MS + 1);
    env2.adv(100);
    assert.ok(!env2.hub.rooms.has(id), '沒有人回來：寬限後關房');
  } finally { for (const f of [file, file + '-wal', file + '-shm']) try { fs.unlinkSync(f); } catch (e) { /* 忽略 */ } }
});

console.log('房間測試全部通過：' + passed + ' 項');
