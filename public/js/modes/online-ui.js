/* ===== modes/online-ui.js — 線上：大廳、房間、對局畫面、聊天、回房 =====
 * 伺服器權威：這裡只送意圖（act／secret／settings…），畫面全部由伺服器快照組成。
 * 只有使用者進入線上或打開邀請連結才連線；離開大廳就關閉連線與背景工作。
 *
 * 三級備援回房：同一分頁 sessionStorage 記住房號（並呼叫 GameBackend.rememberRoom 固定後端）。
 * 重新整理或後端重啟後自動以 resumeRoomId 連回原後端，畫面顯示「等待原房間恢復」，可取消；
 * 只有主動離開、或伺服器確認關房／被踢／房間不存在時才清除。
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var R = root.UCRules;
  var K, Net = root.Net;
  var room = null, lobby = { rooms: [], online: 0 }, invite = null;
  var offset = 0;                 // 伺服器時間 − 本機時間
  var avatarSel = 0;
  var lastGoAt = 0, lastResultNo = 0, lastHistLen = 0, lastRoundKey = '', lastCur = null;
  var resume = null;              // { id, since } 等待原房間恢復中
  var unread = 0;
  var chatMsgs = [];
  var ROOM_KEY = 'ultimate-code:room';

  function $(id) { return doc.getElementById(id); }
  function t(k, p) { return root.I18N.t(k, p); }
  function esc(s) { return K.esc(s); }
  function app() { return root.App; }
  function myName() { return root.Store.get('nickname') || ''; }
  function local(ts) { return ts ? ts - offset : 0; }

  /* ---------- 回房資料（同一分頁） ---------- */
  function savedRoom() { try { return sessionStorage.getItem(ROOM_KEY) || ''; } catch (e) { return ''; } }
  function rememberRoom(id) {
    try { sessionStorage.setItem(ROOM_KEY, id); } catch (e) { /* 忽略 */ }
    if (root.GameBackend && root.GameBackend.rememberRoom) root.GameBackend.rememberRoom();
  }
  function forgetRoom() {
    try { sessionStorage.removeItem(ROOM_KEY); } catch (e) { /* 忽略 */ }
    if (root.GameBackend && root.GameBackend.forgetRoom) root.GameBackend.forgetRoom();
    Net.resumeRoom = null; resume = null;
  }

  /* ---------- 大廳聊天室（左下氣泡） ---------- */
  function initLobbyChat() {
    if (!root.LobbyChat || root.LobbyChatUI) return;
    var chat = root.LobbyChatUI = root.LobbyChat.create({
      game: 'ultimate-code', mount: '#app', watch: '#scr-lobby',
      getName: function () { var nm = $('lb-name'); return (nm && nm.value.trim()) || myName(); },
      setName: function (n) { root.Store.set('nickname', n.slice(0, 16)); var nm = $('lb-name'); if (nm) nm.value = n.slice(0, 16); Net.send({ type: 'name', name: n }); },
      join: function (name) { Net.send({ type: 'lobbychat', op: 'join', name: name }); },
      leave: function () { Net.send({ type: 'lobbychat', op: 'leave' }); },
      send: function (text, name) { Net.send({ type: 'lobbychat', op: 'send', text: text, name: name }); },
      joinRoom: function (code) { saveName(); Net.send({ type: 'join', roomId: code, name: myName(), avatar: avatarSel, want: 'player' }); }
    });
    chat.setConnected(Net.status === 'open');
    Net.on('status', function () { chat.setConnected(Net.status === 'open'); });
    Net.on('lobbychat', function (m) {
      if (m.op === 'history') chat.history(m.history, m.online);
      else if (m.op === 'msg') chat.add(m.msg);
      else if (m.op === 'online') chat.online(m.online);
      else if (m.op === 'error') chat.error(m.code);
    });
  }

  /* ---------- 進出大廳 ---------- */
  function enterLobby(inv) {
    if (inv) invite = inv;
    avatarSel = root.Store.get('avatar') || 0;
    initLobbyChat();
    app().show('lobby');
    if (!Net.enabled) return;
    Net.connect(myName());
    if (Net.status === 'open') Net.send({ type: 'lobby' });
  }
  function exitLobby() {
    if (room) { confirmLeave(); return; }
    forgetRoom();
    Net.close();
    app().show('home');
  }
  function pendingResume() { return !!savedRoom(); }
  /** 重新整理後自動回房（只連回原後端） */
  function resumeNow() {
    var id = savedRoom(); if (!id) return;
    resume = { id: id, since: Date.now() };
    Net.resumeRoom = id;
    enterLobby();
  }
  function cancelResume() {
    forgetRoom();
    Net.close();
    renderLobby();
    K.toast(t('online.resumeCancel'));
  }

  /* ---------- 大廳畫面 ---------- */
  function statusHtml() {
    if (!Net.enabled) return '<div class="net-status bad">' + K.icon('cross') + '<span>' + esc(t(root.Config.status === 'invalid' ? 'net.invalid' : 'net.disabled')) + '</span></div>';
    var s = Net.status, n = Net.statusN;
    if (resume && s !== 'open') {
      var secs = Math.round((Date.now() - resume.since) / 1000);
      return '<div class="net-status wake">' + root.GameView.hostSvg('think', 'wake-host') + '<span><b>' + esc(t('net.resumeT', { id: resume.id })) + '</b><br>' + esc(s === 'failed' ? t('net.resumeFail') : t('net.resumeWait', { n: secs })) + '</span>' +
        '<span class="row-btns">' + (s === 'failed' ? '<button type="button" class="btn small primary" id="lb-retry">' + K.icon('refresh') + '<span>' + esc(t('net.retry')) + '</span></button>' : '') +
        '<button type="button" class="btn small ghost" id="lb-cancel-resume">' + K.icon('close') + '<span>' + esc(t('net.resumeCancelBtn')) + '</span></button></span></div>';
    }
    if (s === 'open') return '<div class="net-status ok">' + K.icon('check') + '<span>' + esc(t('net.ok')) + '</span><span class="online-count">' + K.icon('users') + esc(t('net.online', { n: lobby.online })) + '</span></div>';
    if (s === 'waking') return '<div class="net-status wake">' + root.GameView.hostSvg('sleep', 'wake-host') + '<span>' + esc(t('net.waking', { n: n || 0 })) + '</span></div>';
    if (s === 'failed') return '<div class="net-status bad">' + K.icon('cross') + '<span>' + esc(t('net.failed')) + '</span><button type="button" class="btn small primary" id="lb-retry">' + K.icon('refresh') + '<span>' + esc(t('net.retry')) + '</span></button></div>';
    if (s === 'retrying') return '<div class="net-status wake">' + K.icon('refresh') + '<span>' + esc(t('net.retrying', { n: n || 1 })) + '</span></div>';
    return '<div class="net-status wake">' + K.icon('refresh') + '<span>' + esc(t('net.connecting')) + '</span></div>';
  }
  function roomRowHtml(r) {
    var playing = r.status === 'playing' || r.status === 'between';
    var full = r.players >= r.cap;
    return '<li class="room-row"><span class="rr-ico">' + K.icon(r.mode === 'count' ? 'plus' : 'safe') + '</span>' +
      '<span class="rr-main"><b>' + esc(t('lobby.roomOf', { n: r.hostName })) + '</b><small>' + esc(t('lobby.code', { c: r.id })) + '・' + esc(t(r.mode === 'count' ? 'mode.count' : 'mode.range')) + '</small></span>' +
      '<span class="rr-meta"><i>' + K.icon('users') + r.players + '/' + r.cap + '</i>' + (r.spectators ? '<i>' + K.icon('eye') + r.spectators + '</i>' : '') +
      '<i class="st st-' + (playing ? 'playing' : 'waiting') + '">' + esc(t(playing ? 'lobby.playing' : 'lobby.waiting')) + '</i>' +
      (r.teams ? '<i>' + esc(t('room.teamsOn')) + '</i>' : '') + (r.rounds > 1 ? '<i>' + esc(t('room.roundsN', { n: r.rounds })) + '</i>' : '') +
      '<i>' + esc(r.turnSec ? t('room.secN', { n: r.turnSec }) : t('room.noLimit')) + '</i></span>' +
      '<span class="rr-act">' + (!playing && !full ? '<button type="button" class="btn small primary" data-join="' + r.id + '">' + esc(t('lobby.join')) + '</button>' : '') +
      '<button type="button" class="btn small" data-watch="' + r.id + '"' + (r.specFull ? ' disabled' : '') + '>' + K.icon('eye') + '<span>' + esc(t('lobby.watch')) + '</span></button></span></li>';
  }
  function renderLobby() {
    if (app().screen !== 'lobby') return;
    var open = Net.status === 'open';
    var focusId = doc.activeElement && doc.activeElement.id;
    var nameVal = $('lb-name') ? $('lb-name').value : myName();
    var codeVal = $('lb-code') ? $('lb-code').value : '';
    var html = '<div class="page lobby"><h1 class="page-title">' + esc(t('title.lobby')) + '</h1>' + statusHtml() +
      '<section class="panel profile"><h2 class="box-title">' + K.icon('user') + esc(t('lobby.profile')) + '</h2>' +
      '<div class="field"><label class="f-label" for="lb-name">' + esc(t('lobby.name')) + '</label><span class="input-wrap"><input id="lb-name" type="text" maxlength="16" autocomplete="nickname" value="' + esc(nameVal) + '" placeholder="' + esc(t('lobby.namePh')) + '"></span></div>' +
      '<div class="field"><span class="f-label" id="lb-av-l">' + esc(t('lobby.avatar')) + '</span><div class="avatar-pick" role="radiogroup" aria-labelledby="lb-av-l">' +
      [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return '<button type="button" role="radio" class="av-btn" data-av="' + i + '" aria-checked="' + (i === avatarSel) + '" aria-label="' + esc(t('lobby.avatarN', { n: i + 1 })) + '">' + root.GameView.avatar(i) + '</button>'; }).join('') + '</div></div></section>' +
      '<div class="lobby-actions"><button type="button" class="big-btn b-solo small-big" id="lb-quick"' + (open ? '' : ' disabled') + '>' + K.icon('play') + '<span><b>' + esc(t('lobby.quick')) + '</b><small>' + esc(t('lobby.quickSub')) + '</small></span></button>' +
      '<button type="button" class="big-btn b-online small-big" id="lb-create"' + (open ? '' : ' disabled') + '>' + K.icon('plus') + '<span><b>' + esc(t('lobby.create')) + '</b><small>' + esc(t('lobby.createSub')) + '</small></span></button></div>' +
      '<section class="panel"><h2 class="box-title">' + K.icon('link') + esc(t('lobby.byCode')) + '</h2><form class="code-form" id="lb-code-form" autocomplete="off"><span class="input-wrap"><input id="lb-code" type="text" maxlength="6" value="' + esc(codeVal) + '" placeholder="' + esc(t('lobby.codePh')) + '" aria-label="' + esc(t('lobby.codePh')) + '"></span>' +
      '<button type="submit" class="btn primary"' + (open ? '' : ' disabled') + '>' + esc(t('lobby.join')) + '</button></form></section>' +
      '<section class="panel"><h2 class="box-title">' + K.icon('grid') + esc(t('lobby.rooms')) + '<small>' + esc(t('lobby.roomsN', { n: lobby.rooms.length })) + '</small></h2>' +
      (lobby.rooms.length ? '<ul class="room-list">' + lobby.rooms.map(roomRowHtml).join('') + '</ul>' : '<p class="empty">' + esc(t(open ? 'lobby.empty' : 'lobby.notYet')) + '</p>') + '</section></div>';
    $('scr-lobby').innerHTML = html;
    if (focusId && $(focusId)) { try { $(focusId).focus({ preventScroll: true }); } catch (e) { /* 忽略 */ } }
    if (root.LobbyChatUI) root.LobbyChatUI.refresh();
  }
  function saveName() {
    var el = $('lb-name');
    var v = el ? el.value.trim().slice(0, 16) : myName();
    if (v !== myName()) { root.Store.set('nickname', v); Net.send({ type: 'name', name: v }); }
    return v;
  }
  function onLobbyClick(e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.id === 'lb-retry') { Net.connect(myName()); renderLobby(); }
    else if (b.id === 'lb-cancel-resume') cancelResume();
    else if (b.hasAttribute('data-av')) { avatarSel = Number(b.getAttribute('data-av')); root.Store.set('avatar', avatarSel); root.Sound.play('key'); $('scr-lobby').querySelectorAll('[data-av]').forEach(function (x) { x.setAttribute('aria-checked', String(Number(x.getAttribute('data-av')) === avatarSel)); }); }
    else if (b.id === 'lb-quick') { Net.send({ type: 'quick', name: saveName(), avatar: avatarSel }); }
    else if (b.id === 'lb-create') openCreate();
    else if (b.hasAttribute('data-join')) Net.send({ type: 'join', roomId: b.getAttribute('data-join'), name: saveName(), avatar: avatarSel, want: 'player' });
    else if (b.hasAttribute('data-watch')) Net.send({ type: 'join', roomId: b.getAttribute('data-watch'), name: saveName(), avatar: avatarSel, want: 'spectator' });
  }

  /* ---------- 房間設定表單（開房與房內共用） ---------- */
  function settingsForm(s, editable, pre) {
    var dis = editable ? '' : ' disabled';
    function seg(id, items, value, label) { var h = K.segHtml(pre + id, items, String(value), label); return editable ? h : h.replace(/class="seg-btn"/g, 'class="seg-btn" disabled'); }
    return '<div class="set-form">' +
      field(t('room.mode'), seg('mode', [{ value: 'range', label: t('mode.range'), icon: K.icon('safe') }, { value: 'count', label: t('mode.count'), icon: K.icon('plus') }], s.mode, t('room.mode')), t(s.mode === 'count' ? 'mode.countSub' : 'mode.rangeSub')) +
      /* 兩種玩法都能由隊員輪流出題（一般＝出密碼、累加＝埋地雷） */
      field(t('room.setter'), seg('setter', [{ value: 'cpu', label: t('room.setterCpu') }, { value: 'player', label: t('room.setterPlayer') }], s.setterMode, t('room.setter')), t(s.setterMode === 'player' ? 'room.setterPlayerHelp' : 'room.setterCpuHelp')) +
      '<div class="set-row"><label class="set-label" for="' + pre + 'teams">' + esc(t('room.teams')) + '<small>' + esc(t('room.teamsHelp')) + '</small></label>' + K.switchHtml(pre + 'teams', s.teams, t('room.teams')).replace('<button', '<button' + dis) + '</div>' +
      '<div class="set-row"><label class="set-label" for="' + pre + 'items">' + esc(t('room.items')) + '<small>' + esc(t('room.itemsHelp')) + '</small></label>' + K.switchHtml(pre + 'items', s.items, t('room.items')).replace('<button', '<button' + dis) + '</div>' +
      field(t('room.turnSec'), seg('turn', R.TURN_SECS.map(function (v) { return { value: String(v), label: v ? t('room.secN', { n: v }) : t('room.noLimit') }; }), s.turnSec, t('room.turnSec'))) +
      field(t('room.rounds'), seg('rounds', R.ROUNDS.map(function (v) { return { value: String(v), label: t('room.roundsN', { n: v }) }; }), s.rounds, t('room.rounds'))) +
      '<div class="set-row"><span class="set-label" id="' + pre + 'cap-l">' + esc(t('room.cap')) + '</span>' + (editable ? K.stepperHtml(pre + 'cap', s.cap, t('room.cap')) : '<b class="cap-val">' + s.cap + '</b>') + '</div>' +
      '</div>';
  }
  function field(label, ctrl, help) { return '<div class="field"><span class="f-label">' + esc(label) + '</span>' + ctrl + (help ? '<small class="f-help">' + esc(help) + '</small>' : '') + '</div>'; }
  function bindSettings(scope, pre, s, onChange) {
    var q = function (id) { return scope.querySelector('#' + pre + id); };
    if (q('mode')) K.bindSeg(q('mode'), function (v) { s.mode = v; onChange(true); });
    if (q('setter')) K.bindSeg(q('setter'), function (v) { s.setterMode = v; onChange(true); });
    if (q('teams')) K.bindSwitch(q('teams'), function (v) { s.teams = v; onChange(); });
    if (q('items')) K.bindSwitch(q('items'), function (v) { s.items = v; onChange(); });
    if (q('turn')) K.bindSeg(q('turn'), function (v) { s.turnSec = Number(v); onChange(); });
    if (q('rounds')) K.bindSeg(q('rounds'), function (v) { s.rounds = Number(v); onChange(); });
    if (q('cap')) K.bindStepper(q('cap'), function () { return s.cap; }, function (v) { s.cap = v; onChange(); }, function () { return Math.max(R.CAP_MIN, room ? room.seats.filter(Boolean).length : 2); }, function () { return R.CAP_MAX; });
  }
  function openCreate() {
    var s = Object.assign({}, R.DEFAULT_SETTINGS, { priv: false });
    var body = doc.createElement('div');
    function paint() {
      body.innerHTML = settingsForm(s, true, 'cs-') +
        '<div class="set-row"><label class="set-label" for="cs-priv">' + esc(t('room.private')) + '<small>' + esc(t('room.privateHelp')) + '</small></label>' + K.switchHtml('cs-priv', s.priv, t('room.private')) + '</div>';
      bindSettings(body, 'cs-', s, function (re) { if (re) { var y = m && m.body.scrollTop; paint(); if (m) m.body.scrollTop = y; } });
      K.bindSwitch(body.querySelector('#cs-priv'), function (v) { s.priv = v; });
    }
    var m = null;
    paint();
    m = K.Modal({ title: t('lobby.create'), body: body, cls: 'create-modal', actions: [
      { label: t('common.cancel'), kind: 'ghost' },
      { label: t('room.createGo'), kind: 'primary', icon: 'check', onClick: function () { Net.send({ type: 'create', name: saveName(), avatar: avatarSel, private: s.priv, settings: { mode: s.mode, setterMode: s.setterMode, teams: s.teams, items: s.items, turnSec: s.turnSec, rounds: s.rounds, cap: s.cap } }); } }] });
  }

  /* ---------- 房間畫面 ---------- */
  var inviteRole = 'player';
  function inviteUrl() {
    if (!room || !room.invite || room.invite.revoked) return '';
    var base = root.location.origin + root.location.pathname;
    var q = '?room=' + encodeURIComponent(room.id) + '&invite=' + encodeURIComponent(room.invite.token) + (inviteRole === 'spectator' ? '&as=watch' : '');
    var sv = new URLSearchParams(root.location.search).get('server');
    if (sv) q += '&server=' + encodeURIComponent(sv);
    return root.GameBackend && root.GameBackend.pinInvite ? root.GameBackend.pinInvite(base + q) : base + q;
  }
  function seatHtml(s, i) {
    var you = room.you;
    if (!s) return '<li class="seat empty"><span class="seat-av">' + K.icon('user') + '</span><span class="seat-name">' + esc(t('room.emptySeat')) + '</span>' +
      (you.role === 'spectator' ? '<span class="seat-act"><button type="button" class="btn small" data-sit="1">' + esc(t('room.sit')) + '</button></span>' : '<span></span>') + '</li>';
    var me = s.id === you.id, host = s.id === room.hostId;
    var badges = (host ? '<i class="b-host">' + K.icon('crown') + esc(t('room.host')) + '</i>' : '') +
      (!host ? (s.ready ? '<i class="b-ready">' + K.icon('check') + esc(t('room.ready')) + '</i>' : '<i>' + esc(t('room.notReady')) + '</i>') : '') +
      (!s.connected ? '<i class="b-dc">' + esc(t('game.dc')) + '</i>' : '') +
      (s.team ? '<i class="b-team ' + s.team + '">' + K.icon('team-' + s.team) + esc(t('team.' + s.team)) + '</i>' : '');
    return '<li class="seat' + (me ? ' me' : '') + (s.ready || host ? ' ready' : '') + (s.team ? ' t-' + s.team : '') + '"><span class="seat-av">' + root.GameView.avatar(s.avatar) + root.GameView.teamMark(s.team) + '</span>' +
      '<span class="seat-name">' + esc(s.name) + (me ? '<small>' + esc(t('game.meSuffix')) + '</small>' : '') + '</span><span class="seat-badges">' + badges + '</span>' +
      '<span class="seat-act">' + (you.host && !me ? '<button type="button" class="btn small ghost icon-only" data-kick="' + esc(s.id) + '" aria-label="' + esc(t('room.kickN', { n: s.name })) + '" title="' + esc(t('room.kick')) + '">' + K.icon('kick') + '</button>' : '') + '</span></li>';
  }
  function startHint() {
    var r = room;
    if (r.recovering) return { ok: false, text: t('room.recovering') };
    if (r.startErr) return { ok: false, text: t('start.' + r.startErr) };
    var waiting = r.seats.filter(function (s) { return s && s.id !== r.hostId && !s.ready; }).length;
    if (waiting) return { ok: false, text: t('room.waitReady', { n: waiting }) };
    return { ok: true, text: t(r.you.host ? 'room.canStart' : 'room.waitHost') };
  }
  function renderRoom() {
    if (!room) { app().show('lobby'); return; }
    var r = room, you = r.you;
    var mySeat = you.seat >= 0 ? r.seats[you.seat] : null;
    var hint = startHint();
    var players = r.seats.filter(Boolean).length;
    app().setTitle(t('room.title', { c: r.id }));
    var main = '<div class="room-head"><h1 class="page-title">' + esc(t('room.title', { c: r.id })) + '</h1>' +
      (r.private ? '<span class="pill">' + K.icon('lock') + esc(t('room.privateTag')) + '</span>' : '') +
      '<span class="pill">' + K.icon('users') + players + '/' + r.settings.cap + '</span>' + (r.specs.length ? '<span class="pill">' + K.icon('eye') + r.specs.length + '</span>' : '') + '</div>' +
      (r.recovering ? '<p class="note warn">' + K.icon('refresh') + '<span>' + esc(t('room.recoveringLong')) + '</span></p>' : '') +
      (r.status === 'finished' && r.match && r.match.result ? '<p class="note">' + K.icon('trophy') + '<span>' + esc(t('room.lastResult', { w: winnerText(r.match) })) + '</span></p>' : '') +
      '<ul class="seats">' + r.seats.map(seatHtml).join('') + '</ul>' +
      (r.settings.teams && mySeat ? '<div class="team-pick" role="radiogroup" aria-label="' + esc(t('room.pickTeam')) + '">' + R.TEAMS.map(function (tm) {
        return '<button type="button" role="radio" class="team-btn ' + tm + '" data-team="' + tm + '" aria-checked="' + (mySeat.team === tm) + '">' + K.icon('team-' + tm) + '<span>' + esc(t('room.joinTeam', { t: t('team.' + tm) })) + '</span></button>';
      }).join('') + '</div>' : '') +
      '<div class="room-actions">' +
      (you.role === 'player' && !you.host ? '<button type="button" class="btn ' + (mySeat && mySeat.ready ? '' : 'primary') + ' big" id="rm-ready">' + K.icon(mySeat && mySeat.ready ? 'close' : 'check') + '<span>' + esc(t(mySeat && mySeat.ready ? 'room.unready' : 'room.readyBtn')) + '</span></button>' : '') +
      (you.host ? '<button type="button" class="btn primary big" id="rm-start"' + (hint.ok ? '' : ' disabled') + '>' + K.icon('play') + '<span>' + esc(t('room.start')) + '</span></button>' : '') +
      (you.role === 'player' ? '<button type="button" class="btn" id="rm-stand">' + K.icon('eye') + '<span>' + esc(t('room.stand')) + '</span></button>' : '') +
      '<button type="button" class="btn ghost" id="rm-leave">' + K.icon('exit') + '<span>' + esc(t('room.leave')) + '</span></button></div>' +
      '<p class="room-start-hint' + (hint.ok ? ' ok' : '') + '" aria-live="polite">' + esc(hint.text) + '</p>' +
      '<div class="room-panels"><section class="panel"><h2 class="box-title">' + K.icon('gear') + esc(t('room.settings')) + (you.host ? '' : '<small>' + esc(t('room.hostOnly')) + '</small>') + '</h2>' + settingsForm(Object.assign({}, r.settings), !!you.host, 'rs-') +
      (you.host ? '<div class="set-row"><label class="set-label" for="rs-priv">' + esc(t('room.private')) + '<small>' + esc(t('room.privateHelp')) + '</small></label>' + K.switchHtml('rs-priv', r.private, t('room.private')) + '</div>' : '') + '</section>' +
      (you.host ? '<section class="panel invite-box"><h2 class="box-title">' + K.icon('link') + esc(t('room.invite')) + '</h2>' +
        (r.invite && !r.invite.revoked ? '<div class="field"><span class="f-label">' + esc(t('room.inviteAs')) + '</span>' + K.segHtml('rm-inv-role', [{ value: 'player', label: t('room.inviteAsPlayer'), icon: K.icon('user') }, { value: 'spectator', label: t('room.inviteAsSpec'), icon: K.icon('eye') }], inviteRole, t('room.inviteAs')) + '</div>' +
          '<p class="invite-url">' + esc(inviteUrl()) + '</p><div class="row-btns">' + (root.navigator.share ? '<button type="button" class="btn small primary" id="rm-share">' + K.icon('send') + '<span>' + esc(t('room.share')) + '</span></button>' : '') + '<button type="button" class="btn small' + (root.navigator.share ? '' : ' primary') + '" id="rm-copy">' + K.icon('copy') + '<span>' + esc(t('room.copy')) + '</span></button><button type="button" class="btn small" id="rm-inv-new">' + K.icon('refresh') + '<span>' + esc(t('room.newInvite')) + '</span></button><button type="button" class="btn small danger" id="rm-inv-revoke">' + K.icon('close') + '<span>' + esc(t('room.revoke')) + '</span></button></div>'
          : '<p>' + esc(t('room.revoked')) + '</p><button type="button" class="btn small primary" id="rm-inv-new">' + K.icon('refresh') + '<span>' + esc(t('room.newInvite')) + '</span></button>') + '</section>' : '') +
      '<section class="panel"><h2 class="box-title">' + K.icon('eye') + esc(t('room.specs')) + '<small>' + r.specs.length + '/' + r.specMax + '</small></h2>' +
      (r.specs.length ? '<ul class="spec-list">' + r.specs.map(function (s) { return '<li>' + root.GameView.avatar(s.avatar, 'av-mini') + '<span>' + esc(s.name) + (s.id === you.id ? esc(t('game.meSuffix')) : '') + '</span>' + (you.host ? '<button type="button" class="btn small ghost icon-only" data-kick="' + esc(s.id) + '" aria-label="' + esc(t('room.kickN', { n: s.name })) + '">' + K.icon('kick') + '</button>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="empty">' + esc(t('room.noSpecs')) + '</p>') + '</section></div>';
    var scr = $('scr-room');
    var y = scr.querySelector('.room-main') ? scr.querySelector('.room-main').scrollTop : 0;
    var focusSel = doc.activeElement && scr.contains(doc.activeElement) ? focusKey(doc.activeElement) : null;
    if (!scr.querySelector('.room-wrap')) scr.innerHTML = '<div class="room-wrap"><div class="room-side" id="room-side"></div><div class="room-main scroll"></div></div>';
    var side = $('side');
    if (side.parentElement !== $('room-side')) $('room-side').appendChild(side);
    $('chatbox').hidden = false;
    scr.querySelector('.room-main').innerHTML = '<div class="page room">' + main + '</div>';
    scr.querySelector('.room-main').scrollTop = y;
    $('summary').innerHTML = roomSummary();
    renderChat();
    var roleSeg = $('rm-inv-role');
    if (roleSeg) K.bindSeg(roleSeg, function (v) { inviteRole = v; var u = scr.querySelector('.invite-url'); if (u) u.textContent = inviteUrl(); });
    if (you.host) {
      var s = Object.assign({}, r.settings);
      bindSettings(scr, 'rs-', s, function () { Net.send({ type: 'settings', settings: s }); });
      var pv = $('rs-priv'); if (pv) K.bindSwitch(pv, function (v) { Net.send({ type: 'private', value: v }); });
    }
    if (focusSel) { var el = scr.querySelector(focusSel); if (el) try { el.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ } }
    app().fillIcons(scr);
    K.refreshScroll();
  }
  function focusKey(el) {
    if (el.id) return '#' + el.id;
    var a = ['data-team', 'data-kick', 'data-v', 'data-d'];
    for (var i = 0; i < a.length; i++) if (el.hasAttribute(a[i])) {
      var g = el.closest('[id]');
      return (a[i] === 'data-v' || a[i] === 'data-d') && g ? '#' + g.id + ' [' + a[i] + '="' + el.getAttribute(a[i]) + '"]' : '[' + a[i] + '="' + el.getAttribute(a[i]) + '"]';
    }
    return null;
  }
  function roomSummary() {
    var s = room.settings;
    var rows = [[t('room.mode'), t(s.mode === 'count' ? 'mode.count' : 'mode.range')]];
    rows.push([t('room.setter'), t(s.setterMode === 'player' ? 'room.setterPlayer' : 'room.setterCpu')]);
    rows.push([t('room.teams'), t(s.teams ? 'common.on' : 'common.off')], [t('room.items'), t(s.items ? 'common.on' : 'common.off')],
      [t('room.turnSec'), s.turnSec ? t('room.secN', { n: s.turnSec }) : t('room.noLimit')], [t('room.rounds'), t('room.roundsN', { n: s.rounds })]);
    var html = '<div class="sum-mode"><b>' + esc(t('room.title', { c: room.id })) + '</b><span>' + esc(t(room.you.role === 'spectator' ? 'room.youSpec' : room.you.host ? 'room.youHost' : 'room.youPlayer')) + '</span></div>' +
      '<dl class="sum-list">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
    var mt = room.match;
    if (mt && (room.status !== 'waiting')) html += standingsHtml(mt);
    return html;
  }
  function standingsHtml(mt) {
    var html = '<h3 class="side-title small">' + esc(t('sum.standing', { a: Math.min(mt.round || 1, mt.rounds), b: mt.rounds })) + '</h3>';
    if (mt.teams) {
      html += '<ul class="sum-standing">' + R.TEAMS.map(function (tm) { return '<li class="t-' + tm + '">' + root.GameView.teamMark(tm).replace('team-mark', 'team-mark inline') + '<span>' + esc(t('team.' + tm)) + '</span><b>' + K.icon('mine') + (mt.teamHits[tm] || 0) + '</b></li>'; }).join('') + '</ul>';
    }
    html += '<ul class="sum-standing">' + mt.seats.map(function (i) {
      return '<li>' + root.GameView.avatar(mt.avatars[i], 'av-mini') + '<span>' + esc(mt.names[i] || '') + '</span><b>' + K.icon('mine') + (mt.hits[i] || 0) + '</b></li>';
    }).join('') + '</ul>';
    return html;
  }
  function onRoomClick(e) {
    var b = e.target.closest('button'); if (!b || b.disabled || !room) return;
    if (b.id === 'rm-ready') { var me = room.seats[room.you.seat]; Net.send({ type: 'ready', value: !(me && me.ready) }); root.Sound.play('key'); }
    else if (b.id === 'rm-start') { Net.send({ type: 'start' }); }
    else if (b.id === 'rm-stand') Net.send({ type: 'stand' });
    else if (b.id === 'rm-leave') confirmLeave();
    else if (b.hasAttribute('data-sit')) Net.send({ type: 'sit' });
    else if (b.hasAttribute('data-team')) { Net.send({ type: 'team', team: b.getAttribute('data-team') }); root.Sound.play('key'); }
    else if (b.hasAttribute('data-kick')) {
      var id = b.getAttribute('data-kick');
      var who = room.seats.filter(Boolean).concat(room.specs).find(function (s) { return s.id === id; });
      K.Modal({ title: t('room.kickT'), body: '<p>' + esc(t('room.kickBody', { n: who ? who.name : '' })) + '</p>', actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('room.kick'), kind: 'danger', icon: 'kick', onClick: function () { Net.send({ type: 'kick', target: id }); } }] });
    }
    else if (b.id === 'rm-copy') copyInvite();
    else if (b.id === 'rm-share') shareInvite();
    else if (b.id === 'rm-inv-new') Net.send({ type: 'invite_new' });
    else if (b.id === 'rm-inv-revoke') Net.send({ type: 'invite_revoke' });
  }
  function copyInvite() {
    var url = inviteUrl(); if (!url) return;
    var done = function () { K.toast(t('room.copied'), 'ok'); };
    try { root.navigator.clipboard.writeText(url).then(done, function () { K.toast(t('room.copyFail'), 'warn'); }); } catch (e) { K.toast(t('room.copyFail'), 'warn'); }
  }
  /** 用手機的原生分享面板送出邀請連結；不支援或失敗就改成複製（使用者取消則不動作） */
  function shareInvite() {
    var url = inviteUrl(); if (!url) return;
    if (!root.navigator.share) { copyInvite(); return; }
    root.navigator.share({ title: t('doc.title'), text: t(inviteRole === 'spectator' ? 'room.shareTextSpec' : 'room.shareText', { c: room.id }), url: url })
      .catch(function (e) { if (!e || e.name !== 'AbortError') copyInvite(); });
  }
  function confirmLeave() {
    if (!room) { app().show('lobby'); return; }
    var playing = room.status === 'playing' || room.status === 'between';
    K.Modal({ title: t('room.leaveT'), body: '<p>' + esc(t(playing && room.you.role === 'player' ? 'room.leaveBodyPlaying' : 'room.leaveBody')) + '</p>', actions: [
      { label: t('common.stay'), kind: 'ghost' },
      { label: t('room.leave'), kind: 'danger', icon: 'exit', onClick: function () { Net.send({ type: 'leave' }); leftRoom(); } }] });
  }
  function leftRoom() {
    room = null; forgetRoom();
    root.GameView.stop(); root.Result.hide();
    chatMsgs = []; unread = 0; lastGoAt = 0; lastHistLen = 0; lastRoundKey = ''; lastCur = null;
    app().show('lobby');
    Net.send({ type: 'lobby' });
  }

  /* ---------- 房間聊天 ---------- */
  var QUICK = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];
  function renderChat() {
    if (!room) return;
    var list = $('chat-list');
    var stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = chatMsgs.length ? chatMsgs.map(function (m) {
      var mine = m.id === room.you.id;
      return '<li class="chat-msg' + (mine ? ' mine' : '') + (m.ch === 'spec' ? ' spec' : '') + '">' + root.GameView.avatar(m.avatar) + '<span class="cm-body"><b>' + esc(m.name) + (m.role === 'spectator' ? '<i>' + esc(t('chat.spec')) + '</i>' : '') + '</b>' + esc(m.text) + '</span></li>';
    }).join('') : '<li class="chat-msg sys">' + esc(t('chat.empty')) + '</li>';
    if (stick) list.scrollTop = list.scrollHeight;
    var off = room.chatOff && room.you.role === 'player';
    $('chat-off').hidden = !off;
    $('chat-off').textContent = off ? t('chat.off') : '';
    $('chat-input').disabled = off;
    $('chat-form').querySelector('button').disabled = off;
    $('chat-quick').innerHTML = QUICK.map(function (q) { return '<button type="button" class="chip" data-q="' + q + '"' + (off ? ' disabled' : '') + '>' + esc(t('quick.' + q)) + '</button>'; }).join('');
    $('chat-input').placeholder = t(room.you.role === 'spectator' && (room.status === 'playing' || room.status === 'between') ? 'chat.phSpec' : 'chat.ph');
  }
  function addChat(m) {
    chatMsgs.push(m);
    if (chatMsgs.length > 60) chatMsgs.shift();
    renderChat();
    var sideOpen = $('app').getAttribute('data-side') === 'open';
    var narrow = root.innerWidth < 900;
    if (m.id !== (room && room.you.id) && narrow && !sideOpen) { unread++; updateBadge(); root.Sound.play('chat'); }
  }
  function updateBadge() { var b = $('side-badge'); b.hidden = !unread; b.textContent = unread > 9 ? '9+' : String(unread); }
  function sideOpened() { unread = 0; updateBadge(); }

  /* ---------- 對局畫面模型 ---------- */
  function nameOf(seat) { var mt = room.match; return mt ? (mt.names[seat] || (room.seats[seat] && room.seats[seat].name) || '?') : '?'; }
  function hostLine(mt, g) {
    var me = room.you.seat;
    if (room.status === 'between' && mt.log.length) {
      var l = mt.log[mt.log.length - 1];
      return ['boom', l.loser != null ? ['host.roundHit', { n: nameOf(l.loser), r: mt.log.length }] : ['host.roundLeft', { r: mt.log.length }]];
    }
    if (mt.phase === 'set') return ['think', g.setter === me ? [g.mode === 'count' ? 'host.youSetMine' : 'host.youSet'] : ['host.setting', { n: nameOf(g.setter) }]];
    var h = g.history[g.history.length - 1];
    if (!h) return g.mode === 'count' ? ['idle', ['host.countStart']] : ['think', ['host.rangeStart']];
    var who = h.seat === me ? t('game.you') : nameOf(h.seat);
    if (h.kind === 'guess') return h.result === 'hit' ? ['boom', ['host.hitBy', { n: who, v: h.value }]] : [h.result, [h.result === 'low' ? 'host.lowBy' : 'host.highBy', { n: who, v: h.value }]];
    if (h.kind === 'add') return h.result === 'hit' ? ['boom', ['host.hit100', { n: who, m: h.mineAt }]] : ['idle', ['host.addBy', { n: who, v: h.value, to: h.to }]];
    if (h.kind === 'item') return ['happy', [h.item === 'assign' ? 'host.assignBy' : 'host.itemBy', { n: who, it: t('item.' + h.item), to: h.target != null ? nameOf(h.target) : '' }]];
    return ['idle', ['host.countStart']];
  }
  function buildVm() {
    var mt = room.match, g = mt.game, you = room.you;
    var me = you.role === 'player' ? you.seat : -1;
    var cur = g.current;
    var counting = mt.goAt && local(mt.goAt) > Date.now();
    var setPhase = mt.phase === 'set';
    var playing = room.status === 'playing' && !g.over && !setPhase && !counting;
    var amSetter = setPhase && g.setter === me && me >= 0;
    var myTurn = playing && cur === me;
    var hl = hostLine(mt, g);
    var players = mt.seats.map(function (i) {
      var s = room.seats[i];
      var still = s && s.id && (g.order.indexOf(i) >= 0 || g.setter === i);
      return { seat: i, name: nameOf(i), avatar: mt.avatars[i], team: mt.teams ? mt.teams[i] : null, items: g.items[i] || { skip: 0, reverse: 0, assign: 0 },
        hits: mt.hits[i] || 0, me: i === me, current: !g.over && !setPhase && i === cur, setter: g.setter === i, out: !still, connected: s ? s.connected : false };
    });
    var turnText;
    if (room.status === 'between') turnText = t('game.between', { r: mt.log.length, n: mt.rounds });
    else if (room.status === 'finished') turnText = t('game.matchOver');
    else if (setPhase) turnText = amSetter ? t(g.mode === 'count' ? 'game.youSetMine' : 'game.youSet') : t('game.settingBy', { n: nameOf(g.setter) });
    else if (counting) turnText = t('game.getReady');
    else if (myTurn) turnText = t('game.yourTurn');
    else if (you.role === 'spectator') turnText = t('game.specTurn', { n: nameOf(cur) });
    else if (me >= 0 && g.setter === me) turnText = t('game.setterWatch', { n: nameOf(cur) });
    else if (me >= 0 && g.order.indexOf(me) < 0) turnText = t('game.outWatch', { n: nameOf(cur) });
    else turnText = t('game.turnOf', { n: nameOf(cur) });
    var vm = {
      kind: 'online', mode: g.mode, lo: g.lo, hi: g.hi, total: g.total, showRange: true,
      players: players, dir: g.dir, over: g.over || room.status !== 'playing',
      deadline: setPhase ? local(mt.setDeadline) : (playing && mt.deadline ? local(mt.deadline) : 0),
      turnSec: setPhase ? 30 : room.settings.turnSec,
      turnText: turnText, myTurn: myTurn || amSetter, canAct: myTurn || amSetter, itemsOn: g.itemsOn && !amSetter,
      items: me >= 0 && g.items[me] && g.order.indexOf(me) >= 0 ? g.items[me] : null,
      targets: myTurn ? R.assignTargets({ order: g.order }, me).map(function (s) { return { seat: s, name: nameOf(s), avatar: mt.avatars[s], team: mt.teams ? mt.teams[s] : null }; }) : [],
      history: g.history.map(function (h) { return Object.assign({}, h, { who: h.seat === me ? t('game.you') : nameOf(h.seat), mine: h.seat === me, targetName: h.target != null ? (h.target === me ? t('game.you') : nameOf(h.target)) : '' }); }),
      secret: g.secret, isSetter: me >= 0 && g.setter === me, hostMood: hl[0], hostText: t(hl[1][0], hl[1][1]), role: you.role,
      counter: mt.rounds > 1 ? t('game.roundN', { a: Math.min(mt.round || 1, mt.rounds), b: mt.rounds }) : '',
      submitLabel: amSetter ? t(g.mode === 'count' ? 'game.lockMine' : 'game.lockSecret') : null, setMode: amSetter,
      summaryHtml: roomSummary()
    };
    if (amSetter) { vm.mode = 'range'; vm.lo = 1; vm.hi = 100; vm.showRange = true; vm.itemsOn = false; vm.items = null; }
    return vm;
  }
  var handlers = {
    guess: function (v) {
      if (!room || !room.match) return;
      if (room.match.phase === 'set') Net.send({ type: 'secret', value: v });
      else Net.send({ type: 'act', kind: 'guess', value: v });
    },
    add: function (n) { Net.send({ type: 'act', kind: 'add', value: n }); },
    item: function (it, target) { Net.send({ type: 'act', kind: 'item', item: it, target: target }); }
  };
  function renderGame() {
    var mt = room.match;
    if (!mt || !mt.game) return;
    if (app().screen !== 'game') {
      var side = $('side');
      if (side.parentElement !== $('scr-game')) $('scr-game').insertBefore(side, $('g-center'));
      $('chatbox').hidden = false;
      root.GameView.reset();
      app().show('game');
    }
    app().setTitle(t('room.title', { c: room.id }));
    var roundKey = mt.no + ':' + (mt.log.length);
    if (roundKey !== lastRoundKey) { lastRoundKey = roundKey; lastHistLen = 0; lastCur = null; root.GameView.reset(); }
    feedback(mt.game);
    /* GA4：每一場（room＋場次）開局與結束各送一次，觀戰不計 */
    if (root.GameAnalytics) {
      var akey = room.id + ':' + mt.no;
      if (room.status === 'finished') root.GameAnalytics.sync('finished', akey, null, { result: 'complete' });
      else root.GameAnalytics.sync('playing', akey, { mode: 'online', variant: room.settings.mode, spectator: room.you.role === 'spectator', players: mt.seats.length });
    }
    root.GameView.render(buildVm(), handlers);
    renderChat();
    /* 開局倒數：各端依伺服器時間點倒數 */
    if (mt.goAt && mt.goAt !== lastGoAt && local(mt.goAt) > Date.now() - 300) {
      lastGoAt = mt.goAt;
      var go = mt.goAt;
      root.GameView.countdown(local(go), function () { if (room && room.match && room.match.goAt === go) root.GameView.render(buildVm(), handlers); });
    }
    if (room.status === 'finished') showFinal();
  }
  /** 新的一手：音效、震動、輪到自己提示 */
  function feedback(g) {
    var me = room.you.seat;
    if (g.history.length > lastHistLen) {
      var h = g.history[g.history.length - 1];
      if (lastHistLen) {
        if (h.result === 'hit') { root.Sound.play('boom'); root.Sound.vibrate(200); }
        else if (h.kind === 'item') root.Sound.play('item');
        else root.Sound.play('shrink');
      }
      lastHistLen = g.history.length;
    }
    if (!g.over && g.current === me && lastCur !== me && room.match.phase !== 'set') { root.Sound.play('turn'); root.Sound.vibrate(30); }
    lastCur = g.current;
  }
  function winnerText(mt) {
    var res = mt.result; if (!res) return '';
    if (res.teams) return res.winTeams.length > 1 ? t('res.tie') : t('res.teamWins', { t: t('team.' + res.winTeams[0]) });
    return res.winners.map(function (s) { return nameOf(s); }).join('、');
  }
  function showFinal() {
    var mt = room.match, res = mt.result;
    if (!res || lastResultNo === mt.no || root.Result.visible()) return;
    lastResultNo = mt.no;
    var me = room.you.role === 'player' ? room.you.seat : -1;
    var participant = me >= 0 && mt.seats.indexOf(me) >= 0;
    var won = participant && res.winners.indexOf(me) >= 0;
    var tie = res.teams ? res.winTeams.length > 1 : res.winners.length > 1 && res.winners.length === (res.present || mt.seats).length;
    var outcome = !participant ? 'spec' : tie ? 'draw' : won ? 'win' : 'lose';
    var recorded = null;
    if (participant) recorded = root.Store.recordMatch({ id: 'online-' + room.id + '-' + mt.no + '-' + (room.you.id || ''), kind: 'online', mode: room.settings.mode, result: outcome === 'spec' ? 'left' : outcome, metric: mt.hits[me] || 0, hits: mt.hits[me] || 0 });
    var no = mt.no;
    setTimeout(function () {
      if (!room || !room.match || room.match.no !== no || room.status !== 'finished') return;
      root.Result.show(function () {
        var m = room && room.match && room.match.no === no ? room.match : mt;
        var last = m.log[m.log.length - 1] || {};
        var o = {
          kind: outcome === 'win' ? 'win' : outcome === 'lose' ? 'lose' : outcome === 'draw' ? 'draw' : 'info',
          mood: outcome === 'lose' ? 'boom' : 'happy',
          title: outcome === 'spec' ? t('res.specTitle', { w: winnerText(m) }) : t('res.o.' + outcome),
          sub: res.teams ? t('res.teamSub', { r: m.teamHits.red || 0, b: m.teamHits.blue || 0 }) : (last.loser != null ? t('res.lastHit', { n: nameOf(last.loser) }) : t('res.noLoser')),
          ranking: m.seats.slice().sort(function (a, b) { return (m.hits[a] || 0) - (m.hits[b] || 0); }).map(function (s) {
            return { name: nameOf(s) + (s === me ? t('game.meSuffix') : ''), avatar: m.avatars[s], team: m.teams ? m.teams[s] : null, info: t('res.hitsN', { n: m.hits[s] || 0 }), me: s === me, win: res.winners.indexOf(s) >= 0 };
          }),
          lines: res.early ? [t('res.early')] : [],
          badges: [],
          again: (function () { var v = rematchVotes(); return { keep: true, label: v.mine ? t('res.rematchCancel', v) : t('res.rematchVote', v), onClick: function () { again(); }, disabled: room.you.role !== 'player', note: room.you.role !== 'player' ? t('res.specNoAgain') : t('res.rematchHelp') }; })(),
          room: { onClick: function () { app().show('room'); } },
          home: { onClick: function () { Net.send({ type: 'leave' }); leftRoom(); Net.close(); app().show('home'); } }
        };
        if (room && last.secret != null) o.reveal = room.settings.mode === 'count' ? { label: t('res.lastMine'), value: last.secret, icon: 'mine' } : { label: t('res.lastSecret'), value: last.secret };
        if (m.rounds > 1) o.lines.unshift(t('res.rounds', { n: m.log.length }));
        if (recorded && recorded.unlocked) recorded.unlocked.forEach(function (id) { o.badges.push({ icon: (root.Store.ACH.find(function (x) { return x.id === id; }) || {}).icon, text: t('ach.unlocked', { name: t('ach.' + id) }) }); });
        return o;
      });
    }, 1300);
  }
  /** 再來一局投票：在座玩家全部投票就自動開下一場；再按一次取消 */
  function rematchVotes() {
    var seated = room ? room.seats.filter(Boolean) : [];
    return { a: seated.filter(function (s) { return s.rematch; }).length, b: seated.length, mine: !!(room && room.you.seat >= 0 && room.seats[room.you.seat] && room.seats[room.you.seat].rematch) };
  }
  function again() {
    if (!room || room.you.role !== 'player') return;
    Net.send({ type: 'rematch', value: !rematchVotes().mine });
    root.Sound.play('key');
  }

  /* ---------- 伺服器訊息 ---------- */
  function onRoom(m) {
    var prev = room;
    room = m.room;
    offset = (room.serverNow || Date.now()) - Date.now();
    if (room.id) rememberRoom(room.id);
    if (resume) { resume = null; Net.resumeRoom = null; K.toast(t('online.resumed'), 'ok'); }
    if (!prev || prev.id !== room.id) { chatMsgs = (room.chat || []).slice(); unread = 0; updateBadge(); lastResultNo = 0; lastGoAt = 0; lastRoundKey = ''; if (invite) invite = null; }
    var inGame = room.match && room.match.game && (room.status === 'playing' || room.status === 'between');
    var scr = app().screen;
    if (inGame && root.Result.visible()) root.Result.hide();
    if (room.status === 'finished' && root.Result.visible() && root.Result.refresh) root.Result.refresh();
    if (inGame) renderGame();
    else if (room.status === 'finished' && room.match && scr === 'game') renderGame();
    else if (scr === 'game' && !root.Result.visible()) app().show('room');
    else if (scr === 'room') renderRoom();
    else if (scr !== 'game') app().show('room');
  }
  function onClosed(m) {
    var reason = m.reason || 'no_players';
    var was = room;
    room = null; forgetRoom();
    root.GameView.stop(); root.Result.hide();
    chatMsgs = [];
    if (was || app().screen === 'room' || app().screen === 'game') {
      app().show('lobby');
      K.Modal({ title: t('closed.title'), body: '<p>' + esc(t('closed.' + reason)) + '</p>', actions: [{ label: t('common.ok'), kind: 'primary' }] });
    }
    Net.send({ type: 'lobby' });
  }
  function onToast(m) {
    var key = 'toast.' + m.code;
    if (!root.I18N.has(key)) return;
    K.toast(t(key, m.params || {}), /idle|dc|kick/.test(m.code) ? 'warn' : '');
  }
  function onError(m) {
    var key = 'err.' + m.code;
    K.toast(root.I18N.has(key) ? t(key, m.params || {}) : t('err.generic'), 'warn');
    root.Sound.play('error');
    if (m.code === 'room_missing' && invite) invite = null;
  }

  function init() {
    K = root.Kit;
    Net.on('lobby', function (m) { lobby = { rooms: m.rooms || [], online: m.online || 0 }; if (app().screen === 'lobby') renderLobby(); maybeInvite(); });
    Net.on('room', onRoom);
    Net.on('closed', onClosed);
    Net.on('left', function () { /* 已在 leftRoom 處理 */ });
    Net.on('toast', onToast);
    Net.on('error', onError);
    Net.on('chat', function (m) { if (room) addChat(m.msg); });
    Net.on('resume_fail', function () {
      var id = resume ? resume.id : savedRoom();
      forgetRoom();
      if (app().screen === 'lobby') renderLobby();
      K.Modal({ title: t('closed.title'), body: '<p>' + esc(t('online.resumeGone', { id: id })) + '</p>', actions: [{ label: t('common.ok'), kind: 'primary' }] });
    });
    Net.on('status', function () { if (app().screen === 'lobby') renderLobby(); });
    Net.on('dropped', function () { if (room && (app().screen === 'game' || app().screen === 'room')) K.toast(t('net.dropped'), 'warn'); });
    $('scr-lobby').addEventListener('click', onLobbyClick);
    $('scr-lobby').addEventListener('submit', function (e) {
      if (e.target.id !== 'lb-code-form') return;
      e.preventDefault();
      var code = $('lb-code').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4,6}$/.test(code)) { K.toast(t('err.codeFormat'), 'warn'); return; }
      Net.send({ type: 'join', roomId: code, name: saveName(), avatar: avatarSel, want: 'player' });
    });
    $('scr-lobby').addEventListener('change', function (e) { if (e.target.id === 'lb-name') saveName(); });
    $('scr-room').addEventListener('click', onRoomClick);
    $('chat-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('chat-input').value.trim();
      if (!v || !room) return;
      Net.send({ type: 'chat', text: v });
      $('chat-input').value = '';
    });
    $('chat-quick').addEventListener('click', function (e) { var b = e.target.closest('[data-q]'); if (b && !b.disabled && room) Net.send({ type: 'chat', text: t('quick.' + b.getAttribute('data-q')) }); });
    /* 喚醒中每秒更新等待秒數 */
    setInterval(function () { if (app().screen === 'lobby' && resume && Net.status !== 'open') { var st = doc.querySelector('.net-status.wake span b'); if (st) renderLobby(); } }, 1000);
    root.I18N.onChange(function () {
      if (!room) { if (app().screen === 'lobby') renderLobby(); return; }
      if (app().screen === 'room') renderRoom();
      else if (app().screen === 'game' && room.match && room.match.game) { root.GameView.render(buildVm(), handlers); renderChat(); }
    });
  }
  /** 邀請連結：連上後自動加入 */
  function maybeInvite() {
    if (!invite || room) return;
    var inv = invite;
    invite = null;
    Net.send({ type: 'join', roomId: inv.room, token: inv.token, name: myName(), avatar: avatarSel, want: inv.as === 'watch' ? 'spectator' : 'player' });
  }

  root.OnlineUI = {
    init: init, enterLobby: enterLobby, exitLobby: exitLobby, confirmLeave: confirmLeave, renderLobby: renderLobby, renderRoom: renderRoom,
    inRoom: function () { return !!room; }, sideOpened: sideOpened, pendingResume: pendingResume, resume: resumeNow,
    get room() { return room; }
  };
})(typeof self !== 'undefined' ? self : this);
