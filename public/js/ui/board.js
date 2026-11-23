/* ===== ui/board.js — 遊戲畫面（單人與線上共用）=====
 * 由模式層（solo.js／online-ui.js）組好「畫面模型 vm」交給 GameView.render(vm, handlers)。
 * 這裡只負責畫：玩家卡、輪到誰與倒數、保險箱轉盤、範圍刻度條、10×10 數字格／數字鍵盤、
 * 累加三顆大按鈕、道具列、歷史紀錄；不碰規則判定。
 *
 * vm：{ kind:'crack'|'step'|'online', mode:'range'|'count', lo, hi, total, mines?, path?, showRange?,
 *       players?:[{seat,name,avatar,team,items,hits,me,current,setter,out,connected}], dir, deadline, turnSec,
 *       turnText, myTurn, canAct, itemsOn, items?, targets?:[{seat,name}], history:[], secret?, role,
 *       hostMood, hostText, summaryHtml, counter? }
 * handlers：{ guess(v), add(n), item(name, target) }
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var K, vm = null, H = {};
  var sel = null;                 // 目前選的數字（一般模式）
  var typed = '';                 // 鍵盤輸入緩衝
  var timer = null, lastWarnSec = -1;
  var histSeen = 0, tab = 'play';
  var cdTimer = null;

  function $(id) { return doc.getElementById(id); }
  function t(k, p) { return root.I18N.t(k, p); }
  function esc(s) { return K.esc(s); }

  /* ---------- 數字字形 ---------- */
  /** 用自繪 SVG 字形畫數字（每一位一格轉盤） */
  function dial(n, cls) {
    var s = String(n);
    return '<span class="dial ' + (cls || '') + '" role="img" aria-label="' + esc(s) + '">' + s.split('').map(function (ch) {
      return '<span class="dial-d">' + root.Art.svg('digits', Number(ch)) + '</span>';
    }).join('') + '</span>';
  }
  function avatar(i, cls) { return root.Art.svg('avatars', Number(i) || 0, cls || ''); }
  function hostSvg(mood, cls) {
    var idx = { idle: 0, think: 1, low: 2, high: 3, boom: 4, happy: 5, sleep: 6 }[mood || 'idle'] || 0;
    return root.Art.svg('host', idx, cls || '');
  }
  function teamMark(team) { return team ? '<i class="team-mark ' + team + '" title="' + esc(t('team.' + team)) + '">' + K.icon('team-' + team) + '</i>' : ''; }

  /* ---------- 玩家卡 ---------- */
  function renderPlayers() {
    var box = $('g-players');
    if (!vm.players || !vm.players.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = vm.players.map(function (p) {
      var cls = ['pc'];
      if (p.current) cls.push('cur');
      if (p.me) cls.push('me');
      if (p.out) cls.push('out');
      if (p.setter) cls.push('setter');
      if (p.team) cls.push('t-' + p.team);
      var pips = vm.itemsOn ? '<span class="pc-items" aria-label="' + esc(t('game.itemsLeft', { a: p.items.skip, b: p.items.reverse, c: p.items.assign })) + '">' +
        ['skip', 'reverse', 'assign'].map(function (k) { return '<i class="' + (p.items[k] > 0 ? 'on' : '') + '">' + K.icon(k) + '</i>'; }).join('') + '</span>' : '';
      var tag = p.setter ? '<em class="pc-tag setter">' + K.icon('safe') + esc(t('game.setter')) + '</em>' :
        p.out ? '<em class="pc-tag out">' + esc(t('game.out')) + '</em>' :
        p.connected === false ? '<em class="pc-tag dc">' + esc(t('game.dc')) + '</em>' : '';
      var label = p.name + (p.me ? t('game.meSuffix') : '') + (p.team ? '，' + t('team.' + p.team) : '') + (p.current ? '，' + t('game.nowTurn') : '');
      return '<div class="' + cls.join(' ') + '" role="listitem" aria-label="' + esc(label) + '">' +
        '<span class="pc-av">' + avatar(p.avatar) + teamMark(p.team) + '</span>' +
        '<span class="pc-body"><b class="pc-name">' + esc(p.name) + (p.me ? '<small>' + esc(t('game.meSuffix')) + '</small>' : '') + '</b>' +
        '<span class="pc-sub">' + tag + pips + (p.hits ? '<i class="pc-hits" title="' + esc(t('game.hitsT')) + '">' + K.icon('mine') + p.hits + '</i>' : '') + '</span></span></div>';
    }).join('');
  }

  /* ---------- 輪到誰＋倒數 ---------- */
  function renderTurn() {
    var box = $('g-turn');
    var dirIco = vm.dir === -1 ? 'arrow-left' : 'arrow-right';
    var showDir = vm.players && vm.players.length > 2;
    box.className = 'g-turn' + (vm.myTurn ? ' mine' : '') + (vm.over ? ' over' : '');
    box.innerHTML = '<span class="gt-text">' + (vm.myTurn ? K.icon('hand-raise') : '') + '<b>' + esc(vm.turnText || '') + '</b></span>' +
      (vm.counter ? '<span class="gt-counter">' + esc(vm.counter) + '</span>' : '') +
      (showDir ? '<span class="gt-dir" title="' + esc(t(vm.dir === -1 ? 'game.dirBack' : 'game.dirFwd')) + '">' + K.icon(dirIco) + '</span>' : '') +
      (vm.deadline ? '<span class="gt-timer" role="timer"><span class="gt-bar"><i></i></span><b class="gt-sec">' + K.fmtTime(Math.max(0, vm.deadline - Date.now())) + '</b></span>' : '');
    startTimer();
  }
  function startTimer() {
    clearInterval(timer); timer = null; lastWarnSec = -1;
    if (!vm || !vm.deadline || vm.over) return;
    var total = (vm.turnSec || 30) * 1000;
    function tick() {
      var box = $('g-turn');
      var bar = box.querySelector('.gt-bar i'), num = box.querySelector('.gt-sec');
      if (!bar || !num || !vm || !vm.deadline) { clearInterval(timer); timer = null; return; }
      var left = Math.max(0, vm.deadline - Date.now());
      var txt = K.fmtTime(left);
      if (num.textContent !== txt) num.textContent = txt;
      bar.style.width = Math.min(100, left * 100 / total) + '%';
      var warn = left > 0 && left <= 10000;
      box.classList.toggle('warn', warn);
      var sec = Math.ceil(left / 1000);
      if (warn && vm.myTurn && sec !== lastWarnSec) { lastWarnSec = sec; root.Sound.play('warn'); }
      if (!left) { clearInterval(timer); timer = null; }
    }
    tick();
    timer = setInterval(tick, 50);
  }

  /* ---------- 主盤面 ---------- */
  function hostBlock() {
    return '<div class="host"><span class="host-art" aria-hidden="true">' + hostSvg(vm.hostMood, 'host-svg') + '</span>' +
      '<p class="bubble" role="status">' + esc(vm.hostText || '') + '</p></div>';
  }
  function itemsBlock() {
    if (!vm.itemsOn || !vm.items) return '';
    var can = vm.canAct;
    return '<div class="items-row" role="group" aria-label="' + esc(t('game.items')) + '">' + ['skip', 'reverse', 'assign'].map(function (k) {
      var n = vm.items[k] || 0;
      var dis = !can || n < 1 || (k === 'assign' && !(vm.targets && vm.targets.length));
      return '<button type="button" class="item-btn it-' + k + '" data-item="' + k + '"' + (dis ? ' disabled' : '') + ' aria-haspopup="' + (k === 'assign' ? 'listbox' : 'false') + '" title="' + esc(t('item.' + k + 'Help')) + '">' +
        K.icon(k) + '<span>' + esc(t('item.' + k)) + '</span><i class="item-n">' + n + '</i></button>';
    }).join('') + '</div>';
  }
  function rangeBoard() {
    var hint = vm.showRange !== false;
    var lo = vm.lo, hi = vm.hi;
    var html = '<div class="board range-board' + (hint ? '' : ' no-hint') + '">';
    html += '<div class="dial-row">' + hostBlock() +
      '<div class="range-dial"><span class="rd-label">' + esc(t(hint ? 'game.range' : 'game.rangeHidden')) + '</span>' +
      (hint ? '<div class="rd-nums">' + dial(lo, 'lo') + '<span class="rd-sep">～</span>' + dial(hi, 'hi') + '</div>' : '<div class="rd-nums">' + dial(1, 'lo') + '<span class="rd-sep">～</span>' + dial(100, 'hi') + '</div>') +
      (vm.secret != null ? '<span class="rd-secret">' + K.icon('safe') + esc(t('game.yourSecret', { n: vm.secret })) + '</span>' : '') + '</div></div>';
    if (hint) {
      html += '<div class="range-bar" aria-hidden="true"><i style="left:' + (lo - 1) + '%;width:' + Math.max(1, hi - lo + 1) + '%"></i><span class="rb-l">1</span><span class="rb-m">50</span><span class="rb-r">100</span></div>';
    }
    var mode = root.Store.get('inputMode') === 'pad' ? 'pad' : 'grid';
    html += '<div class="pick m-' + mode + '">';
    if (mode === 'grid') {
      html += '<div class="grid10" role="grid" aria-label="' + esc(t('game.gridAria')) + '">';
      for (var r = 0; r < 10; r++) {
        html += '<div class="g-row" role="row">';
        for (var c = 1; c <= 10; c++) {
          var v = r * 10 + c;
          var out = hint && (v < lo || v > hi);
          var guessed = guessedSet[v];
          var cls = 'cell' + (out ? ' out' : '') + (v === sel ? ' sel' : '') + (guessed ? ' g-' + guessed : '');
          html += '<button type="button" role="gridcell" class="' + cls + '" data-v="' + v + '"' + (out || !vm.canAct ? ' disabled' : '') + ' aria-label="' + v + (out ? '，' + esc(t('game.excluded')) : '') + '" aria-selected="' + (v === sel) + '">' + v + '</button>';
        }
        html += '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="pad" role="group" aria-label="' + esc(t('game.padAria')) + '">' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (d) { return '<button type="button" class="key" data-k="' + d + '"' + (vm.canAct ? '' : ' disabled') + '>' + root.Art.svg('digits', d) + '</button>'; }).join('') +
        '<button type="button" class="key fn" data-k="clr"' + (vm.canAct ? '' : ' disabled') + ' aria-label="' + esc(t('game.clear')) + '">' + K.icon('trash') + '</button>' +
        '<button type="button" class="key" data-k="0"' + (vm.canAct ? '' : ' disabled') + '>' + root.Art.svg('digits', 0) + '</button>' +
        '<button type="button" class="key fn" data-k="bs"' + (vm.canAct ? '' : ' disabled') + ' aria-label="' + esc(t('game.backspace')) + '">' + K.icon('backspace') + '</button></div>';
    }
    html += '</div>';
    var selOk = sel != null && (!hint || (sel >= lo && sel <= hi));
    html += '<div class="act-row">' +
      '<div class="sel-box" aria-live="polite"><span>' + esc(t('game.pick')) + '</span>' + (sel != null ? dial(sel, 'sel') : '<b class="sel-empty">—</b>') + '</div>' +
      '<div class="in-toggle seg" role="radiogroup" aria-label="' + esc(t('set.inputMode')) + '">' +
      '<button type="button" role="radio" class="seg-btn" data-im="grid" aria-checked="' + (mode === 'grid') + '" title="' + esc(t('im.grid')) + '" aria-label="' + esc(t('im.grid')) + '">' + K.icon('grid') + '</button>' +
      '<button type="button" role="radio" class="seg-btn" data-im="pad" aria-checked="' + (mode === 'pad') + '" title="' + esc(t('im.pad')) + '" aria-label="' + esc(t('im.pad')) + '">' + K.icon('keypad') + '</button></div>' +
      '<button type="button" class="btn primary submit" id="k-submit"' + (vm.canAct && selOk ? '' : ' disabled') + '>' + K.icon(vm.setMode ? 'lock' : 'enter') + '<span>' + esc(vm.submitLabel || t('game.submit')) + '</span></button></div>';
    html += itemsBlock();
    return html + '</div>';
  }
  function countBoard() {
    var total = vm.total;
    var step = vm.kind === 'step';
    var html = '<div class="board count-board' + (step ? ' step' : '') + '">';
    html += '<div class="dial-row">' + hostBlock() +
      '<div class="range-dial"><span class="rd-label">' + esc(t('game.now')) + '</span><div class="rd-nums">' + dial(total, 'tot') + '</div>' +
      '<span class="rd-goal">' + K.icon(step ? 'target' : 'mine') + esc(t(step ? 'game.goalStep' : 'game.goalCount')) + '</span></div></div>';
    /* 0～100 進度：踩點顯示地雷與走過的格子 */
    var mines = {}, path = {};
    (vm.mines || []).forEach(function (m) { mines[m] = true; });
    (vm.path || []).forEach(function (p) { path[p] = true; });
    html += '<div class="track' + (step ? ' grid10 mini' : '') + '" aria-label="' + esc(t('game.trackAria', { n: total })) + '" role="img">';
    if (step) {
      for (var r = 0; r < 10; r++) {
        html += '<div class="g-row">';
        for (var c = 1; c <= 10; c++) {
          var v = r * 10 + c;
          var reach = vm.canAct && v > total && v <= total + 3;
          var cls = 'cell' + (mines[v] ? ' mine' : '') + (path[v] ? ' path' : '') + (v === total ? ' here' : '') + (reach ? ' reach' : '') + (v === 100 ? ' goal' : '');
          html += '<span class="' + cls + '">' + (mines[v] ? K.icon('mine') : v) + '</span>';
        }
        html += '</div>';
      }
    } else {
      html += '<span class="track-bar"><i style="width:' + total + '%"></i></span><span class="rb-l">0</span><span class="rb-r">100</span>';
    }
    html += '</div>';
    html += '<div class="steps" role="group" aria-label="' + esc(t('game.stepsAria')) + '">' + [1, 2, 3].map(function (n) {
      var to = total + n;
      var ok = vm.canAct && (step || to <= 100);
      var danger = step ? (mines[to] || to > 100) : to >= 100;
      return '<button type="button" class="step-big' + (danger ? ' danger' : '') + '" data-add="' + n + '"' + (ok ? '' : ' disabled') + ' aria-label="' + esc(t('game.addAria', { n: n, to: to })) + '">' +
        '<b>+' + n + '</b><small>' + esc(t('game.toN', { n: to })) + '</small></button>';
    }).join('') + '</div>';
    html += itemsBlock();
    return html + '</div>';
  }

  var guessedSet = {};
  function renderBoard() {
    guessedSet = {};
    (vm.history || []).forEach(function (h) { if (h.kind === 'guess' && h.result !== 'hit') guessedSet[h.value] = h.result; });
    if (vm.mode === 'range' && sel != null && vm.showRange !== false && (sel < vm.lo || sel > vm.hi)) { sel = null; typed = ''; }
    var b = $('g-board');
    var focusKey = doc.activeElement && b.contains(doc.activeElement) ? keyOf(doc.activeElement) : null;
    b.innerHTML = vm.mode === 'range' ? rangeBoard() : countBoard();
    if (focusKey) { var el = b.querySelector(focusKey); if (el && !el.disabled) el.focus({ preventScroll: true }); }
  }
  function keyOf(el) {
    if (el.hasAttribute('data-v')) return '[data-v="' + el.getAttribute('data-v') + '"]';
    if (el.hasAttribute('data-k')) return '[data-k="' + el.getAttribute('data-k') + '"]';
    if (el.hasAttribute('data-add')) return '[data-add="' + el.getAttribute('data-add') + '"]';
    if (el.hasAttribute('data-item')) return '[data-item="' + el.getAttribute('data-item') + '"]';
    if (el.hasAttribute('data-im')) return '[data-im="' + el.getAttribute('data-im') + '"]';
    if (el.id) return '#' + el.id;
    return null;
  }

  /* ---------- 歷史 ---------- */
  function histLine(h) {
    var who = '<b>' + esc(h.who || t('game.you')) + '</b>';
    if (h.kind === 'guess') {
      var res = h.result === 'hit' ? '<em class="r-hit">' + K.icon('mine') + esc(t('res.hit')) + '</em>' :
        '<em class="r-' + h.result + '">' + K.icon(h.result === 'low' ? 'up' : 'down') + esc(t(h.result === 'low' ? 'res.low' : 'res.high')) + '</em>';
      return who + '<span>' + esc(t('hist.guess', { n: h.value })) + (h.auto ? '<small>' + esc(t('hist.auto')) + '</small>' : '') + '</span>' + res;
    }
    if (h.kind === 'add') {
      var r2 = h.result === 'hit' ? '<em class="r-hit">' + K.icon('mine') + esc(t('res.hit')) + '</em>' : h.result === 'mine' ? '<em class="r-hit">' + K.icon('mine') + esc(t('res.mine')) + '</em>' :
        h.result === 'over' ? '<em class="r-hit">' + esc(t('res.over')) + '</em>' : h.result === 'goal' ? '<em class="r-goal">' + K.icon('target') + esc(t('res.goal')) + '</em>' : '<em class="r-ok">' + h.to + '</em>';
      return who + '<span>+' + h.value + (h.auto ? '<small>' + esc(t('hist.auto')) + '</small>' : '') + '</span>' + r2;
    }
    if (h.kind === 'item') {
      return who + '<span class="h-item">' + K.icon(h.item) + esc(t('item.' + h.item)) + (h.targetName ? ' → ' + esc(h.targetName) : '') + '</span>';
    }
    if (h.kind === 'note') return '<span class="h-note">' + esc(h.text) + '</span>';
    return '';
  }
  function renderHistory() {
    var list = vm.history || [];
    var box = $('history');
    if (!list.length) box.innerHTML = '<li class="empty">' + esc(t('hist.empty')) + '</li>';
    else box.innerHTML = list.slice().reverse().map(function (h, i) {
      return '<li class="h-row' + (i === 0 ? ' new' : '') + (h.mine ? ' me' : '') + '"><i class="h-no">' + (list.length - i) + '</i>' + histLine(h) + '</li>';
    }).join('');
    var badge = $('gt-hist-badge');
    if (tab === 'hist') histSeen = list.length;
    var unseen = list.length - histSeen;
    badge.hidden = unseen <= 0; badge.textContent = unseen > 9 ? '9+' : String(unseen);
  }

  /* ---------- 輸入 ---------- */
  function pick(v) {
    if (!vm || !vm.canAct) return;
    sel = v; typed = String(v);
    root.Sound.play('key');
    renderBoard();
  }
  function submit() {
    if (!vm || !vm.canAct || sel == null) return;
    if (vm.showRange !== false && (sel < vm.lo || sel > vm.hi)) { root.Sound.play('error'); return; }
    var v = sel;
    root.Sound.play('submit');
    if (H.guess) H.guess(v);
  }
  function typeDigit(d) {
    if (!vm || !vm.canAct || vm.mode !== 'range') return;
    var next = (typed + d).replace(/^0+/, '');
    if (next.length > 3 || Number(next) > 100) next = String(d) === '0' ? '' : String(d);
    typed = next;
    sel = typed ? Number(typed) : null;
    root.Sound.play('key');
    renderBoard();
  }
  function backspace() { typed = typed.slice(0, -1); sel = typed ? Number(typed) : null; root.Sound.play('back'); renderBoard(); }
  function clearSel() { typed = ''; sel = null; root.Sound.play('back'); renderBoard(); }
  function addN(n) { if (!vm || !vm.canAct) return; root.Sound.play('submit'); if (H.add) H.add(n); }
  function useItem(btn) {
    var k = btn.getAttribute('data-item');
    if (!vm || !vm.canAct || btn.disabled) return;
    if (k === 'assign') {
      K.menu(btn, { label: t('item.assignPick'), value: null, minW: 220, items: (vm.targets || []).map(function (p) {
        return { value: p.seat, label: p.name, icon: '<span class="menu-av">' + avatar(p.avatar) + '</span>' + teamMark(p.team) };
      }), onPick: function (seat) { root.Sound.play('item'); if (H.item) H.item('assign', seat); } });
      return;
    }
    root.Sound.play('item');
    if (H.item) H.item(k);
  }

  function onClick(e) {
    var b = e.target.closest('button');
    if (!b || b.disabled || !$('g-board').contains(b)) return;
    if (b.hasAttribute('data-v')) pick(Number(b.getAttribute('data-v')));
    else if (b.id === 'k-submit') submit();
    else if (b.hasAttribute('data-k')) { var k = b.getAttribute('data-k'); if (k === 'bs') backspace(); else if (k === 'clr') clearSel(); else typeDigit(k); }
    else if (b.hasAttribute('data-add')) addN(Number(b.getAttribute('data-add')));
    else if (b.hasAttribute('data-item')) useItem(b);
    else if (b.hasAttribute('data-im')) { root.Store.set('inputMode', b.getAttribute('data-im')); root.Sound.play('key'); renderBoard(); var f = $('g-board').querySelector('[data-im="' + b.getAttribute('data-im') + '"]'); if (f) f.focus({ preventScroll: true }); }
  }
  function onKey(e) {
    if (!vm || root.App.screen !== 'game' || root.Kit.Modal.top() || doc.querySelector('.menu-pop') || root.Result.visible()) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (vm.mode === 'range') {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); typeDigit(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
      else if (e.key === 'Enter' && sel != null && !(e.target && e.target.closest && e.target.closest('button:not(#k-submit)'))) { e.preventDefault(); submit(); }
    } else if (/^[1-3]$/.test(e.key)) {
      var b = $('g-board').querySelector('[data-add="' + e.key + '"]');
      if (b && !b.disabled) { e.preventDefault(); addN(Number(e.key)); }
    }
  }

  /* ---------- 分頁（窄版：遊戲／紀錄） ---------- */
  function showTab(name) {
    tab = name === 'hist' ? 'hist' : 'play';
    $('scr-game').setAttribute('data-tab', tab);
    $('g-tabs').querySelectorAll('[data-gt]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-gt') === tab)); });
    if (tab === 'hist' && vm) { histSeen = (vm.history || []).length; renderHistory(); }
    K.refreshScroll();
  }

  /* ---------- 開局倒數（依 goAt 本機時間；各端看同一個時間點） ---------- */
  function countdown(goAt, onDone) {
    hideCountdown();
    var el = $('countdown'), num = el.querySelector('.cd-num');
    el.hidden = false; el.classList.remove('go');
    var last = null;
    function step() {
      var left = goAt - Date.now();
      if (left <= 0) {
        num.textContent = t('cd.go'); el.classList.add('go');
        num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop');
        root.Sound.play('go');
        clearInterval(cdTimer); cdTimer = null;
        setTimeout(function () { if (!cdTimer) el.hidden = true; }, 650);
        if (onDone) onDone();
        return;
      }
      var n = Math.ceil(left / 1000);
      if (n !== last) {
        last = n; num.textContent = String(n);
        num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop');
        root.Sound.play('count');
      }
    }
    step();
    if (goAt - Date.now() > 0) cdTimer = setInterval(step, 50);
  }
  function hideCountdown() { clearInterval(cdTimer); cdTimer = null; var el = $('countdown'); if (el) { el.hidden = true; el.classList.remove('go'); } }
  function counting() { return !!cdTimer; }

  /* ---------- 對外 ---------- */
  function render(next, handlers) {
    var fresh = !vm || (handlers && handlers !== H);
    if (handlers) H = handlers;
    if (fresh) { sel = null; typed = ''; histSeen = 0; }
    vm = next;
    renderPlayers();
    renderTurn();
    renderBoard();
    renderHistory();
    $('summary').innerHTML = vm.summaryHtml || '';
    fit();
    K.refreshScroll();
  }
  /**
   * 數字格（正方形）依剩下的空間算邊長（--gs），讓送出鈕、道具與 +1/+2/+3 不用捲動就看得到。
   * 橫向：數字格放右欄，邊長＝min(剩餘高度, 中央寬度 − 左欄)；直向：邊長＝min(寬度, 扣掉其他列後的高度)，最小 240。
   */
  function fit() {
    var c = $('g-center'), b = $('g-board');
    if (!c || !b || c.offsetParent === null) return;
    var land = root.innerWidth >= root.innerHeight && root.innerWidth >= 700;
    var used = 0;
    ['g-players', 'g-turn'].forEach(function (id) { var el = $(id); if (el && !el.hidden) used += el.offsetHeight + parseFloat(getComputedStyle(c).rowGap || 10); });
    var cs = getComputedStyle(c);
    var h = c.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - used - 4;
    var gs;
    if (land) gs = Math.min(h, b.clientWidth - 316, 640);
    else {
      var board = b.querySelector('.board'), grid = b.querySelector('.pick .grid10, .grid10.mini');
      if (!board || !grid) { b.style.removeProperty('--gs'); return; }
      var bs = getComputedStyle(board), gap = parseFloat(bs.rowGap) || 8, rest = 0, n = 0;
      Array.prototype.forEach.call(board.children, function (ch) {
        if (ch.contains(grid)) return;
        var m = getComputedStyle(ch);
        rest += ch.offsetHeight + parseFloat(m.marginTop) + parseFloat(m.marginBottom); n++;
      });
      gs = Math.min(b.clientWidth, h - rest - gap * n - 2, 560);
    }
    b.style.setProperty('--gs', Math.floor(Math.max(240, gs)) + 'px');
  }
  /** 新的一局：清掉選取與紀錄未讀、回到遊戲分頁 */
  function reset() { sel = null; typed = ''; histSeen = 0; vm = null; showTab('play'); clearInterval(timer); timer = null; }
  function stop() { clearInterval(timer); timer = null; hideCountdown(); vm = null; H = {}; }

  function init() {
    K = root.Kit;
    $('g-board').addEventListener('click', onClick);
    doc.addEventListener('keydown', onKey);
    $('g-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-gt]'); if (b) showTab(b.getAttribute('data-gt')); });
    showTab('play');
    var rz = null;
    root.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (vm) { fit(); K.refreshScroll(); } }, 60); });
    root.I18N.onChange(function () { if (vm && root.App.screen === 'game') render(vm); });
  }

  root.GameView = {
    init: init, render: render, reset: reset, stop: stop, showTab: showTab, countdown: countdown, hideCountdown: hideCountdown, counting: counting,
    dial: dial, avatar: avatar, hostSvg: hostSvg, teamMark: teamMark, histLine: histLine,
    get vm() { return vm; }, _pick: pick, _submit: submit, _add: addN
  };
})(typeof self !== 'undefined' ? self : this);
