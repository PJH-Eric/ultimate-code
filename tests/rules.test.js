/* ===== tests/rules.test.js — 規則核心單元測試（node tests/rules.test.js）===== */
'use strict';
const assert = require('assert');
const R0 = require('../public/js/core/rules.js');
/* 累加模式預設地雷放在 100（測試會走到的小數字都安全），測試才不會被隨機地雷提早結束 */
const R = Object.assign({}, R0, { createGame: o => R0.createGame(o.mode === 'count' && o.secret == null && !o.randomMines ? Object.assign({ secret: 100 }, o) : o) });

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('✗ ' + name); throw e; }
}

/* ---------- 亂數 ---------- */
test('種子亂數可重現', () => {
  const a = R.rngFrom('abc'), b = R.rngFrom('abc');
  for (let i = 0; i < 20; i++) assert.strictEqual(a.next(), b.next());
  const r = R.rngFrom(7);
  for (let i = 0; i < 500; i++) { const v = r.range(3, 5); assert.ok(v >= 3 && v <= 5); }
});

/* ---------- 一般模式 ---------- */
test('範圍縮小：猜小、猜大、猜中輸', () => {
  const g = R.createGame({ mode: 'range', seats: [0, 1, 2], secret: 40 });
  assert.deepStrictEqual([g.lo, g.hi], [1, 100]);
  assert.strictEqual(R.current(g), 0);
  let r = R.guess(g, 0, 20);
  assert.ok(r.ok); assert.strictEqual(r.ev.result, 'low'); assert.deepStrictEqual([g.lo, g.hi], [21, 100]);
  assert.strictEqual(R.current(g), 1);
  r = R.guess(g, 1, 70);
  assert.strictEqual(r.ev.result, 'high'); assert.deepStrictEqual([g.lo, g.hi], [21, 69]);
  assert.strictEqual(R.guess(g, 2, 20).err, 'bad_guess', '範圍外不能猜');
  assert.strictEqual(R.guess(g, 2, 21.5).err, 'bad_guess', '小數不能猜');
  assert.strictEqual(R.guess(g, 0, 30).err, 'not_turn', '不是自己的回合');
  r = R.guess(g, 2, 40);
  assert.strictEqual(r.ev.result, 'hit');
  assert.ok(g.over); assert.strictEqual(g.loser, 2); assert.strictEqual(g.reason, 'hit');
  assert.strictEqual(R.guess(g, 0, 41).err, 'over', '結束後不能再猜');
});

test('邊界：猜到範圍邊界（含）合法，範圍剩 1 個時下一位必輸', () => {
  const g = R.createGame({ mode: 'range', seats: [0, 1], secret: 1 });
  assert.ok(R.guess(g, 0, 100).ok);
  assert.deepStrictEqual([g.lo, g.hi], [1, 99]);
  assert.ok(R.guess(g, 1, 2).ok);
  assert.deepStrictEqual([g.lo, g.hi], [1, 1]);
  assert.ok(R.legalGuess(g, 1) && !R.legalGuess(g, 2));
  const r = R.guess(g, 0, 1);
  assert.strictEqual(r.ev.result, 'hit'); assert.strictEqual(g.loser, 0);
});

test('隨機密碼落在 1～100，非法密碼改用亂數', () => {
  for (let i = 0; i < 200; i++) {
    const g = R.createGame({ mode: 'range', seats: [0, 1], rng: R.rngFrom(i) });
    assert.ok(g.secret >= 1 && g.secret <= 100);
  }
  assert.ok(R.createGame({ mode: 'range', seats: [0, 1], secret: 0, rng: R.rngFrom(1) }).secret >= 1);
});

test('玩家出題：出題者不在順序裡、不能猜', () => {
  const g = R.createGame({ mode: 'range', seats: [0, 1, 2], setter: 1, secret: 50 });
  assert.deepStrictEqual(g.order, [0, 2]);
  assert.strictEqual(R.guess(g, 1, 10).err, 'not_turn');
  assert.ok(R.guess(g, 0, 10).ok);
  assert.strictEqual(R.current(g), 2);
});

/* ---------- 累加模式 ---------- */
test('累加：+1／+2／+3、超過 100 不合法、地雷在 100 時報到 100 輸', () => {
  const g = R.createGame({ mode: 'count', seats: [0, 1] });
  assert.strictEqual(g.secret, 100, '測試預設地雷在 100');
  assert.ok(R.add(g, 0, 3).ok); assert.strictEqual(g.total, 3);
  assert.strictEqual(R.add(g, 1, 4).err, 'bad_add');
  assert.strictEqual(R.add(g, 1, 0).err, 'bad_add');
  g.total = 98;
  assert.deepStrictEqual(R.legalSteps(g), [1, 2]);
  assert.strictEqual(R.add(g, 1, 3).err, 'bad_add', '超過 100 的選項停用');
  g.total = 99;
  assert.deepStrictEqual(R.legalSteps(g), [1]);
  const r = R.add(g, 1, 1);
  assert.strictEqual(r.ev.result, 'hit'); assert.strictEqual(g.loser, 1);
});

test('累加地雷：只有一顆、停在上面或跨過都算踩中、一定有人踩中', () => {
  const g = R.createGame({ mode: 'count', seats: [0, 1], secret: 10 });
  assert.strictEqual(g.secret, 10);
  R.add(g, 0, 3); R.add(g, 1, 3); R.add(g, 0, 3);    // 9，還沒到
  assert.ok(!g.over && g.total === 9);
  R.add(g, 1, 3);                                      // 9 → 12 跨過 10
  assert.ok(g.over); assert.strictEqual(g.loser, 1);
  const ev = g.history[g.history.length - 1];
  assert.strictEqual(ev.result, 'hit'); assert.strictEqual(ev.mineAt, 10, '事件記下踩到的地雷');
  const h = R.createGame({ mode: 'count', seats: [0, 1], secret: 4 });
  R.add(h, 0, 3); R.add(h, 1, 1);                     // 停在 4
  assert.strictEqual(h.loser, 1);
  for (let i = 0; i < 300; i++) {                      // 隨機地雷、隨機步數：一定在 100 以內結束
    const r = R0.rngFrom('c' + i);
    const k = R0.createGame({ mode: 'count', seats: [0, 1, 2], rng: r });
    assert.ok(k.secret >= 1 && k.secret <= 100);
    let guard = 0;
    while (!k.over && guard++ < 200) { const st = R0.legalSteps(k); R0.add(k, R0.current(k), st[r.int(st.length)]); }
    assert.ok(k.over && k.total >= k.secret, '一定有人踩中');
  }
});

test('累加地雷：也能由玩家出題，出題者不報數', () => {
  const g = R0.createGame({ mode: 'count', seats: [0, 1, 2], setter: 2, secret: 42, rng: R0.rngFrom(1) });
  assert.deepStrictEqual(g.order, [0, 1]);
  assert.strictEqual(g.secret, 42);
});

/* ---------- 道具 ---------- */
test('跳過：換下一位、不改範圍、只能用一次', () => {
  const g = R.createGame({ mode: 'range', seats: [0, 1, 2], secret: 50 });
  const r = R.useItem(g, 0, 'skip');
  assert.ok(r.ok); assert.strictEqual(R.current(g), 1);
  assert.deepStrictEqual([g.lo, g.hi], [1, 100]);
  assert.strictEqual(g.items[0].skip, 0);
  R.guess(g, 1, 10); R.guess(g, 2, 90);
  assert.strictEqual(R.useItem(g, 0, 'skip').err, 'no_item');
});

test('迴轉：順序反向、輪到上一位；只有 2 人時等同跳過', () => {
  const g = R.createGame({ mode: 'count', seats: [0, 1, 2, 3] });
  R.add(g, 0, 1); R.add(g, 1, 1);             // 輪到 2
  assert.strictEqual(R.current(g), 2);
  R.useItem(g, 2, 'reverse');
  assert.strictEqual(g.dir, -1);
  assert.strictEqual(R.current(g), 1, '反向後輪到上一位');
  R.add(g, 1, 1);
  assert.strictEqual(R.current(g), 0, '之後繼續反向');
  R.add(g, 0, 1);
  assert.strictEqual(R.current(g), 3, '反向會繞回最後一位');
  const two = R.createGame({ mode: 'count', seats: [5, 6] });
  R.useItem(two, 5, 'reverse');
  assert.strictEqual(R.current(two), 6, '2 人迴轉＝跳過');
  R.add(two, 6, 1);
  assert.strictEqual(R.current(two), 5);
});

test('指定：可指定任何其他猜題者（含隊友），不能指定自己或出題者', () => {
  const teams = { 0: 'red', 1: 'blue', 2: 'red', 3: 'blue' };
  const g = R.createGame({ mode: 'range', seats: [0, 1, 2, 3], teams, setter: 3, secret: 30 });
  assert.deepStrictEqual(R.assignTargets(g, 0), [1, 2]);
  assert.strictEqual(R.useItem(g, 0, 'assign', 0).err, 'bad_target');
  assert.strictEqual(R.useItem(g, 0, 'assign', 3).err, 'bad_target');
  assert.strictEqual(R.useItem(g, 0, 'assign', 9).err, 'bad_target');
  const r = R.useItem(g, 0, 'assign', 2);
  assert.ok(r.ok); assert.strictEqual(R.current(g), 2); assert.strictEqual(r.ev.target, 2);
  R.guess(g, 2, 10);
  assert.strictEqual(R.current(g), 0, '指定後從被指定者往下輪');
});

test('最後一個數字時用道具把回合推給別人；道具用完就躲不掉', () => {
  const g = R.createGame({ mode: 'range', seats: [0, 1], secret: 5 });
  g.lo = 5; g.hi = 5;
  assert.ok(R.useItem(g, 0, 'skip').ok);
  assert.ok(R.useItem(g, 1, 'skip').ok);
  assert.ok(R.useItem(g, 0, 'assign', 1).ok);
  assert.ok(R.useItem(g, 1, 'reverse').ok);
  assert.ok(R.useItem(g, 0, 'reverse').ok);
  assert.ok(R.useItem(g, 1, 'assign', 0).ok);
  assert.strictEqual(R.current(g), 0);
  ['skip', 'reverse', 'assign'].forEach(it => assert.strictEqual(R.useItem(g, 0, it, 1).err, 'no_item'));
  R.guess(g, 0, 5);
  assert.strictEqual(g.loser, 0);
});

test('關閉道具時不能使用', () => {
  const g = R.createGame({ mode: 'count', seats: [0, 1], itemsOn: false });
  assert.strictEqual(R.useItem(g, 0, 'skip').err, 'items_off');
  assert.strictEqual(g.items[0].skip, 0);
});

/* ---------- 順序與組隊 ---------- */
test('紅藍交錯，人數不等時其餘接在後面', () => {
  const teams = { 0: 'red', 1: 'red', 2: 'red', 3: 'blue', 4: 'red' };
  assert.deepStrictEqual(R.buildOrder([0, 1, 2, 3, 4], teams), [0, 3, 1, 2, 4]);
  assert.deepStrictEqual(R.buildOrder([0, 1, 2, 3], { 0: 'blue', 1: 'blue', 2: 'red', 3: 'red' }), [2, 0, 3, 1]);
  assert.deepStrictEqual(R.buildOrder([0, 1, 2], null), [0, 1, 2]);
});

test('組隊：踩中的人所屬隊伍輸，另一隊贏', () => {
  const teams = { 0: 'red', 1: 'blue' };
  const g = R.createGame({ mode: 'range', seats: [0, 1], teams, secret: 1 });
  R.guess(g, 0, 1);
  assert.strictEqual(g.loserTeam, 'red'); assert.strictEqual(g.winTeam, 'blue');
});

test('起始位置可輪替', () => {
  const g = R.createGame({ mode: 'count', seats: [0, 1, 2], startPos: 4 });
  assert.strictEqual(R.current(g), 1);
});

/* ---------- 離場 ---------- */
test('離場：輪到的人離開，順序正確接續（正向與反向）', () => {
  const g = R.createGame({ mode: 'count', seats: [0, 1, 2, 3] });
  R.add(g, 0, 1);                       // 輪到 1
  R.removePlayer(g, 1, [0, 1, 2, 3]);
  assert.strictEqual(R.current(g), 2);
  R.useItem(g, 2, 'reverse');           // 反向 → 0
  assert.strictEqual(R.current(g), 0);
  R.removePlayer(g, 0, [0, 2, 3]);
  assert.strictEqual(R.current(g), 3, '反向時離開的人由上一位接手');
  assert.ok(!g.over);
  R.removePlayer(g, 2, [2, 3]);
  assert.ok(g.over, '只剩 1 人直接結束'); assert.strictEqual(g.loser, null); assert.strictEqual(g.reason, 'left');
});

test('離場：排在目前之前的人離開，輪到的人不變；道具作廢', () => {
  const g = R.createGame({ mode: 'count', seats: [0, 1, 2] });
  R.add(g, 0, 1); R.add(g, 1, 1);       // 輪到 2
  R.removePlayer(g, 0, [0, 1, 2]);
  assert.strictEqual(R.current(g), 2);
  assert.deepStrictEqual(g.items[0], { skip: 0, reverse: 0, assign: 0 });
});

test('離場：組隊只剩一隊時該隊直接勝', () => {
  const teams = { 0: 'red', 1: 'blue', 2: 'red' };
  const g = R.createGame({ mode: 'count', seats: [0, 1, 2], teams });
  const r = R.removePlayer(g, 1, [0, 1, 2]);
  assert.ok(r.ended); assert.strictEqual(g.winTeam, 'red'); assert.strictEqual(g.loser, null);
});

test('指定到已離場的人：不在可指定名單', () => {
  const g = R.createGame({ mode: 'count', seats: [0, 1, 2] });
  R.removePlayer(g, 2, [0, 1, 2]);
  assert.strictEqual(R.useItem(g, 0, 'assign', 2).err, 'bad_target');
});

/* ---------- 逾時 ---------- */
test('逾時自動行動：一般＝範圍內隨機猜、累加＝+1', () => {
  for (let i = 0; i < 50; i++) {
    const g = R.createGame({ mode: 'range', seats: [0, 1], secret: 50, rng: R.rngFrom(i) });
    g.lo = 40; g.hi = 60;
    const r = R.autoAct(g, R.rngFrom('t' + i));
    assert.ok(r.ok && r.ev.auto && r.ev.value >= 40 && r.ev.value <= 60);
  }
  const c = R.createGame({ mode: 'count', seats: [0, 1] });
  const r = R.autoAct(c);
  assert.strictEqual(r.ev.value, 1); assert.strictEqual(c.total, 1);
});

/* ---------- 多局 ---------- */
test('多局：中標最少者贏、同分並列；組隊比隊伍', () => {
  const m = R.createMatch({ rounds: 3, seats: [0, 1, 2] });
  [1, 2, 1].forEach(l => { const g = R.createGame({ mode: 'range', seats: [0, 1, 2], secret: 1 }); g.pos = g.order.indexOf(l); R.guess(g, l, 1); R.recordRound(m, g); });
  assert.ok(R.matchOver(m));
  assert.deepStrictEqual(R.standings(m).winners, [0]);
  const m2 = R.createMatch({ rounds: 1, seats: [0, 1, 2] });
  const g2 = R.createGame({ mode: 'count', seats: [0, 1, 2] }); R.removePlayer(g2, 2, [0, 1, 2]); R.removePlayer(g2, 1, [0, 1]);
  R.recordRound(m2, g2);
  assert.deepStrictEqual(R.standings(m2).winners, [0, 1, 2], '沒有輸家時全部並列');
  assert.deepStrictEqual(R.standings(m2, [0]).winners, [0], '只在仍在場的人之中比');
  const teams = { 0: 'red', 1: 'blue', 2: 'blue' };
  const m3 = R.createMatch({ rounds: 1, seats: [0, 1, 2], teams });
  const g3 = R.createGame({ mode: 'range', seats: [0, 1, 2], teams, secret: 1 });
  R.guess(g3, 0, 1); R.recordRound(m3, g3);
  const st = R.standings(m3);
  assert.deepStrictEqual(st.winTeams, ['blue']); assert.deepStrictEqual(st.winners, [1, 2]);
});

test('輪流出題：不組隊照座位、組隊兩隊交替且隊內至少 2 人', () => {
  assert.strictEqual(R.pickSetter([0, 1], null, 0), null, '2 人不能玩家出題');
  assert.deepStrictEqual([0, 1, 2, 3].map(r => R.pickSetter([0, 1, 2], null, r)), [0, 1, 2, 0]);
  const teams = { 0: 'red', 1: 'blue', 2: 'red', 3: 'blue' };
  assert.deepStrictEqual([0, 1, 2, 3].map(r => R.pickSetter([0, 1, 2, 3], teams, r)), [0, 1, 2, 3]);
  const lop = { 0: 'red', 1: 'blue', 2: 'red' };
  assert.deepStrictEqual([0, 1, 2].map(r => R.pickSetter([0, 1, 2], lop, r)), [0, 2, 0], '藍隊只有 1 人時只由紅隊出題');
  assert.strictEqual(R.pickSetter([0, 1], { 0: 'red', 1: 'blue' }, 0), null);
  assert.strictEqual(R.canStart({ seats: [0, 1], mode: 'range', setterMode: 'player' }), 'setter_need');
  assert.strictEqual(R.canStart({ seats: [0, 1], teams: { 0: 'red', 1: 'red' } }), 'team_empty');
  assert.strictEqual(R.canStart({ seats: [0, 1], teams: { 0: 'red' } }), 'pick_team');
  assert.strictEqual(R.canStart({ seats: [0] }), 'need_players');
  assert.strictEqual(R.canStart({ seats: [0, 1], mode: 'count' }), null);
  assert.strictEqual(R.canStart({ seats: [0, 1], mode: 'count', setterMode: 'player' }), 'setter_need', '累加模式玩家出題也要至少 3 人');
});

/* ---------- 單人 ---------- */
test('單人破解：猜中過關、星數門檻', () => {
  const c = R.createCrack(R.rngFrom(3));
  let lo = 1, hi = 100;
  while (!c.over) { const m = (lo + hi) >> 1; const r = R.crackGuess(c, m); if (r.ev.result === 'low') lo = m + 1; else hi = m - 1; }
  assert.ok(c.won); assert.ok(c.history.length <= 7, '二分法最多 7 次'); assert.strictEqual(c.stars, 3);
  assert.deepStrictEqual([7, 8, 9, 10].map(R.crackStars), [3, 2, 2, 1]);
  assert.strictEqual(R.crackGuess(c, 5).err, 'over');
});

test('單人踩點：地雷可走通、+3 一路會踩雷、步數星數、踩雷與超過失敗', () => {
  for (let i = 0; i < 300; i++) {
    const s = R.createStep(R.rngFrom('step' + i));
    assert.strictEqual(s.mines.length, 5);
    assert.ok(s.best >= 34 && s.best <= 40, '最少步數合理：' + s.best);
    assert.ok(s.mines.every(m => m >= 2 && m <= 99));
    assert.ok(s.mines.filter(m => m % 3 === 0).length >= 3);
  }
  const s = { kind: 'step', mines: [3, 6, 9, 12, 15], total: 0, steps: 0, best: R.minSteps([3, 6, 9, 12, 15]), path: [0], over: false };
  assert.strictEqual(R.stepAdd(s, 3).ev.result, 'mine'); assert.strictEqual(s.fail, 'mine');
  const t = { kind: 'step', mines: [50], total: 98, steps: 30, best: 34, path: [98], over: false };
  assert.strictEqual(R.stepAdd(t, 3).ev.result, 'over');
  const u = { kind: 'step', mines: [50], total: 97, steps: 33, best: 34, path: [97], over: false };
  assert.strictEqual(R.stepAdd(u, 3).ev.result, 'goal'); assert.strictEqual(u.stars, 3);
  assert.deepStrictEqual([34, 36, 37].map(n => R.stepStars(n, 34)), [3, 2, 1]);
  assert.strictEqual(R.minSteps([97, 98, 99]), -1, '連 3 個地雷擋住就走不到');
});

/* ---------- 設定 ---------- */
test('房間設定驗證：非法值沿用前值、累加模式也可玩家出題、限時只有 10／20／30 秒', () => {
  const s = R.normSettings({ mode: 'count', setterMode: 'player', turnSec: 7, rounds: 3, cap: 99, teams: 'x' });
  assert.strictEqual(s.setterMode, 'player'); assert.strictEqual(s.turnSec, 30); assert.strictEqual(s.rounds, 3); assert.strictEqual(s.cap, 6); assert.strictEqual(s.teams, false);
  assert.deepStrictEqual(R.TURN_SECS, [10, 20, 30]);
  assert.strictEqual(R.normSettings({ turnSec: 0 }).turnSec, 30, '不再有不限時');
  assert.strictEqual(R.normSettings({ turnSec: 10 }).turnSec, 10);
});

/* ---------- 隨機對局模糊測試：不會卡住、一定有結果 ---------- */
test('隨機對局 2000 局都能結束且狀態一致', () => {
  const rng = R.rngFrom('fuzz');
  for (let k = 0; k < 2000; k++) {
    const n = 2 + rng.int(7);
    const seats = Array.from({ length: n }, (_, i) => i);
    const teamsOn = rng.next() < 0.5;
    const teams = teamsOn ? Object.fromEntries(seats.map(s => [s, s % 2 ? 'blue' : 'red'])) : null;
    const mode = rng.next() < 0.5 ? 'range' : 'count';
    const g = R.createGame({ mode, seats, teams, rng, itemsOn: rng.next() < 0.8, randomMines: true });
    let present = seats.slice();
    let guard = 0;
    while (!g.over && guard++ < 1000) {
      const seat = R.current(g);
      assert.ok(g.order.indexOf(seat) >= 0);
      const roll = rng.next();
      if (roll < 0.03 && present.length > 1) {
        const who = present[rng.int(present.length)];
        R.removePlayer(g, who, present); present = present.filter(s => s !== who); continue;
      }
      if (roll < 0.2) {
        const it = R.ITEMS[rng.int(3)];
        const tg = R.assignTargets(g, seat);
        const r = R.useItem(g, seat, it, tg[rng.int(Math.max(1, tg.length))]);
        if (r.ok) continue;
      }
      R.autoAct(g, rng);
      if (mode === 'range' && !g.over) assert.ok(g.lo <= g.secret && g.secret <= g.hi);
    }
    assert.ok(g.over, '第 ' + k + ' 局沒有結束');
  }
});

console.log('規則測試全部通過：' + passed + ' 項');
