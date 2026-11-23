/* ===== storage.js — 本機儲存（全部包 try/catch：無痕、被擋時照樣能玩）=====
 * key 前綴 ultimate-code:v1。設定、暱稱、頭像、單人紀錄、對局明細、統計與成就。
 * 壞資料自動回預設，不會讓遊戲當掉；寫入失敗時 Store.saveOk 為 false（畫面可提示「未保存」）。
 */
(function (root) {
  'use strict';
  var KEY = 'ultimate-code:v1';
  var SCHEMA = 2;                // v2（2026-11-23）：單人改為收手計分，單人戰績與成就格式不同
  var KEEP = 100;                 // 對局明細最多保留 100 局
  var DEFAULTS = {
    ver: SCHEMA,
    profileId: '',
    nickname: '', avatar: 0, lang: '',
    musicOn: true, musicVol: 0.4, sfxOn: true, sfxVol: 0.8, vibrate: true,
    reduceMotion: false, colorAssist: false,
    inputMode: 'grid',            // grid 數字格／pad 數字鍵盤
    showRange: true,              // 單人破解：顯示範圍提示
    records: [],                  // 最近對局 { id, kind, result, metric, stars, at }
    seen: {},                     // 已結算的 matchId（去重，不隨明細清理）
    stats: {
      crack: { games: 0, wins: 0, best: 0, sum: 0, stars3: 0 },
      step: { games: 0, wins: 0, best: 0, sum: 0, stars3: 0 },
      online: { games: 0, wins: 0, hits: 0 }
    },
    ach: {}                       // achievementId → unlockedAt（ms）
  };
  var data = null;
  var saveOk = true;
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function load() {
    if (data) return data;
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') raw = {};
    data = clone(DEFAULTS);
    Object.keys(DEFAULTS).forEach(function (k) {
      if (raw[k] === undefined) return;
      if (typeof DEFAULTS[k] !== typeof raw[k]) return;
      if (Array.isArray(DEFAULTS[k]) !== Array.isArray(raw[k])) return;
      if (k === 'stats') {
        Object.keys(DEFAULTS.stats).forEach(function (s) { if (raw.stats[s] && typeof raw.stats[s] === 'object') data.stats[s] = Object.assign(clone(DEFAULTS.stats[s]), raw.stats[s]); });
      } else if (typeof DEFAULTS[k] === 'object' && !Array.isArray(DEFAULTS[k])) data[k] = Object.assign(clone(DEFAULTS[k]), raw[k]);
      else data[k] = raw[k];
    });
    data.records = data.records.filter(function (r) { return r && typeof r === 'object' && typeof r.id === 'string'; }).slice(-KEEP);
    if (!data.profileId) data.profileId = 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    if (raw.ver !== SCHEMA && raw.ver != null) {
      /* v1 單人是「次數越少越好」的破解／踩點，v2 是收手分數（越高越好）：單人戰績、紀錄與成就重置，線上戰績保留 */
      data.stats.crack = clone(DEFAULTS.stats.crack); data.stats.step = clone(DEFAULTS.stats.step);
      data.records = data.records.filter(function (r) { return r.kind === 'online'; });
      Object.keys(data.ach).forEach(function (id) { if (/^(crack|step)_/.test(id)) delete data.ach[id]; });
    }
    data.ver = SCHEMA;
    return data;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); saveOk = true; }
    catch (e) { saveOk = false; }
    return saveOk;
  }
  var listeners = [];
  function get(k) { return load()[k]; }
  function set(k, v) { load()[k] = v; save(); listeners.forEach(function (f) { try { f(k, v); } catch (e) { /* 忽略 */ } }); }
  function onChange(f) { listeners.push(f); }
  /** 恢復預設設定（暱稱、頭像、語言、紀錄與成就保留） */
  function resetSettings() {
    var d = load();
    var keep = { profileId: d.profileId, nickname: d.nickname, avatar: d.avatar, lang: d.lang, records: d.records, seen: d.seen, stats: d.stats, ach: d.ach };
    data = Object.assign(clone(DEFAULTS), keep);
    save();
    listeners.forEach(function (f) { try { f('*', null); } catch (e) { /* 忽略 */ } });
  }
  /** 清除紀錄與成就（設定保留） */
  function clearRecords() {
    var d = load();
    d.records = []; d.seen = {}; d.stats = clone(DEFAULTS.stats); d.ach = {};
    save();
  }

  /* ---------- 成就定義（穩定 id、門檻與計入模式） ---------- */
  var ACH = [
    { id: 'crack_bank', icon: 'flag', test: function (s) { return s.crack.wins >= 1; } },
    { id: 'crack_3star', icon: 'star', test: function (s) { return s.crack.stars3 >= 1; } },
    { id: 'crack_max', icon: 'safe', test: function (s, r) { return !!(r && r.kind === 'crack' && r.result === 'win' && r.metric >= 99); } },
    { id: 'step_bank', icon: 'target', test: function (s) { return s.step.wins >= 1; } },
    { id: 'step_3star', icon: 'trophy', test: function (s) { return s.step.stars3 >= 1; } },
    { id: 'online_first', icon: 'users', test: function (s) { return s.online.games >= 1; } },
    { id: 'online_survivor', icon: 'crown', test: function (s) { return s.online.wins >= 5; }, goal: 5, prog: function (s) { return s.online.wins; } },
    { id: 'games_10', icon: 'medal', test: function (s) { return s.crack.games + s.step.games + s.online.games >= 10; }, goal: 10, prog: function (s) { return s.crack.games + s.step.games + s.online.games; } }
  ];

  /**
   * 結算一局（以 matchId 去重：重開結算、重連補送都只計一次）。
   * @param {{id:string, kind:'crack'|'step'|'online', result:'win'|'lose'|'draw'|'left', metric?:number, stars?:number, hits?:number}} r
   * @returns {{counted:boolean, best:boolean, unlocked:string[]}}
   */
  function recordMatch(r) {
    var d = load();
    if (!r || !r.id || d.seen[r.id]) return { counted: false, best: false, unlocked: [] };
    d.seen[r.id] = Date.now();
    var keys = Object.keys(d.seen);
    if (keys.length > 2000) keys.sort(function (a, b) { return d.seen[a] - d.seen[b]; }).slice(0, keys.length - 2000).forEach(function (k) { delete d.seen[k]; });
    var s = d.stats, best = false;
    if (r.kind === 'crack' || r.kind === 'step') {
      /* 單人：收手（win）才計分；分數越高越好；踩中（lose）只算局數 */
      var k = s[r.kind];
      k.games++;
      if (r.result === 'win') {
        k.wins++; k.sum += r.metric || 0;
        if ((r.metric || 0) > (k.best || 0)) { best = true; k.best = r.metric; }
        if (r.stars === 3) k.stars3++;
      }
    } else if (r.kind === 'online') {
      s.online.games++;
      if (r.result === 'win' || r.result === 'draw') s.online.wins++;
      s.online.hits += r.hits || 0;
    }
    d.records.push({ id: r.id, kind: r.kind, mode: r.mode || '', result: r.result, metric: r.metric || 0, stars: r.stars || 0, at: Date.now() });
    if (d.records.length > KEEP) d.records = d.records.slice(-KEEP);
    var unlocked = [];
    ACH.forEach(function (a) {
      if (d.ach[a.id]) return;
      if (a.test(s, r)) { d.ach[a.id] = Date.now(); unlocked.push(a.id); }
    });
    save();
    return { counted: true, best: best, unlocked: unlocked };
  }

  /* 每個瀏覽器分頁一個祕密 id：斷線重連靠它認出同一個人 */
  function clientId() {
    var id = '';
    try { id = sessionStorage.getItem('ultimate-code:cid') || ''; } catch (e) { id = ''; }
    if (!id) {
      id = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
      try { sessionStorage.setItem('ultimate-code:cid', id); } catch (e) { /* 忽略 */ }
    }
    return id;
  }

  root.Store = {
    get: get, set: set, onChange: onChange, resetSettings: resetSettings, clearRecords: clearRecords, DEFAULTS: DEFAULTS, save: save,
    recordMatch: recordMatch, ACH: ACH, clientId: clientId, KEEP: KEEP,
    get saveOk() { return saveOk; },
    _reload: function () { data = null; return load(); }
  };
})(typeof self !== 'undefined' ? self : this);
