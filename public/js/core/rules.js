/* ===== core/rules.js — 終極密碼規則核心（瀏覽器、單人與伺服器共用）=====
 *
 * 沒有任何 I/O：不碰畫面、儲存、網路與時間。亂數一律從外面注入（rng），方便重播與測試。
 * 函式會直接修改傳進來的 game 物件，並回傳 { ok, err?, ev? } 讓呼叫端知道發生什麼事。
 *
 * 兩種玩法
 *   range 一般模式（範圍縮小）：密碼在 [lo, hi]，猜中的人輸；猜小 → [g+1, hi]，猜大 → [lo, g-1]。
 *   count 累加模式（隱藏地雷）：目前數字從 0 起，每回合 +1／+2／+3（不能超過 100）。1～100 藏著一顆地雷
 *         （就是密碼，電腦或出題玩家設定，其他人看不到），停在地雷上或跨過地雷都算踩中——數字只增不減，所以一定有人踩中。
 * 道具（每人各 1 個、用完就沒）：skip 跳過、reverse 迴轉（輪到上一位）、assign 指定（任何其他猜題者）。
 * 使用道具就是這回合的行動，不改變範圍或累加數字。
 *
 * 出手順序 order 是「猜題者座位」陣列（出題者不在裡面），pos 指向目前輪到的人，dir 為 1／-1。
 * 組隊時 order 依紅藍交錯排；踩中的人所屬隊伍輸。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UCRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN = 1, MAX = 100;
  var TARGET = 100;                      // 累加模式上限（地雷最大也只到 100）
  var STEPS = [1, 2, 3];
  var ITEMS = ['skip', 'reverse', 'assign'];
  var TEAMS = ['red', 'blue'];
  var ROUNDS = [1, 3, 5];
  var TURN_SECS = [10, 20, 30];          // 每回合限時（秒）
  var CAP_MIN = 2, CAP_MAX = 8;

  /* ---------- 亂數（可注入種子） ---------- */
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  /** mulberry32：給種子（數字或字串）就能重現同一串亂數 */
  function rngFrom(seed) {
    var a = typeof seed === 'number' ? seed >>> 0 : hashStr(seed);
    function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return { next: next, int: function (n) { return Math.floor(next() * n); }, range: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); } };
  }
  function randomSeed() { return Math.floor(Math.random() * 4294967296).toString(36) + Date.now().toString(36); }

  /* ---------- 出手順序 ---------- */
  /**
   * 紅藍交錯（紅、藍、紅、藍…），人數不等時其餘接在後面；不組隊就照座位順序。
   * @param {number[]} seats 猜題者座位（已排除出題者，依座位順序）
   * @param {Object<number,string>|null} teams 座位 → 'red'|'blue'
   * @param {string} [firstTeam] 從哪一隊開始（預設紅隊）
   */
  function buildOrder(seats, teams, firstTeam) {
    if (!teams) return seats.slice();
    var a = firstTeam === 'blue' ? 'blue' : 'red', b = a === 'red' ? 'blue' : 'red';
    var A = seats.filter(function (s) { return teams[s] === a; });
    var B = seats.filter(function (s) { return teams[s] === b; });
    var out = [];
    for (var i = 0; i < Math.max(A.length, B.length); i++) {
      if (i < A.length) out.push(A[i]);
      if (i < B.length) out.push(B[i]);
    }
    return out;
  }

  /* ---------- 建立一局 ---------- */
  /**
   * @param {{mode:'range'|'count', seats:number[], teams?:Object|null, setter?:number|null,
   *   secret?:number, itemsOn?:boolean, rng?:object, startPos?:number, firstTeam?:string}} o
   * seats：參加本局的全部座位（含出題者）；setter：出題玩家座位（null＝電腦出題）
   */
  function createGame(o) {
    var mode = o.mode === 'count' ? 'count' : 'range';
    var rng = o.rng || rngFrom(randomSeed());
    var setter = o.setter != null && o.seats.indexOf(o.setter) >= 0 ? o.setter : null;
    var guessers = o.seats.filter(function (s) { return s !== setter; });
    var teams = o.teams || null;
    var order = buildOrder(guessers, teams, o.firstTeam);
    var items = {};
    o.seats.forEach(function (s) { items[s] = { skip: o.itemsOn === false ? 0 : 1, reverse: o.itemsOn === false ? 0 : 1, assign: o.itemsOn === false ? 0 : 1 }; });
    var g = {
      mode: mode, lo: MIN, hi: MAX, total: 0, secret: null,
      setter: setter, teams: teams, itemsOn: o.itemsOn !== false,
      order: order, pos: order.length ? ((o.startPos || 0) % order.length + order.length) % order.length : 0, dir: 1,
      items: items, history: [], over: false, loser: null, loserTeam: null, reason: null, winners: [], turnNo: 1
    };
    /* 兩種模式都有一個 1～100 的密碼：一般模式猜中它輸；累加模式它是地雷，踩到或跨過它輸 */
    var sec = Number(o.secret);
    g.secret = Number.isInteger(sec) && sec >= MIN && sec <= MAX ? sec : rng.range(MIN, MAX);
    if (order.length < 1) endGame(g, null, 'empty');
    return g;
  }

  function current(g) { return g.over || !g.order.length ? null : g.order[g.pos]; }
  function isGuesser(g, seat) { return g.order.indexOf(seat) >= 0; }
  function teamOf(g, seat) { return g.teams ? g.teams[seat] || null : null; }

  /** 往 dir 方向前進一位 */
  function advance(g) {
    var n = g.order.length;
    if (!n) return;
    g.pos = ((g.pos + g.dir) % n + n) % n;
    g.turnNo++;
  }

  /* ---------- 合法性 ---------- */
  function legalGuess(g, v) { return g.mode === 'range' && Number.isInteger(v) && v >= g.lo && v <= g.hi; }
  function legalAdd(g, n) { return g.mode === 'count' && STEPS.indexOf(n) >= 0 && g.total + n <= TARGET; }
  function legalSteps(g) { return STEPS.filter(function (n) { return legalAdd(g, n); }); }
  /** 指定道具可選的對象：其他仍在順序裡的猜題者（不含自己與出題者） */
  function assignTargets(g, seat) { return g.order.filter(function (s) { return s !== seat; }); }

  function check(g, seat) {
    if (g.over) return 'over';
    if (current(g) !== seat) return 'not_turn';
    return null;
  }

  /* ---------- 行動 ---------- */
  /** 一般模式猜一個數字 */
  function guess(g, seat, v, auto) {
    var err = check(g, seat); if (err) return { ok: false, err: err };
    v = Number(v);
    if (!legalGuess(g, v)) return { ok: false, err: 'bad_guess' };
    var result = v === g.secret ? 'hit' : v < g.secret ? 'low' : 'high';
    var ev = { seat: seat, kind: 'guess', value: v, result: result, lo: g.lo, hi: g.hi, auto: !!auto, turn: g.turnNo };
    if (result === 'low') g.lo = v + 1;
    else if (result === 'high') g.hi = v - 1;
    ev.nlo = g.lo; ev.nhi = g.hi;
    g.history.push(ev);
    if (result === 'hit') endGame(g, seat, 'hit');
    else advance(g);
    return { ok: true, ev: ev };
  }

  /** 累加模式 +n */
  function add(g, seat, n, auto) {
    var err = check(g, seat); if (err) return { ok: false, err: err };
    n = Number(n);
    if (!legalAdd(g, n)) return { ok: false, err: 'bad_add' };
    var from = g.total;
    g.total += n;
    var boom = from < g.secret && g.secret <= g.total;     // 停在地雷上或跨過地雷
    var ev = { seat: seat, kind: 'add', value: n, from: from, to: g.total, result: boom ? 'hit' : 'ok', mineAt: boom ? g.secret : undefined, auto: !!auto, turn: g.turnNo };
    g.history.push(ev);
    if (boom) endGame(g, seat, 'hit');
    else advance(g);
    return { ok: true, ev: ev };
  }

  /** 使用道具 */
  function useItem(g, seat, item, target) {
    var err = check(g, seat); if (err) return { ok: false, err: err };
    if (!g.itemsOn) return { ok: false, err: 'items_off' };
    if (ITEMS.indexOf(item) < 0) return { ok: false, err: 'bad_item' };
    var bag = g.items[seat];
    if (!bag || bag[item] < 1) return { ok: false, err: 'no_item' };
    var ev = { seat: seat, kind: 'item', item: item, turn: g.turnNo };
    if (item === 'assign') {
      target = Number(target);
      if (assignTargets(g, seat).indexOf(target) < 0) return { ok: false, err: 'bad_target' };
      ev.target = target;
      bag.assign--;
      g.pos = g.order.indexOf(target);
      g.turnNo++;
    } else if (item === 'reverse') {
      bag.reverse--;
      g.dir = -g.dir;
      ev.dir = g.dir;
      advance(g);                       // 反向後輪到「上一位」；只有 2 人時等同跳過
    } else {
      bag.skip--;
      advance(g);
    }
    ev.next = current(g);
    g.history.push(ev);
    return { ok: true, ev: ev };
  }

  /** 逾時／斷線自動行動：一般＝範圍內隨機猜；累加＝+1 */
  function autoAct(g, rng) {
    var seat = current(g);
    if (seat == null) return { ok: false, err: 'over' };
    if (g.mode === 'range') return guess(g, seat, (rng || rngFrom(randomSeed())).range(g.lo, g.hi), true);
    return add(g, seat, 1, true);
  }

  /* ---------- 離場 ---------- */
  /**
   * 玩家離場（斷線超時、離開房間、掛機）：從順序移除、道具作廢；
   * 剩下的人不足以繼續時直接結束（只剩 1 位猜題者／組隊只剩 1 隊）。
   * @param {number[]} present 仍在場的座位（含出題者），用來判斷組隊是否只剩一隊
   */
  function removePlayer(g, seat, present) {
    if (g.items[seat]) g.items[seat] = { skip: 0, reverse: 0, assign: 0 };
    var idx = g.order.indexOf(seat);
    if (idx >= 0 && !g.over) {
      var wasCurrent = idx === g.pos;
      g.order.splice(idx, 1);
      var n = g.order.length;
      if (n) {
        if (idx < g.pos) g.pos--;
        else if (wasCurrent && g.dir === -1) g.pos--;
        g.pos = ((g.pos % n) + n) % n;
      } else g.pos = 0;
    }
    if (g.over) return { ok: true, ended: false };
    present = (present || []).filter(function (s) { return s !== seat; });
    if (g.teams) {
      var alive = TEAMS.filter(function (t) { return present.some(function (s) { return g.teams[s] === t; }); });
      if (alive.length <= 1) { endGame(g, null, 'left', alive[0] || null); return { ok: true, ended: true }; }
      if (!g.order.length) { endGame(g, null, 'left'); return { ok: true, ended: true }; }
    } else if (g.order.length <= 1) {
      endGame(g, null, 'left');
      return { ok: true, ended: true };
    }
    return { ok: true, ended: false };
  }

  /* ---------- 結束 ---------- */
  /**
   * @param {number|null} loser 踩中的人；null＝因離場結束（沒有輸家）
   * @param {string} [winTeam] 離場結束時剩下的隊伍
   */
  function endGame(g, loser, reason, winTeam) {
    g.over = true;
    g.reason = reason;
    g.loser = loser;
    g.loserTeam = loser != null ? teamOf(g, loser) : null;
    if (g.teams) {
      if (g.loserTeam) g.winTeam = g.loserTeam === 'red' ? 'blue' : 'red';
      else g.winTeam = winTeam || null;
    }
  }

  /* ---------- 局數（多局制） ---------- */
  /**
   * 多局比賽：每局踩中的人（或隊）記 1 次「中標」，打完後中標最少者（最少隊）贏，同分並列。
   * @param {{rounds:number, seats:number[], teams?:Object|null}} o
   */
  function createMatch(o) {
    var hits = {};
    o.seats.forEach(function (s) { hits[s] = 0; });
    return { rounds: ROUNDS.indexOf(o.rounds) >= 0 ? o.rounds : 1, round: 0, seats: o.seats.slice(), teams: o.teams || null, hits: hits, teamHits: { red: 0, blue: 0 }, log: [] };
  }
  /** 一局結束後記錄 */
  function recordRound(m, g) {
    if (g.loser != null) {
      m.hits[g.loser] = (m.hits[g.loser] || 0) + 1;
      if (g.loserTeam) m.teamHits[g.loserTeam]++;
    }
    m.log.push({ loser: g.loser, loserTeam: g.loserTeam, reason: g.reason, secret: g.secret, total: g.total });
    m.round++;
    return m;
  }
  function matchOver(m) { return m.round >= m.rounds; }
  /**
   * 比賽結果：中標最少者贏（同分並列）。
   * @param {number[]} [present] 仍在場的座位；有傳就只在這些人之中比
   */
  function standings(m, present) {
    if (m.teams) {
      var tr = m.teamHits.red, tb = m.teamHits.blue;
      var alive = TEAMS.filter(function (t) { return !present || present.some(function (s) { return m.teams[s] === t; }); });
      var winTeams = alive.length === 1 ? alive : tr === tb ? ['red', 'blue'] : [tr < tb ? 'red' : 'blue'];
      return { teams: true, winTeams: winTeams, teamHits: { red: tr, blue: tb }, winners: m.seats.filter(function (s) { return winTeams.indexOf(m.teams[s]) >= 0 && (!present || present.indexOf(s) >= 0); }) };
    }
    var pool = present ? m.seats.filter(function (s) { return present.indexOf(s) >= 0; }) : m.seats;
    var best = Infinity;
    pool.forEach(function (s) { best = Math.min(best, m.hits[s] || 0); });
    return { teams: false, winners: pool.filter(function (s) { return (m.hits[s] || 0) === best; }), hits: Object.assign({}, m.hits) };
  }

  /**
   * 「隊友輪流出題」時第 round 局（0 起算）的出題者。
   * 不組隊：依座位順序輪替；組隊：兩隊交替，且只選「出題後還有隊友能猜」（人數 ≥ 2）的隊伍。
   * 回傳 null 代表人數不足以讓玩家出題。
   */
  function pickSetter(seats, teams, round) {
    if (!teams) return seats.length >= 3 ? seats[round % seats.length] : null;
    if (seats.length < 3) return null;
    var red = seats.filter(function (s) { return teams[s] === 'red'; });
    var blue = seats.filter(function (s) { return teams[s] === 'blue'; });
    if (!red.length || !blue.length) return null;
    var ok = [];
    if (red.length >= 2) ok.push(red);
    if (blue.length >= 2) ok.push(blue);
    if (!ok.length) return null;
    var team = ok[round % ok.length];
    var k = Math.floor(round / ok.length);
    return team[k % team.length];
  }
  /** 開局前檢查（伺服器與房間畫面共用） */
  function canStart(o) {
    var seats = o.seats || [];
    if (seats.length < 2) return 'need_players';
    if (o.teams) {
      var r = seats.filter(function (s) { return o.teams[s] === 'red'; }).length;
      var b = seats.filter(function (s) { return o.teams[s] === 'blue'; }).length;
      if (r + b !== seats.length) return 'pick_team';
      if (!r || !b) return 'team_empty';
    }
    if (o.setterMode === 'player' && pickSetter(seats, o.teams, 0) == null) return 'setter_need';
    return null;
  }

  /* ---------- 單人挑戰 ---------- */
  /** 一般．破解：用的次數越少星星越多（≤7 次 3★、≤9 次 2★、其餘 1★） */
  function crackStars(n) { return n <= 7 ? 3 : n <= 9 ? 2 : 1; }
  function createCrack(rng) {
    rng = rng || rngFrom(randomSeed());
    return { kind: 'crack', secret: rng.range(MIN, MAX), lo: MIN, hi: MAX, history: [], over: false, won: false };
  }
  /** 單人破解：猜中＝過關 */
  function crackGuess(c, v) {
    if (c.over) return { ok: false, err: 'over' };
    v = Number(v);
    if (!Number.isInteger(v) || v < c.lo || v > c.hi) return { ok: false, err: 'bad_guess' };
    var result = v === c.secret ? 'hit' : v < c.secret ? 'low' : 'high';
    var ev = { kind: 'guess', value: v, result: result, lo: c.lo, hi: c.hi };
    if (result === 'low') c.lo = v + 1; else if (result === 'high') c.hi = v - 1;
    ev.nlo = c.lo; ev.nhi = c.hi;
    c.history.push(ev);
    if (result === 'hit') { c.over = true; c.won = true; c.stars = crackStars(c.history.length); }
    return { ok: true, ev: ev };
  }

  var MINES = 5;
  /** 從 0 走到 100（每步 +1～+3、不停在地雷上）的最少步數；走不到回傳 -1 */
  function minSteps(mines) {
    var bad = {};
    mines.forEach(function (m) { bad[m] = true; });
    var dist = [0];
    for (var i = 1; i <= TARGET; i++) {
      dist[i] = -1;
      if (bad[i]) continue;
      var best = -1;
      for (var k = 1; k <= 3; k++) if (i - k >= 0 && dist[i - k] >= 0 && (best < 0 || dist[i - k] + 1 < best)) best = dist[i - k] + 1;
      dist[i] = best;
    }
    return dist[TARGET];
  }
  /**
   * 累加．踩點：5 個地雷放在 2～99，保證走得到，且至少 3 個落在 3 的倍數上（一路 +3 會踩到，需要動腦繞路）。
   */
  function createStep(rng) {
    rng = rng || rngFrom(randomSeed());
    for (var tries = 0; tries < 500; tries++) {
      var set = {}, list = [];
      var triples = 0;
      while (list.length < MINES) {
        var v = list.length < 3 ? 3 * rng.range(1, 33) : rng.range(2, 99);
        if (v < 2 || v > 99 || set[v]) continue;
        set[v] = true; list.push(v);
        if (v % 3 === 0) triples++;
      }
      list.sort(function (a, b) { return a - b; });
      var best = minSteps(list);
      if (best > 0 && triples >= 3) return { kind: 'step', mines: list, total: 0, steps: 0, best: best, path: [0], over: false, won: false, fail: null };
    }
    return { kind: 'step', mines: [10, 30, 50, 70, 90], total: 0, steps: 0, best: minSteps([10, 30, 50, 70, 90]), path: [0], over: false, won: false, fail: null };
  }
  /** 星數：等於最少步數 3★、多 2 步內 2★、其餘 1★ */
  function stepStars(steps, best) { return steps <= best ? 3 : steps <= best + 2 ? 2 : 1; }
  function stepAdd(s, n) {
    if (s.over) return { ok: false, err: 'over' };
    n = Number(n);
    if (STEPS.indexOf(n) < 0) return { ok: false, err: 'bad_add' };
    var from = s.total;
    s.total += n; s.steps++; s.path.push(s.total);
    var ev = { kind: 'add', value: n, from: from, to: s.total, result: 'ok' };
    if (s.total > TARGET) { s.over = true; s.fail = 'over'; ev.result = 'over'; }
    else if (s.mines.indexOf(s.total) >= 0) { s.over = true; s.fail = 'mine'; ev.result = 'mine'; }
    else if (s.total === TARGET) { s.over = true; s.won = true; s.stars = stepStars(s.steps, s.best); ev.result = 'goal'; }
    return { ok: true, ev: ev };
  }

  /* ---------- 房間設定（伺服器與畫面共用的驗證） ---------- */
  var DEFAULT_SETTINGS = { mode: 'range', setterMode: 'cpu', teams: false, items: true, turnSec: 30, rounds: 1, cap: 6 };
  function normSettings(raw, prev) {
    raw = raw || {};
    prev = prev || DEFAULT_SETTINGS;
    var pick = function (k, ok) { return raw[k] !== undefined && ok(raw[k]) ? raw[k] : prev[k]; };
    var out = {
      mode: pick('mode', function (v) { return v === 'range' || v === 'count'; }),
      setterMode: pick('setterMode', function (v) { return v === 'cpu' || v === 'player'; }),
      teams: pick('teams', function (v) { return typeof v === 'boolean'; }),
      items: pick('items', function (v) { return typeof v === 'boolean'; }),
      turnSec: Number(pick('turnSec', function (v) { return TURN_SECS.indexOf(Number(v)) >= 0; })),
      rounds: Number(pick('rounds', function (v) { return ROUNDS.indexOf(Number(v)) >= 0; })),
      cap: Number(pick('cap', function (v) { v = Number(v); return Number.isInteger(v) && v >= CAP_MIN && v <= CAP_MAX; }))
    };
    return out;
  }

  return {
    MIN: MIN, MAX: MAX, TARGET: TARGET, STEPS: STEPS, ITEMS: ITEMS, TEAMS: TEAMS, ROUNDS: ROUNDS, TURN_SECS: TURN_SECS,
    CAP_MIN: CAP_MIN, CAP_MAX: CAP_MAX, MINES: MINES, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    rngFrom: rngFrom, randomSeed: randomSeed, hashStr: hashStr,
    buildOrder: buildOrder, createGame: createGame, current: current, isGuesser: isGuesser, teamOf: teamOf,
    legalGuess: legalGuess, legalAdd: legalAdd, legalSteps: legalSteps, assignTargets: assignTargets,
    guess: guess, add: add, useItem: useItem, autoAct: autoAct, removePlayer: removePlayer, endGame: endGame,
    createMatch: createMatch, recordRound: recordRound, matchOver: matchOver, standings: standings, pickSetter: pickSetter, canStart: canStart,
    crackStars: crackStars, createCrack: createCrack, crackGuess: crackGuess,
    minSteps: minSteps, createStep: createStep, stepStars: stepStars, stepAdd: stepAdd,
    normSettings: normSettings
  };
});
