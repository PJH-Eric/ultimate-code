/* ===== app.js — 畫面切換、首頁、單人選單、紀錄與成就、怎麼玩、設定、語言 =====
 * 首頁與單人一律不連線；只有進入「線上對戰」或點邀請連結才連到伺服器。
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var K, Store = root.Store;
  var screen = 'boot';

  function $(id) { return doc.getElementById(id); }
  function t(k, p) { return root.I18N.t(k, p); }
  function esc(s) { return K.esc(s); }

  /* ---------- 圖示填充：data-icon ---------- */
  function fillIcons(scope) {
    (scope || doc).querySelectorAll('[data-icon]').forEach(function (el) {
      if (el.getAttribute('data-filled') === el.getAttribute('data-icon') + root.I18N.lang) return;
      el.innerHTML = K.icon(el.getAttribute('data-icon'));
      el.setAttribute('data-filled', el.getAttribute('data-icon') + root.I18N.lang);
    });
  }

  /* ---------- 畫面切換 ---------- */
  var SCREENS = ['home', 'solo', 'records', 'help', 'lobby', 'room', 'game'];
  function show(name, opt) {
    opt = opt || {};
    if (SCREENS.indexOf(name) < 0) name = 'home';
    var prev = screen;
    screen = name;
    $('app').setAttribute('data-screen', name);
    SCREENS.forEach(function (s) { var el = $('scr-' + s); if (el) el.hidden = s !== name; });
    if (name !== 'game') { root.Result.hide(); closeSide(); root.GameView.hideCountdown(); }
    if (name === 'game' && !(root.OnlineUI && root.OnlineUI.inRoom())) {
      /* 單人：側欄放回遊戲畫面、不顯示聊天室 */
      var side = $('side');
      if (side.parentElement !== $('scr-game')) $('scr-game').insertBefore(side, $('g-center'));
      $('chatbox').hidden = true;
    }
    var renderer = RENDER[name];
    if (renderer) renderer();
    updateTop();
    if (root.GameAnalytics) root.GameAnalytics.pageView(name);
    if (root.ServerOutage) root.ServerOutage.setScreen(name === 'lobby' || name === 'room' ? name : (name === 'game' && root.OnlineUI && root.OnlineUI.inRoom() ? 'room' : name));
    if (!opt.fromPop && name !== prev && name !== 'game' && prev !== 'boot') {
      try { root.history.pushState({ s: name }, ''); } catch (e) { /* 忽略 */ }
    } else if (!opt.fromPop && name === 'game' && prev !== 'game') {
      try { root.history.pushState({ s: 'game' }, ''); } catch (e) { /* 忽略 */ }
    }
    var main = $('scr-' + name);
    if (main && main.scrollTop && name !== prev) main.scrollTop = 0;
    fillIcons();
    K.refreshScroll();
    if (opt.focus !== false && name !== prev) {
      var h = main && main.querySelector('h1, h2');
      if (h && name !== 'game') { h.tabIndex = -1; try { h.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ } }
    }
    /* 進入遊戲畫面：焦點移到盤面，直接打數字＋Enter 就能猜（不會停在返回鈕上被 Enter 觸發） */
    if (name === 'game' && opt.focus !== false) {
      var gb = $('g-board'); gb.tabIndex = -1; try { gb.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ }
    }
  }
  function setTitle(text) { $('top-title').textContent = text || ''; }
  function updateTop() {
    var inGame = screen === 'game';
    $('btn-lobby').hidden = screen !== 'home' || !root.LobbyLink || !root.LobbyLink.url;
    if (!$('btn-lobby').hidden) $('btn-lobby').href = root.LobbyLink.url;
    $('btn-back').hidden = screen === 'home' || screen === 'boot';
    $('btn-side').hidden = !(inGame || screen === 'room');
    if (screen === 'home') setTitle('');
    else if (!inGame && screen !== 'room') setTitle(t('title.' + screen));
  }

  /* ---------- 側欄（窄版是抽屜） ---------- */
  function openSide() { $('app').setAttribute('data-side', 'open'); $('side-backdrop').hidden = false; $('btn-side').setAttribute('aria-expanded', 'true'); var b = $('side-close'); if (b) b.focus({ preventScroll: true }); if (root.OnlineUI) root.OnlineUI.sideOpened(); K.refreshScroll(); }
  function closeSide() { $('app').setAttribute('data-side', 'closed'); $('side-backdrop').hidden = true; $('btn-side').setAttribute('aria-expanded', 'false'); K.refreshScroll(); }

  /* ---------- 返回 ---------- */
  function goBack() {
    if (K.Modal.top()) { K.Modal.top().close(); return; }
    switch (screen) {
      case 'solo': case 'records': case 'help': show('home'); break;
      case 'lobby': root.OnlineUI.exitLobby(); break;
      case 'room': root.OnlineUI.confirmLeave(); break;
      case 'game':
        if (root.OnlineUI && root.OnlineUI.inRoom()) { root.OnlineUI.confirmLeave(); break; }
        if (root.Solo.inProgress()) {
          K.Modal({ title: t('leave.title'), body: '<p>' + esc(t('leave.body')) + '</p>', actions: [
            { label: t('common.stay'), kind: 'ghost' },
            { label: t('leave.ok'), kind: 'danger', onClick: function () { root.Solo.stop(); show('solo'); } }] });
        } else { root.Solo.stop(); show('solo'); }
        break;
      default: show('home');
    }
  }

  /* ---------- 首頁 ---------- */
  function renderHome() {
    $('scr-home').innerHTML =
      '<div class="home">' +
      '<div class="hero"><div class="hero-art">' + root.GameView.hostSvg('idle', 'hero-host') +
      '<div class="hero-dials" aria-hidden="true">' + root.GameView.dial(1) + '<span class="hd-sep">～</span>' + root.GameView.dial(100) + '</div></div>' +
      '<h1 id="home-title" class="logo"><span class="logo-main">' + esc(t('home.title')) + '</span><span class="logo-tag">1～100</span></h1>' +
      '<p class="tagline">' + esc(t('home.tagline')) + '</p></div>' +
      '<div class="home-main">' +
      '<button type="button" class="big-btn b-solo" id="h-solo">' + K.icon('user') + '<span><b>' + esc(t('home.solo')) + '</b><small>' + esc(t('home.soloSub')) + '</small></span></button>' +
      '<button type="button" class="big-btn b-online" id="h-online">' + K.icon('users') + '<span><b>' + esc(t('home.online')) + '</b><small>' + esc(t('home.onlineSub')) + '</small></span></button>' +
      '<button type="button" class="big-btn b-help" id="h-help">' + K.icon('book') + '<span><b>' + esc(t('home.help')) + '</b><small>' + esc(t('home.helpSub')) + '</small></span></button>' +
      '</div>' +
      '<button type="button" class="small-card" id="h-records">' + K.icon('medal') + '<span><b>' + esc(t('home.records')) + '</b><small>' + esc(t('home.recordsSub', { a: Object.keys(Store.get('ach')).length, b: Store.ACH.length })) + '</small></span>' + K.icon('back', 'chev') + '</button>' +
      '</div>';
    $('h-solo').onclick = function () { show('solo'); };
    $('h-online').onclick = function () { root.OnlineUI.enterLobby(); };
    $('h-help').onclick = function () { show('help'); };
    $('h-records').onclick = function () { show('records'); };
  }

  /* ---------- 單人選單 ---------- */
  function starsHtml(n) { var h = '<span class="mini-stars" aria-label="' + esc(t('res.starsAria', { n: n })) + '">'; for (var i = 0; i < 3; i++) h += '<i class="' + (i < n ? 'on' : '') + '">' + K.icon(i < n ? 'star' : 'star-empty') + '</i>'; return h + '</span>'; }
  function renderSolo() {
    var s = Store.get('stats');
    function best(kind) { var b = s[kind].best; return b ? starsHtml(R().soloStars(kind, b)) + esc(t('solo.bestScore', { n: b })) : esc(t('solo.noRecord')); }
    $('scr-solo').innerHTML = '<div class="page"><h1 class="page-title">' + esc(t('title.solo')) + '</h1><div class="mode-grid">' +
      '<button type="button" class="mode-card mc-crack" data-m="crack"><span class="mc-ico">' + K.icon('safe') + '</span><span class="mc-text"><b>' + esc(t('mode.crack')) + '</b><small>' + esc(t('mode.crackDesc')) + '</small>' +
      '<span class="mc-best">' + best('crack') + '</span></span></button>' +
      '<button type="button" class="mode-card mc-step" data-m="step"><span class="mc-ico">' + K.icon('mine') + '</span><span class="mc-text"><b>' + esc(t('mode.step')) + '</b><small>' + esc(t('mode.stepDesc')) + '</small>' +
      '<span class="mc-best">' + best('step') + '</span></span></button>' +
      '</div>' +
      '<div class="panel solo-opts"><p class="note">' + K.icon('flag') + '<span>' + esc(t('solo.bankNote')) + '</span></p>' +
      '<p class="note">' + K.icon('question') + '<span>' + esc(t('solo.noItems')) + '</span></p></div></div>';
    $('scr-solo').querySelectorAll('[data-m]').forEach(function (b) { b.addEventListener('click', function () { root.Solo.start({ kind: b.getAttribute('data-m') }); }); });
  }
  function R() { return root.UCRules; }

  /* ---------- 紀錄與成就 ---------- */
  function renderRecords() {
    var s = Store.get('stats'), ach = Store.get('ach'), recs = Store.get('records').slice().reverse();
    var lang = root.I18N.lang === 'en' ? 'en-US' : root.I18N.lang === 'zh-Hans' ? 'zh-CN' : 'zh-TW';
    function when(ms) { try { return new Date(ms).toLocaleString(lang, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
    function avg(k) { return s[k].wins ? (s[k].sum / s[k].wins).toFixed(1) : '—'; }
    var html = '<div class="page records"><h1 class="page-title">' + esc(t('title.records')) + '</h1>' +
      '<section class="panel"><h2 class="box-title">' + K.icon('safe') + esc(t('mode.crack')) + '</h2><div class="stat-grid">' +
      stat(t('rec.games'), s.crack.games) + stat(t('rec.banked'), s.crack.wins) + stat(t('rec.bestScore'), s.crack.best || '—') + stat(t('rec.avgScore'), avg('crack')) + stat(t('rec.stars3'), s.crack.stars3) + '</div></section>' +
      '<section class="panel"><h2 class="box-title">' + K.icon('mine') + esc(t('mode.step')) + '</h2><div class="stat-grid">' +
      stat(t('rec.games'), s.step.games) + stat(t('rec.banked'), s.step.wins) + stat(t('rec.bestScore'), s.step.best || '—') + stat(t('rec.avgScore'), avg('step')) + stat(t('rec.stars3'), s.step.stars3) + '</div></section>' +
      '<section class="panel"><h2 class="box-title">' + K.icon('users') + esc(t('rec.online')) + '</h2><div class="stat-grid">' +
      stat(t('rec.games'), s.online.games) + stat(t('rec.wins'), s.online.wins) + stat(t('rec.hits'), s.online.hits) + '</div></section>' +
      '<section class="panel"><h2 class="box-title">' + K.icon('medal') + esc(t('rec.ach')) + '<small>' + esc(t('rec.achN', { a: Object.keys(ach).length, b: Store.ACH.length })) + '</small></h2><ul class="ach-list">' +
      Store.ACH.map(function (a) {
        var on = !!ach[a.id];
        var prog = a.goal && !on ? '<span class="ach-prog"><i style="width:' + Math.min(100, a.prog(s) * 100 / a.goal) + '%"></i></span><small>' + Math.min(a.goal, a.prog(s)) + ' / ' + a.goal + '</small>' : '';
        return '<li class="ach' + (on ? ' on' : '') + '"><span class="ach-ico">' + K.icon(on ? a.icon : 'lock') + '</span><span class="ach-text"><b>' + esc(t('ach.' + a.id)) + '</b><small>' + esc(t('ach.' + a.id + 'D')) + '</small>' + prog +
          (on ? '<small class="ach-at">' + esc(t('rec.unlockedAt', { d: when(ach[a.id]) })) + '</small>' : '') + '</span></li>';
      }).join('') + '</ul></section>' +
      '<section class="panel"><h2 class="box-title">' + K.icon('history') + esc(t('rec.recent')) + '<small>' + esc(t('rec.keep', { n: Store.KEEP })) + '</small></h2>' +
      (recs.length ? '<ol class="rec-list">' + recs.slice(0, 30).map(function (r) {
        var res = r.result === 'win' ? t('rec.rWin') : r.result === 'draw' ? t('rec.rDraw') : r.result === 'left' ? t('rec.rLeft') : t('rec.rLose');
        var metric = r.kind === 'online' ? t('rec.mHits', { n: r.metric }) : r.result === 'win' ? t('rec.mScore', { n: r.metric }) : t('rec.mBoom');
        return '<li class="rec r-' + r.result + '"><span class="rec-kind">' + K.icon(r.kind === 'crack' ? 'safe' : r.kind === 'step' ? 'mine' : 'users') + esc(t('rec.k.' + r.kind)) + '</span>' +
          '<b>' + esc(res) + '</b><span>' + esc(metric) + (r.stars ? ' ' : '') + '</span>' + (r.stars ? starsHtml(r.stars) : '<span></span>') + '<small>' + esc(when(r.at)) + '</small></li>';
      }).join('') + '</ol>' : '<p class="empty">' + esc(t('rec.empty')) + '</p>') + '</section>' +
      '<p class="note">' + K.icon('question') + '<span>' + esc(t('rec.local')) + '</span></p>' +
      '<div class="page-actions"><button type="button" class="btn danger ghost" id="rec-clear">' + K.icon('trash') + '<span>' + esc(t('rec.clear')) + '</span></button></div></div>';
    $('scr-records').innerHTML = html;
    $('rec-clear').onclick = confirmClear;
  }
  function stat(label, v) { return '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>'; }
  function confirmClear() {
    K.Modal({ title: t('rec.clearT'), body: '<p>' + esc(t('rec.clearBody')) + '</p>', actions: [
      { label: t('common.cancel'), kind: 'ghost' },
      { label: t('rec.clearOk'), kind: 'danger', icon: 'trash', onClick: function () { Store.clearRecords(); K.toast(t('rec.cleared'), 'ok'); if (screen === 'records') renderRecords(); } }] });
  }

  /* ---------- 怎麼玩 ---------- */
  function renderHelp() {
    var G = root.GameView;
    var html = '<div class="page help"><h1 class="page-title">' + esc(t('title.help')) + '</h1>' +
      sec('safe', 'help.rangeT', '<p>' + esc(t('help.range')) + '</p><div class="ex"><div class="ex-row"><span class="ex-l">' + esc(t('help.exStart')) + '</span>' + G.dial(1) + '<span class="rd-sep">～</span>' + G.dial(100) + '</div>' +
        '<div class="ex-row"><span class="ex-l">' + esc(t('help.exGuess', { n: 30 })) + '</span><em class="r-low">' + K.icon('up') + esc(t('res.low')) + '</em>' + G.dial(31) + '<span class="rd-sep">～</span>' + G.dial(100) + '</div>' +
        '<div class="ex-row"><span class="ex-l">' + esc(t('help.exGuess', { n: 60 })) + '</span><em class="r-high">' + K.icon('down') + esc(t('res.high')) + '</em>' + G.dial(31) + '<span class="rd-sep">～</span>' + G.dial(59) + '</div></div>' +
        '<p class="small">' + esc(t('help.rangeLose')) + '</p>') +
      sec('plus', 'help.countT', '<p>' + esc(t('help.count')) + '</p><p class="small">' + esc(t('help.countTip')) + '</p>') +
      sec('skip', 'help.itemsT', '<ul class="tips item-tips">' + ['skip', 'reverse', 'assign'].map(function (k) { return '<li>' + K.icon(k) + '<span><b>' + esc(t('item.' + k)) + '</b>' + esc(t('item.' + k + 'Help')) + '</span></li>'; }).join('') + '</ul><p class="small">' + esc(t('help.itemsNote')) + '</p>') +
      sec('users', 'help.onlineT', '<ul class="tips"><li>' + esc(t('help.o1')) + '</li><li>' + esc(t('help.o2')) + '</li><li>' + esc(t('help.o3')) + '</li><li>' + esc(t('help.o4')) + '</li><li>' + esc(t('help.o5')) + '</li></ul>') +
      sec('user', 'help.soloT', '<ul class="tips"><li>' + esc(t('help.s1')) + '</li><li>' + esc(t('help.s2')) + '</li></ul>') +
      sec('keypad', 'help.inputT', '<ul class="tips"><li>' + esc(t('help.in1')) + '</li><li>' + esc(t('help.in2')) + '</li><li>' + esc(t('help.in3')) + '</li></ul>') +
      '<div class="page-actions"><button type="button" class="btn primary big" id="help-go">' + K.icon('play') + '<span>' + esc(t('help.go')) + '</span></button></div></div>';
    $('scr-help').innerHTML = html;
    $('help-go').onclick = function () { show('solo'); };
  }
  function sec(ico, title, body) { return '<section class="panel help-sec"><h2 class="box-title">' + K.icon(ico) + esc(t(title)) + '</h2>' + body + '</section>'; }

  /* ---------- 設定 ---------- */
  function openSettings() {
    var s = function (k) { return Store.get(k); };
    var body = doc.createElement('div');
    body.className = 'settings';
    body.innerHTML =
      '<div class="set-group"><h3>' + esc(t('set.sound')) + '</h3>' +
      setRow('set-music', t('set.music'), K.switchHtml('set-music', s('musicOn'), t('set.music'))) +
      setRow('set-musicVol', t('set.musicVol'), K.stepperHtml('set-musicVol', Math.round(s('musicVol') * 10), t('set.musicVol'))) +
      setRow('set-sfx', t('set.sfx'), K.switchHtml('set-sfx', s('sfxOn'), t('set.sfx'))) +
      setRow('set-sfxVol', t('set.sfxVol'), K.stepperHtml('set-sfxVol', Math.round(s('sfxVol') * 10), t('set.sfxVol'))) +
      setRow('set-vib', t('set.vibrate'), K.switchHtml('set-vib', s('vibrate'), t('set.vibrate'))) + '</div>' +
      '<div class="set-group"><h3>' + esc(t('set.play')) + '</h3>' +
      '<div class="set-row col"><span>' + esc(t('set.inputMode')) + '</span>' + K.segHtml('set-im', [{ value: 'grid', label: t('im.grid'), icon: K.icon('grid') }, { value: 'pad', label: t('im.pad'), icon: K.icon('keypad') }], s('inputMode'), t('set.inputMode')) + '</div></div>' +
      '<div class="set-group"><h3>' + esc(t('set.view')) + '</h3>' +
      setRow('set-rm', t('set.reduce'), K.switchHtml('set-rm', s('reduceMotion'), t('set.reduce'))) +
      setRow('set-ca', t('set.assist'), K.switchHtml('set-ca', s('colorAssist'), t('set.assist')), t('set.assistHelp')) +
      (root.LobbyChatUI ? setRow('set-lobbychat', root.LobbyChatUI.text('set'), K.switchHtml('set-lobbychat', root.LobbyChatUI.isEnabled(), root.LobbyChatUI.text('set')), root.LobbyChatUI.text('setSub')) : '') +
      '<div class="set-row col"><span>' + esc(t('set.lang')) + '</span>' + K.segHtml('set-lang', [{ value: 'zh-Hant', label: '繁體中文' }, { value: 'zh-Hans', label: '简体中文' }, { value: 'en', label: 'English' }], root.I18N.lang, t('set.lang')) + '</div></div>' +
      '<div class="set-group"><h3>' + esc(t('set.data')) + '</h3><div class="set-row"><span class="set-label">' + esc(t('rec.clear')) + '<small>' + esc(t('rec.clearHelp')) + '</small></span><button type="button" class="btn small danger" id="set-clear">' + K.icon('trash') + '<span>' + esc(t('rec.clearShort')) + '</span></button></div></div>';
    var m = K.Modal({ title: t('set.title'), body: body, cls: 'settings-modal', actions: [
      { label: t('set.reset'), kind: 'ghost', icon: 'refresh', close: false, onClick: function (api) { Store.resetSettings(); if (root.LobbyChatUI) root.LobbyChatUI.setEnabled(true); api.close(); applySettings(); openSettings(); } },
      { label: t('common.done'), kind: 'primary', icon: 'check' }] });
    K.bindSwitch($('set-music'), function (v) { Store.set('musicOn', v); root.Sound.refresh(); });
    K.bindStepper($('set-musicVol'), function () { return Math.round(Store.get('musicVol') * 10); }, function (v) { Store.set('musicVol', v / 10); root.Sound.refresh(); }, function () { return 0; }, function () { return 10; });
    K.bindSwitch($('set-sfx'), function (v) { Store.set('sfxOn', v); root.Sound.refresh(); root.Sound.play('key'); });
    K.bindStepper($('set-sfxVol'), function () { return Math.round(Store.get('sfxVol') * 10); }, function (v) { Store.set('sfxVol', v / 10); root.Sound.refresh(); }, function () { return 0; }, function () { return 10; });
    K.bindSwitch($('set-vib'), function (v) { Store.set('vibrate', v); root.Sound.vibrate(20); });
    K.bindSeg($('set-im'), function (v) { Store.set('inputMode', v); refreshGame(); });
    K.bindSwitch($('set-rm'), function (v) { Store.set('reduceMotion', v); applySettings(); });
    K.bindSwitch($('set-ca'), function (v) { Store.set('colorAssist', v); applySettings(); });
    if (root.LobbyChatUI) K.bindSwitch($('set-lobbychat'), function (v) { root.LobbyChatUI.setEnabled(v); });
    K.bindSeg($('set-lang'), function (v) { root.I18N.setLang(v); m.close(); });
    $('set-clear').onclick = function () { m.close(); confirmClear(); };
  }
  function refreshGame() { var vm = root.GameView.vm; if (vm && screen === 'game') root.GameView.render(vm); }
  function setRow(id, label, ctrl, help) {
    return '<div class="set-row"><label class="set-label" for="' + id + '">' + esc(label) + (help ? '<small>' + esc(help) + '</small>' : '') + '</label>' + ctrl + '</div>';
  }
  function applySettings() {
    $('app').classList.toggle('reduce-motion', !!Store.get('reduceMotion') || !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches));
    $('app').classList.toggle('color-assist', !!Store.get('colorAssist'));
    root.Sound.refresh();
  }

  /* ---------- 語言 ---------- */
  function openLangMenu() {
    K.menu($('btn-lang'), { label: t('top.lang'), value: root.I18N.lang, items: [{ value: 'zh-Hant', label: '繁體中文' }, { value: 'zh-Hans', label: '简体中文' }, { value: 'en', label: 'English' }], onPick: function (v) { root.I18N.setLang(v); } });
  }
  function onLang() {
    var r = RENDER[screen];
    if (r && screen !== 'game') r();
    updateTop();
    fillIcons();
  }

  /* ---------- 返回鍵與瀏覽器上一頁 ---------- */
  function onPop(e) {
    var st = e.state && e.state.s;
    if (K.Modal.top()) { K.Modal.top().close(); try { root.history.pushState({ s: screen }, ''); } catch (er) { /* 忽略 */ } return; }
    if (screen === 'home' || st === 'root') {
      if (root.LobbyLink && root.LobbyLink.url) { root.location.href = root.LobbyLink.url; return; }
      try { root.history.pushState({ s: 'home' }, ''); } catch (er) { /* 忽略 */ }
      if (screen !== 'home') show('home', { fromPop: true });
      return;
    }
    try { root.history.pushState({ s: screen }, ''); } catch (er) { /* 忽略 */ }
    goBack();
  }

  var RENDER = { home: renderHome, solo: renderSolo, records: renderRecords, help: renderHelp,
    lobby: function () { root.OnlineUI.renderLobby(); }, room: function () { root.OnlineUI.renderRoom(); } };

  function boot() {
    K = root.Kit;
    root.I18N.init();
    fillIcons();
    root.GameView.init();
    root.Solo.init();
    root.OnlineUI.init();
    applySettings();
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-lang').addEventListener('click', openLangMenu);
    $('btn-back').addEventListener('click', goBack);
    $('btn-side').addEventListener('click', function () { if ($('app').getAttribute('data-side') === 'open') closeSide(); else openSide(); });
    $('side-close').addEventListener('click', closeSide);
    /* 抽屜滑動結束後重算自訂捲軸位置（滑動途中量到的位置是錯的） */
    $('side').addEventListener('transitionend', function () { K.refreshScroll(); });
    $('side-backdrop').addEventListener('click', closeSide);
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || K.Modal.top() || doc.querySelector('.menu-pop') || doc.querySelector('.result-share-dialog-layer:not([hidden])')) return;
      if ($('app').getAttribute('data-side') === 'open') { closeSide(); }
    });
    root.I18N.onChange(onLang);
    root.addEventListener('popstate', onPop);
    /* 共用的分享圖片視窗是動態產生的：加上 .scroll，讓它也用自訂捲軸 */
    new MutationObserver(function () { doc.querySelectorAll('.result-share-dialog:not(.scroll)').forEach(function (d) { d.classList.add('scroll'); K.attachScroll(d); }); }).observe(doc.body, { childList: true });
    try { root.history.replaceState({ s: 'root' }, ''); root.history.pushState({ s: 'home' }, ''); } catch (e) { /* 忽略 */ }
    $('boot').hidden = true;
    /* 邀請連結：?room=XXXX&invite=token → 先到大廳確認暱稱再加入 */
    var q = new URLSearchParams(root.location.search);
    if (q.get('room')) { show('home', { fromPop: true, focus: false }); root.OnlineUI.enterLobby({ room: q.get('room'), token: q.get('invite') || '', as: q.get('as') || '' }); }
    else if (root.OnlineUI.pendingResume && root.OnlineUI.pendingResume()) { show('home', { fromPop: true, focus: false }); root.OnlineUI.resume(); }
    else show('home', { fromPop: true });
  }

  root.App = { show: show, setTitle: setTitle, updateTop: updateTop, openSide: openSide, closeSide: closeSide, fillIcons: fillIcons, openSettings: openSettings, get screen() { return screen; } };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof self !== 'undefined' ? self : this);
