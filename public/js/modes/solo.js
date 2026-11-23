/* ===== modes/solo.js — 單人挑戰（完全不連線）=====
 *   crack 一般．破解：電腦出題 1～100，自己猜，猜中過關；次數越少星星越多（可選顯示範圍提示）。
 *   step  累加．踩點：從 0 用 +1／+2／+3 剛好走到 100，避開 5 個地雷；步數越少星星越多。
 * 單人沒有對手，不使用道具、不限時；開局一樣有 3、2、1 倒數。
 */
(function (root) {
  'use strict';
  var R = root.UCRules;
  var K, active = null;
  var mood = 'idle', text = '';

  function t(k, p) { return root.I18N.t(k, p); }
  function esc(s) { return K.esc(s); }
  /** 主持人台詞存 key 與參數，切換語言時才能重翻 */
  function T(k, p) { return [k, p]; }

  function start(opt) {
    opt = opt || {};
    var kind = opt.kind === 'step' ? 'step' : 'crack';
    var rng = R.rngFrom(opt.seed || R.randomSeed());
    var st = kind === 'crack' ? R.createCrack(rng) : R.createStep(rng);
    active = { kind: kind, st: st, id: 'solo-' + kind + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), phase: 'countdown', history: [], recorded: null };
    mood = kind === 'crack' ? 'think' : 'idle';
    text = T(kind === 'crack' ? 'host.crackStart' : 'host.stepStart');
    root.Result.hide();
    root.GameView.reset();
    root.App.show('game');
    root.App.setTitle(t(kind === 'crack' ? 'mode.crack' : 'mode.step'));
    var a = active;
    if (opt.skipCountdown) { a.phase = 'play'; track(a); render(); return; }
    render();
    root.GameView.countdown(Date.now() + 3000, function () { if (active === a) { a.phase = 'play'; track(a); mood = a.kind === 'crack' ? 'idle' : 'idle'; render(); } });
  }

  function vm() {
    var a = active, st = a.st;
    var playing = a.phase === 'play' && !st.over;
    var base = {
      kind: a.kind, mode: a.kind === 'crack' ? 'range' : 'count', players: null, itemsOn: false, items: null,
      myTurn: playing, canAct: playing, over: st.over, hostMood: mood, hostText: text ? t(text[0], text[1]) : '', history: a.history, role: 'player',
      turnText: a.phase === 'countdown' ? t('game.getReady') : st.over ? (st.won ? t('game.cleared') : t('game.failed')) : t('game.yourTurn'),
      summaryHtml: summary()
    };
    if (a.kind === 'crack') {
      base.lo = st.lo; base.hi = st.hi; base.showRange = root.Store.get('showRange') !== false;
      base.counter = t('game.guessN', { n: st.history.length });
    } else {
      base.total = st.total; base.mines = st.mines; base.path = st.path;
      base.counter = t('game.stepN', { n: st.steps, best: st.best });
    }
    return base;
  }
  function summary() {
    var a = active, st = a.st, s = root.Store.get('stats');
    var rows;
    if (a.kind === 'crack') {
      rows = [[t('sum.guesses'), st.history.length], [t('sum.best'), s.crack.best || '—'], [t('sum.stars'), t('sum.crackStars')]];
    } else {
      rows = [[t('sum.steps'), st.steps], [t('sum.minSteps'), st.best], [t('sum.best'), s.step.best || '—'], [t('sum.stars'), t('sum.stepStars', { a: st.best, b: st.best + 2 })]];
    }
    return '<div class="sum-mode"><b>' + esc(t(a.kind === 'crack' ? 'mode.crack' : 'mode.step')) + '</b><span>' + esc(t(a.kind === 'crack' ? 'mode.crackSub' : 'mode.stepSub')) + '</span></div>' +
      '<dl class="sum-list">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
      (a.kind === 'crack' ? '<div class="switch-row"><span id="sum-hint-l">' + esc(t('sum.hint')) + '</span>' + K.switchHtml('sum-hint', root.Store.get('showRange') !== false, t('sum.hint')) + '</div>' : '') +
      '<p class="note">' + K.icon('question') + '<span>' + esc(t(a.kind === 'crack' ? 'sum.crackTip' : 'sum.stepTip')) + '</span></p>';
  }
  function render() { if (active) root.GameView.render(vm(), handlers); }

  var handlers = {
    guess: function (v) {
      var a = active; if (!a || a.kind !== 'crack' || a.phase !== 'play') return;
      var r = R.crackGuess(a.st, v);
      if (!r.ok) { K.toast(t('err.' + r.err), 'warn'); root.Sound.play('error'); return; }
      a.history.push(r.ev);
      if (r.ev.result === 'hit') { mood = 'happy'; text = T('host.crackWin', { n: a.st.history.length }); root.Sound.play('win'); root.Sound.vibrate([30, 40, 30]); finish(); }
      else { mood = r.ev.result; text = T(r.ev.result === 'low' ? 'host.low' : 'host.high', { n: v }); root.Sound.play('shrink'); }
      render();
    },
    add: function (n) {
      var a = active; if (!a || a.kind !== 'step' || a.phase !== 'play') return;
      var r = R.stepAdd(a.st, n);
      if (!r.ok) return;
      a.history.push(r.ev);
      if (r.ev.result === 'mine') { mood = 'boom'; text = T('host.mine', { n: r.ev.to }); root.Sound.play('boom'); root.Sound.vibrate(200); finish(); }
      else if (r.ev.result === 'over') { mood = 'boom'; text = T('host.over'); root.Sound.play('lose'); finish(); }
      else if (r.ev.result === 'goal') { mood = 'happy'; text = T('host.goal', { n: a.st.steps }); root.Sound.play('win'); finish(); }
      else { mood = 'idle'; text = T('host.stepAt', { n: r.ev.to, left: 100 - r.ev.to }); root.Sound.play('shrink'); }
      render();
    },
    item: function () { /* 單人不使用道具 */ }
  };

  /** GA4：開局與結束（同一個 matchId 只送一次） */
  function track(a) { if (root.GameAnalytics) root.GameAnalytics.start({ mode: 'solo', variant: a.kind }, a.id); }
  function finish() {
    var a = active;
    a.phase = 'over';
    if (root.GameAnalytics) root.GameAnalytics.end({ result: a.st.won ? 'win' : 'lose' }, a.id);
    var st = a.st;
    var rec = a.kind === 'crack'
      ? { id: a.id, kind: 'crack', mode: 'range', result: 'win', metric: st.history.length, stars: st.stars }
      : { id: a.id, kind: 'step', mode: 'count', result: st.won ? 'win' : 'lose', metric: st.steps, stars: st.stars || 0 };
    a.recorded = root.Store.recordMatch(rec);
    setTimeout(function () { if (active === a) showResult(); }, st.won ? 900 : 1300);
  }
  function showResult() {
    var a = active;
    root.Result.show(function () {
      var st = a.st, out = a.recorded || { best: false, unlocked: [] };
      var badges = [];
      if (out.best) badges.push({ icon: 'trophy', text: t('res.newBest') });
      (out.unlocked || []).forEach(function (id) { badges.push({ icon: (root.Store.ACH.find(function (x) { return x.id === id; }) || {}).icon, text: t('ach.unlocked', { name: t('ach.' + id) }) }); });
      if (!root.Store.saveOk) badges.push({ icon: 'cross', text: t('res.notSaved') });
      var o = {
        mood: st.won ? 'happy' : 'boom', badges: badges,
        again: { onClick: function () { start({ kind: a.kind }); } },
        room: { disabled: true, note: t('res.noRoomSolo') },
        home: { onClick: function () { stop(); root.App.show('home'); } }
      };
      if (a.kind === 'crack') {
        o.kind = 'win'; o.title = t('res.crackWin'); o.sub = t('res.crackSub', { n: st.history.length });
        o.stars = st.stars; o.reveal = { label: t('res.secret'), value: st.secret };
        o.lines = [t('res.crackLine')];
      } else if (st.won) {
        o.kind = 'win'; o.title = t('res.stepWin'); o.sub = t('res.stepSub', { n: st.steps, best: st.best }); o.stars = st.stars;
        o.reveal = { label: t('res.goal'), value: 100, icon: 'target' };
      } else {
        o.kind = 'lose'; o.title = t(st.fail === 'mine' ? 'res.stepMine' : 'res.stepOver');
        o.sub = t(st.fail === 'mine' ? 'res.stepMineSub' : 'res.stepOverSub', { n: st.total });
        o.again.label = t('res.retry');
        o.lines = [t('res.stepTip', { n: st.best })];
      }
      return o;
    });
  }

  function inProgress() { return !!(active && active.phase !== 'over' && (active.kind === 'crack' ? active.st.history.length : active.st.steps)); }
  function stop() { active = null; root.GameView.stop(); root.Result.hide(); }

  function init() {
    K = root.Kit;
    root.document.getElementById('summary').addEventListener('click', function (e) {
      var sw = e.target.closest('#sum-hint');
      if (!sw || !active) return;
      root.Store.set('showRange', !(root.Store.get('showRange') !== false));
      root.Sound.play('key');
      render();
      var again = root.document.getElementById('sum-hint'); if (again) again.focus({ preventScroll: true });
    });
    root.I18N.onChange(function () {
      if (!active || root.App.screen !== 'game') return;
      root.App.setTitle(t(active.kind === 'crack' ? 'mode.crack' : 'mode.step'));
      render();
    });
  }

  root.Solo = { init: init, start: start, stop: stop, inProgress: inProgress, get active() { return active; } };
})(typeof self !== 'undefined' ? self : this);
