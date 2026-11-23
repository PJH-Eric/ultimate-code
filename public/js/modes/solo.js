/* ===== modes/solo.js — 單人挑戰（完全不連線；規則同線上，一個人玩）=====
 *   crack 一般．單人：密碼 1～100，猜中就爆炸。隨時可以「收手」，分數＝已排除的數字數（最高 99）。
 *   step  累加．單人：地雷 1～100，+1／+2／+3，停在地雷上或跨過就爆炸。隨時收手，分數＝收手時的數字。
 * 一個人玩最後一定會踩中，所以靠收手取捨：猜中間／加大步伐分數高，但風險也高。
 * 單人沒有對手，不使用道具、不限時；開局一樣有 3、2、1 倒數；踩中時先播全螢幕爆炸再進結算。
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
  function title(kind) { return t(kind === 'crack' ? 'mode.crack' : 'mode.step'); }

  function start(opt) {
    opt = opt || {};
    var kind = opt.kind === 'step' ? 'step' : 'crack';
    var st = R.createSolo(kind, R.rngFrom(opt.seed || R.randomSeed()), opt.secret);
    active = { kind: kind, st: st, id: 'solo-' + kind + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), phase: 'countdown', history: [], recorded: null };
    mood = 'think';
    text = T(kind === 'crack' ? 'host.soloRangeStart' : 'host.soloCountStart');
    root.Result.hide();
    root.GameView.reset();
    root.App.show('game');
    root.App.setTitle(title(kind));
    var a = active;
    if (opt.skipCountdown) { a.phase = 'play'; track(a); render(); return; }
    render();
    root.GameView.countdown(Date.now() + 3000, function () { if (active === a) { a.phase = 'play'; mood = 'idle'; track(a); render(); } });
  }

  function vm() {
    var a = active, st = a.st;
    var playing = a.phase === 'play' && !st.over;
    var score = R.soloScore(st);
    return {
      kind: 'solo', mode: a.kind === 'crack' ? 'range' : 'count', players: null, itemsOn: false, items: null,
      lo: st.lo, hi: st.hi, total: st.total, showRange: true,
      myTurn: playing, canAct: playing, over: st.over, hostMood: mood, hostText: text ? t(text[0], text[1]) : '', history: a.history, role: 'player',
      turnText: a.phase === 'countdown' ? t('game.getReady') : st.over ? (st.hit ? t('game.boomed') : t('game.banked')) : t('game.yourTurn'),
      counter: t('game.scoreNow', { n: score }),
      bankable: playing && a.history.length > 0, bankScore: score,
      summaryHtml: summary(score)
    };
  }
  function summary(score) {
    var a = active, s = root.Store.get('stats')[a.kind] || {};
    var th = R.SOLO_STARS[a.kind];
    var rows = [[t('sum.score'), score], [t('sum.best'), s.best || '—'], [t('sum.stars'), t('sum.soloStars', { a: th[0], b: th[1], c: th[2] })]];
    return '<div class="sum-mode"><b>' + esc(title(a.kind)) + '</b><span>' + esc(t(a.kind === 'crack' ? 'mode.crackSub' : 'mode.stepSub')) + '</span></div>' +
      '<dl class="sum-list">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
      '<p class="note">' + K.icon('question') + '<span>' + esc(t(a.kind === 'crack' ? 'sum.crackTip' : 'sum.stepTip')) + '</span></p>';
  }
  function render() { if (active) root.GameView.render(vm(), handlers); }

  var handlers = {
    guess: function (v) {
      var a = active; if (!a || a.kind !== 'crack' || a.phase !== 'play') return;
      var r = R.soloGuess(a.st, v);
      if (!r.ok) { K.toast(t('err.' + r.err), 'warn'); root.Sound.play('error'); return; }
      a.history.push(r.ev);
      if (r.ev.result === 'hit') { mood = 'boom'; text = T('host.soloHit', { n: v }); finish(true); }
      else { mood = r.ev.result; text = T(r.ev.result === 'low' ? 'host.low' : 'host.high', { n: v }); root.Sound.play('shrink'); }
      render();
    },
    add: function (n) {
      var a = active; if (!a || a.kind !== 'step' || a.phase !== 'play') return;
      var r = R.soloAdd(a.st, n);
      if (!r.ok) return;
      a.history.push(r.ev);
      if (r.ev.result === 'hit') { mood = 'boom'; text = T('host.soloMine', { n: r.ev.mineAt }); finish(true); }
      else { mood = 'idle'; text = T('host.soloAt', { n: r.ev.to }); root.Sound.play('shrink'); }
      render();
    },
    bank: function () {
      var a = active; if (!a || a.phase !== 'play') return;
      var r = R.soloBank(a.st);
      if (!r.ok) return;
      mood = 'happy'; text = T('host.soloBank', { n: r.score });
      root.Sound.play(r.stars ? 'win' : 'pop');
      finish(false);
      render();
    },
    item: function () { /* 單人不使用道具 */ }
  };

  /** GA4：開局與結束（同一個 matchId 只送一次） */
  function track(a) { if (root.GameAnalytics) root.GameAnalytics.start({ mode: 'solo', variant: a.kind }, a.id); }
  function finish(boom) {
    var a = active;
    a.phase = 'over';
    var st = a.st;
    if (root.GameAnalytics) root.GameAnalytics.end({ result: st.banked ? 'win' : 'lose' }, a.id);
    a.recorded = root.Store.recordMatch({ id: a.id, kind: a.kind, mode: a.kind === 'crack' ? 'range' : 'count', result: st.banked ? 'win' : 'lose', metric: st.score, stars: st.stars });
    if (boom) {
      /* 全螢幕爆炸播完再進結算 */
      root.GameView.explode(t(a.kind === 'crack' ? 'boom.secret' : 'boom.mine', { n: st.secret }), function () { if (active === a) showResult(); });
    } else setTimeout(function () { if (active === a) showResult(); }, 700);
  }
  function showResult() {
    var a = active;
    root.Result.show(function () {
      var st = a.st, out = a.recorded || { best: false, unlocked: [] };
      var badges = [];
      if (out.best) badges.push({ icon: 'trophy', text: t('res.newBest') });
      (out.unlocked || []).forEach(function (id) { badges.push({ icon: (root.Store.ACH.find(function (x) { return x.id === id; }) || {}).icon, text: t('ach.unlocked', { name: t('ach.' + id) }) }); });
      if (!root.Store.saveOk) badges.push({ icon: 'cross', text: t('res.notSaved') });
      var th = R.SOLO_STARS[a.kind];
      var o = {
        badges: badges,
        again: { onClick: function () { start({ kind: a.kind }); } },
        room: { disabled: true, note: t('res.noRoomSolo') },
        home: { onClick: function () { stop(); root.App.show('home'); } },
        reveal: a.kind === 'crack' ? { label: t('res.secret'), value: st.secret } : { label: t('res.mine'), value: st.secret, icon: 'mine' }
      };
      if (st.banked) {
        o.kind = 'win'; o.mood = 'happy'; o.stars = st.stars;
        o.title = t('res.soloBank', { n: st.score });
        o.sub = t(a.kind === 'crack' ? 'res.soloBankSubRange' : 'res.soloBankSubCount', { n: st.score });
        o.lines = [t('res.soloNext', { n: st.stars < 3 ? th[st.stars] : th[2] })];
      } else {
        o.kind = 'lose'; o.mood = 'boom'; o.again.label = t('res.retry');
        o.title = t(a.kind === 'crack' ? 'res.soloHitRange' : 'res.soloHitCount');
        o.sub = t('res.soloZero');
        o.lines = [t('res.soloTip')];
      }
      return o;
    });
  }

  function inProgress() { return !!(active && active.phase !== 'over' && active.history.length); }
  function stop() { active = null; root.GameView.stop(); root.Result.hide(); }

  function init() {
    K = root.Kit;
    root.I18N.onChange(function () {
      if (!active || root.App.screen !== 'game') return;
      root.App.setTitle(title(active.kind));
      render();
    });
  }

  root.Solo = { init: init, start: start, stop: stop, inProgress: inProgress, get active() { return active; } };
})(typeof self !== 'undefined' ? self : this);
