/* ===== lib/rooms.js — 房間、席位、觀戰、邀請、聊天、對局（純邏輯，不碰 socket）=====
 * 對外只有 createHub(io, opt)：io.send(personId, msg) 負責送訊息，其餘全在這裡。規則判定全部交給 public/js/core/rules.js。
 *
 * 房間狀態：waiting 等待中 → playing 對局中（每局開頭倒數 3 秒）→ between 局間（4 秒後自動下一局）→ finished 結算（可再開一場）。
 * 祕密只存在伺服器：密碼不會出現在任何快照裡（出題者本人與該局結束後除外），觀戰者也看不到。
 *
 * 房間生命週期（以「實體玩家」為準，觀戰者不算）：
 *   - 實體玩家數降到 0 → 立即關房：邀請失效、從大廳移除、廣播 closed，已關的房間不會復活。
 *   - 斷線 30 秒內可重連回原座位；超過視為離場（座位釋出、道具作廢、出手順序跳過）。
 *   - 輪到的人斷線：10 秒後（或限時先到）照逾時規則自動行動。
 *   - 對局中連續 3 分鐘沒操作視為離場（2.5 分鐘先提醒）。
 *   - 只剩 1 人（組隊時只剩 1 隊）→ 該人／該隊直接勝。
 *
 * 重啟復原（三級備援）：opt.store 存在時，每個改變房間的操作都先寫入快照再送出訊息；
 * 啟動時從快照重建房間，所有人標成斷線，從復原完成起算 120 秒回房寬限，期間暫停倒數與計時。
 */
'use strict';

const crypto = require('crypto');
const R = require('../public/js/core/rules.js');
const { censor } = require('./lobby-chat.js');   // 與大廳聊天共用不雅字詞過濾（房間聊天、暱稱）

const CONST = {
  SPEC_MAX: 20,
  RECONNECT_MS: 30000,
  DC_TURN_MS: 10000,
  IDLE_MS: 3 * 60 * 1000,
  IDLE_WARN_MS: 2.5 * 60 * 1000,
  COUNTDOWN_MS: 3000,
  BETWEEN_MS: 4000,
  ACT_GAP_MS: 200,
  CHAT_KEEP: 80,
  CHAT_MAX: 200,
  AVATARS: 8,
  RECOVERY_MS: 120000,
  SET_MS: 30000              // 出題時間（選密碼／地雷），固定 30 秒
};
if (process.env.UC_COUNTDOWN_MS != null && process.env.UC_COUNTDOWN_MS !== '') CONST.COUNTDOWN_MS = Math.max(0, Number(process.env.UC_COUNTDOWN_MS) || 0);
if (process.env.UC_BETWEEN_MS != null && process.env.UC_BETWEEN_MS !== '') CONST.BETWEEN_MS = Math.max(0, Number(process.env.UC_BETWEEN_MS) || 0);

const ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function cleanName(raw, fallback) {
  let s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim();
  s = censor(Array.from(s).slice(0, 16).join(''));
  return s || fallback || ('玩家' + (100 + Math.floor(Math.random() * 900)));
}
function cleanText(raw) {
  return censor(Array.from(String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()).slice(0, CONST.CHAT_MAX).join(''));
}
function cleanAvatar(v) { v = Number(v); return Number.isInteger(v) && v >= 0 && v < CONST.AVATARS ? v : 0; }

function createHub(io, opt) {
  opt = opt || {};
  const now = opt.now || (() => Date.now());
  const COUNTDOWN_MS = opt.countdownMs != null ? opt.countdownMs : CONST.COUNTDOWN_MS;
  const BETWEEN_MS = opt.betweenMs != null ? opt.betweenMs : CONST.BETWEEN_MS;
  const recoveryMs = opt.recoveryMs != null ? opt.recoveryMs : CONST.RECOVERY_MS;
  const rooms = new Map();
  const where = new Map();        // personId → roomId
  const lastAct = new Map();      // personId → 上次行動時間（防狂送，不存檔）
  const lastChat = new Map();
  const store = opt.store;
  let batch;
  let dirty = true;

  function deliver(pid, msg) { try { io.send(pid, msg); } catch (e) { /* 對方已斷線 */ } }
  function send(pid, msg) { if (batch) batch.messages.push([pid, msg]); else deliver(pid, msg); }
  const markDirty = () => { dirty = true; };

  /* ---------- 持久化：先寫快照、成功後才送訊息 ---------- */
  function checkpoint(room) {
    const state = Object.assign({}, room);
    state.specs = Array.from(room.specs.entries());
    return { format: 1, savedAt: now(), room: state };
  }
  function persist(action) {
    if (!store) return action;
    return (...args) => {
      const active = { rooms: new Map(), messages: [] };
      batch = active;
      let result;
      try {
        result = action(...args);
        if (active.rooms.size) {
          const changes = [...active.rooms].map(([id, room]) => [id, room ? checkpoint(room) : null]);
          try { store.write(changes); }
          catch (error) { if (opt.onStorageError) opt.onStorageError(error); throw error; }
        }
      } finally { batch = undefined; }
      for (const m of active.messages) deliver(m[0], m[1]);
      return result;
    };
  }
  if (store) {
    const readyAt = now();
    const changes = new Map();
    for (const { format, savedAt, room } of store.load()) {
      if (format !== 1) throw new Error('不支援的房間快照版本');
      if (room.closed) continue;
      room.specs = new Map(room.specs || []);
      room.recovery = room.recovery || { savedAt: savedAt, until: readyAt + recoveryMs };
      for (const seat of room.seats) {
        if (!seat) continue;
        seat.connected = false; seat.dcAt = readyAt;
        where.set(seat.id, room.id);
      }
      for (const [id, sp] of room.specs) { sp.connected = false; where.set(id, room.id); }
      rooms.set(room.id, room);
      changes.set(room.id, checkpoint(room));
    }
    if (changes.size) store.write(changes);
  }
  /** 復原寬限結束（所有玩家都回來，或時間到）：把計時往後推「停機時間」，斷線者照一般規則處理 */
  function finishRecovery(room, t) {
    if (!room.recovery) return false;
    const { savedAt, until } = room.recovery;
    if (t < until && room.seats.some(s => s && !s.connected)) return false;
    const delay = t - savedAt;
    const mt = room.match;
    if (mt && (room.status === 'playing' || room.status === 'between')) {
      for (const k of ['goAt', 'deadline', 'turnAt', 'nextAt', 'setDeadline', 'setAt']) if (mt[k]) mt[k] += delay;
    }
    for (const s of room.seats) if (s) { if (s.lastAct) s.lastAct += delay; if (!s.connected) s.dcAt = t - CONST.RECONNECT_MS - 1; }
    for (const [id, sp] of room.specs) if (!sp.connected) { room.specs.delete(id); detach(id); }
    room.recovery = null;
    return true;
  }

  function newRoomId() {
    for (let k = 0; k < 50; k++) {
      let id = '';
      for (let i = 0; i < 4; i++) id += ID_CHARS[crypto.randomInt(ID_CHARS.length)];
      if (!rooms.has(id)) return id;
    }
    return 'R' + Date.now().toString(36).toUpperCase();
  }
  const newToken = () => crypto.randomBytes(14).toString('base64url');

  /* ---------- 查詢 ---------- */
  const seatOf = (room, pid) => room.seats.findIndex(s => s && s.id === pid);
  const humanSeats = room => room.seats.filter(Boolean);
  const seatIdx = room => room.seats.map((s, i) => s ? i : -1).filter(i => i >= 0);
  const allMembers = room => humanSeats(room).concat(Array.from(room.specs.values()));
  function roleOf(room, pid) { return seatOf(room, pid) >= 0 ? 'player' : room.specs.has(pid) ? 'spectator' : null; }
  const busy = room => room.status === 'playing' || room.status === 'between';
  function teamsMap(room, seats) {
    if (!room.settings.teams) return null;
    const out = {};
    (seats || seatIdx(room)).forEach(i => { const s = room.seats[i]; if (s && s.team) out[i] = s.team; });
    return out;
  }
  function names(room) { return room.seats.map(s => s ? s.name : ''); }

  /* ---------- 快照 ---------- */
  function gameView(room, pid) {
    const mt = room.match;
    if (!mt) return null;
    const g = mt.game;
    const mySeat = seatOf(room, pid);
    const role = roleOf(room, pid);
    const reveal = !g || g.over;
    const view = {
      no: room.matchNo, round: mt.m.round + (g && !g.over ? 1 : 0), rounds: mt.m.rounds, seats: mt.seats.slice(),
      hits: Object.assign({}, mt.m.hits), teamHits: Object.assign({}, mt.m.teamHits), teams: mt.teams,
      names: mt.names.slice(), avatars: mt.avatars.slice(),
      phase: mt.phase || 'play', setDeadline: mt.setDeadline || 0,
      goAt: mt.goAt || 0, deadline: mt.deadline || 0, nextAt: mt.nextAt || 0, turnSec: room.settings.turnSec,
      log: mt.m.log.map(l => ({ loser: l.loser, loserTeam: l.loserTeam, reason: l.reason, secret: l.secret, total: l.total }))
    };
    if (g) {
      view.game = {
        mode: g.mode, lo: g.lo, hi: g.hi, total: g.total, order: g.order.slice(), current: R.current(g), dir: g.dir,
        items: JSON.parse(JSON.stringify(g.items)), itemsOn: g.itemsOn, setter: g.setter, over: g.over,
        loser: g.loser, loserTeam: g.loserTeam, winTeam: g.winTeam || null, reason: g.reason,
        history: g.history.map(h => Object.assign({}, h)),
        secret: (reveal || (mySeat >= 0 && mySeat === g.setter && role === 'player')) ? g.secret : null
      };
    }
    if (room.status === 'finished' && room.result) view.result = room.result;
    return view;
  }
  function chatOff(room) { return room.status === 'playing' && room.match && room.match.game && room.match.game.setter != null && !room.match.game.over; }
  function chatFor(room, pid) {
    const role = roleOf(room, pid);
    return room.chat.filter(m => !(busy(room) && role === 'player' && m.ch === 'spec')).slice(-30);
  }
  function snapshot(room, pid) {
    return {
      id: room.id, status: room.status, version: room.version, serverNow: now(), private: !!room.private,
      recovering: room.recovery ? room.recovery.until : null,
      you: { id: pid, role: roleOf(room, pid), seat: seatOf(room, pid), host: room.hostId === pid },
      hostId: room.hostId,
      seats: room.seats.map(s => s && { id: s.id, name: s.name, avatar: s.avatar, connected: s.connected, ready: !!s.ready, team: s.team || null, idleWarn: !!s.idleWarn, rematch: !!s.rematch }),
      specs: Array.from(room.specs.values()).map(s => ({ id: s.id, name: s.name, avatar: s.avatar })),
      specMax: CONST.SPEC_MAX,
      settings: Object.assign({}, room.settings),
      startErr: R.canStart({ seats: seatIdx(room), teams: teamsMap(room), mode: room.settings.mode, setterMode: room.settings.setterMode }),
      match: gameView(room, pid),
      chatOff: chatOff(room),
      invite: room.hostId === pid ? { token: room.invite.token, revoked: !!room.invite.revoked } : null,
      chat: chatFor(room, pid)
    };
  }
  function broadcast(room) {
    if (room.closed) return;
    room.version++;
    if (batch) batch.rooms.set(room.id, room);
    for (const m of allMembers(room)) if (m.connected) send(m.id, { type: 'room', room: snapshot(room, m.id) });
    markDirty();
  }
  function emit(room, msg, filter) { for (const m of allMembers(room)) if (m.connected && (!filter || filter(m))) send(m.id, msg); }
  function toast(room, code, params) { emit(room, { type: 'toast', code: code, params: params || {} }); }
  function listRooms() {
    const out = [];
    for (const r of rooms.values()) {
      if (r.private || r.closed) continue;
      const host = humanSeats(r).find(s => s.id === r.hostId) || humanSeats(r)[0];
      out.push({
        id: r.id, hostName: host ? host.name : '', players: humanSeats(r).length, cap: r.settings.cap, spectators: r.specs.size,
        status: r.status, mode: r.settings.mode, teams: r.settings.teams, setterMode: r.settings.setterMode, items: r.settings.items,
        turnSec: r.settings.turnSec, rounds: r.settings.rounds, specFull: r.specs.size >= CONST.SPEC_MAX
      });
    }
    out.sort((a, b) => (a.status === 'playing' || a.status === 'between' ? 1 : 0) - (b.status === 'playing' || b.status === 'between' ? 1 : 0) || a.id.localeCompare(b.id));
    return out;
  }

  /* ---------- 建立、關閉 ---------- */
  function detach(pid) { where.delete(pid); if (io.cleared) io.cleared(pid); }
  function closeRoom(room, reason) {
    if (room.closed) return;
    room.closed = true;
    room.invite.revoked = true;
    room.status = 'closed';
    for (const m of allMembers(room)) {
      if (m.connected) send(m.id, { type: 'closed', roomId: room.id, reason: reason || 'no_players' });
      detach(m.id);
    }
    rooms.delete(room.id);
    if (batch) batch.rooms.set(room.id, null);
    markDirty();
  }
  function create(p, msg) {
    if (where.has(p.id)) leave(p.id, true);
    const settings = R.normSettings(msg && msg.settings);
    const room = {
      id: newRoomId(), hostId: p.id, version: 0, status: 'waiting', closed: false, matchNo: 0, private: !!(msg && msg.private),
      seats: new Array(settings.cap).fill(null), specs: new Map(), chat: [], result: null,
      settings: settings, invite: { token: newToken(), revoked: false }, match: null, recovery: null
    };
    room.seats[0] = { id: p.id, name: cleanName(msg && msg.name, p.name), avatar: cleanAvatar(msg && msg.avatar), connected: true, ready: false, dcAt: 0, team: settings.teams ? 'red' : null, lastAct: 0 };
    rooms.set(room.id, room);
    where.set(p.id, room.id);
    p.roomId = room.id; p.role = 'player';
    broadcast(room);
    return room;
  }
  /** 快速加入：找一間公開、等待中、還有空位的房間；沒有就自己開一間（回傳 created 讓前端告知） */
  function quick(p, msg) {
    for (const r of rooms.values()) {
      if (r.closed || r.private || busy(r) || r.recovery) continue;
      if (r.seats.some(s => !s)) { const room = join(p, { roomId: r.id, name: msg && msg.name, avatar: msg && msg.avatar, want: 'player' }); return room; }
    }
    const room = create(p, { name: msg && msg.name, avatar: msg && msg.avatar });
    send(p.id, { type: 'toast', code: 'quickCreated', params: {} });
    return room;
  }
  function join(p, msg) {
    const room = rooms.get(String(msg && msg.roomId || '').toUpperCase());
    if (!room || room.closed) return fail(p, 'room_missing');
    const name = cleanName(msg.name, p.name);
    const avatar = cleanAvatar(msg.avatar);
    if (roleOf(room, p.id)) { restore(room, p.id, name, avatar); return room; }
    if (msg.token) {
      if (String(msg.token) !== room.invite.token) return fail(p, 'invite_invalid');
      if (room.invite.revoked) return fail(p, 'invite_revoked');
    } else if (room.private) return fail(p, 'room_private');
    if (where.has(p.id)) leave(p.id, true);
    const free = room.seats.findIndex(s => !s);
    if (msg.want !== 'spectator' && free >= 0 && !busy(room) && !room.recovery) seatPlayer(room, p, free, name, avatar);
    else {
      if (room.specs.size >= CONST.SPEC_MAX) return fail(p, 'spec_full');
      addSpec(room, p, name, avatar);
    }
    toast(room, roleOf(room, p.id) === 'player' ? 'joinedPlay' : 'joinedSpec', { n: name });
    broadcast(room);
    return room;
  }
  /** 組隊時新玩家自動放到人少的那隊（之後可以自己換） */
  function autoTeam(room) {
    if (!room.settings.teams) return null;
    const red = humanSeats(room).filter(s => s.team === 'red').length, blue = humanSeats(room).filter(s => s.team === 'blue').length;
    return blue < red ? 'blue' : 'red';
  }
  function seatPlayer(room, p, idx, name, avatar) {
    room.seats[idx] = { id: p.id, name: name, avatar: avatar, connected: true, ready: false, dcAt: 0, team: autoTeam(room), lastAct: 0 };
    room.specs.delete(p.id);
    where.set(p.id, room.id);
    p.roomId = room.id; p.role = 'player';
    if (!room.hostId || seatOf(room, room.hostId) < 0) room.hostId = p.id;
  }
  function addSpec(room, p, name, avatar) {
    room.specs.set(p.id, { id: p.id, name: name, avatar: avatar, connected: true, dcAt: 0 });
    where.set(p.id, room.id);
    p.roomId = room.id; p.role = 'spectator';
  }
  function restore(room, pid, name, avatar) {
    const s = room.seats[seatOf(room, pid)] || room.specs.get(pid);
    if (!s) return;
    s.connected = true; s.dcAt = 0; if (name) s.name = name; if (avatar != null) s.avatar = avatar;
    where.set(pid, room.id);
    finishRecovery(room, now());
    broadcast(room);
  }
  function sit(p) {
    const room = roomFor(p.id); if (!room || !room.specs.has(p.id)) return;
    if (busy(room)) return fail(p, 'busy_sit');
    const free = room.seats.findIndex(s => !s);
    if (free < 0) return fail(p, 'full');
    const sp = room.specs.get(p.id);
    seatPlayer(room, p, free, sp.name, sp.avatar);
    unready(room);
    toast(room, 'sat', { n: sp.name });
    broadcast(room);
  }
  function stand(p) {
    const room = roomFor(p.id); if (!room) return;
    const seat = seatOf(room, p.id); if (seat < 0) return;
    if (busy(room)) return fail(p, 'busy_sit');
    if (room.specs.size >= CONST.SPEC_MAX) return fail(p, 'spec_full');
    const s = room.seats[seat];
    freeSeat(room, seat);
    addSpec(room, p, s.name, s.avatar);
    afterMembership(room);
  }
  function unready(room) { for (const s of room.seats) if (s) { s.ready = false; s.rematch = false; } }
  function leave(pid, silent) {
    const room = roomFor(pid); if (!room) { where.delete(pid); return; }
    const seat = seatOf(room, pid);
    if (seat >= 0) {
      const name = room.seats[seat].name;
      if (busy(room)) dropOut(room, seat);
      freeSeat(room, seat);
      if (!silent) toast(room, 'leftRoom', { n: name });
    } else if (room.specs.has(pid)) room.specs.delete(pid);
    detach(pid);
    afterMembership(room);
  }
  function freeSeat(room, idx) {
    const s = room.seats[idx];
    room.seats[idx] = null;
    if (s && room.hostId === s.id) { const nxt = humanSeats(room)[0]; room.hostId = nxt ? nxt.id : ''; }
    unready(room);
  }
  function afterMembership(room) {
    if (room.closed) return;
    if (humanSeats(room).length === 0) { closeRoom(room, 'no_players'); return; }
    broadcast(room);
  }
  function kick(p, targetId) {
    const room = roomFor(p.id); if (!room || room.hostId !== p.id || targetId === p.id) return;
    if (!roleOf(room, targetId)) return;
    const who = room.seats[seatOf(room, targetId)] || room.specs.get(targetId) || {};
    send(targetId, { type: 'closed', roomId: room.id, reason: 'kicked' });
    leave(targetId, true);
    if (!room.closed) toast(room, 'kicked', { n: who.name || '' });
  }

  /* ---------- 設定、隊伍 ---------- */
  function settings(p, msg) {
    const room = roomFor(p.id); if (!room || room.hostId !== p.id) return;
    if (busy(room)) return fail(p, 'busy_settings');
    const next = R.normSettings(msg, room.settings);
    if (next.cap !== room.settings.cap) {
      if (next.cap < humanSeats(room).length) return fail(p, 'cap_busy');
      /* 縮小：把後面的人往前挪；放大：補空位 */
      const people = humanSeats(room);
      room.seats = new Array(next.cap).fill(null);
      people.forEach((s, i) => { room.seats[i] = s; });
    }
    if (next.teams && !room.settings.teams) {
      /* 開啟組隊：依座位交替分紅藍，之後各自可換 */
      let k = 0;
      for (const s of room.seats) if (s) s.team = (k++ % 2) ? 'blue' : 'red';
    } else if (!next.teams) for (const s of room.seats) if (s) s.team = null;
    room.settings = next;
    room.result = null;
    if (room.status === 'finished') { room.status = 'waiting'; room.match = null; }
    unready(room);
    broadcast(room);
  }
  function setTeam(p, team) {
    const room = roomFor(p.id); if (!room || !room.settings.teams) return;
    const seat = seatOf(room, p.id); if (seat < 0) return;
    if (busy(room)) return fail(p, 'busy_settings');
    if (R.TEAMS.indexOf(team) < 0) return;
    room.seats[seat].team = team;
    room.seats[seat].ready = false;
    broadcast(room);
  }
  function setPrivate(p, value) {
    const room = roomFor(p.id); if (!room || room.hostId !== p.id) return;
    room.private = !!value;
    broadcast(room);
  }
  function inviteNew(p) {
    const room = roomFor(p.id); if (!room || room.hostId !== p.id) return;
    room.invite = { token: newToken(), revoked: false };
    toast(room, 'newInvite');
    broadcast(room);
  }
  function inviteRevoke(p) {
    const room = roomFor(p.id); if (!room || room.hostId !== p.id) return;
    room.invite.revoked = true;
    broadcast(room);
  }
  function chat(p, text) {
    const room = roomFor(p.id); if (!room) return;
    const t = cleanText(text); if (!t) return;
    const role = roleOf(room, p.id);
    if (chatOff(room) && role === 'player') return fail(p, 'chat_off');
    const last = lastChat.get(p.id) || 0;
    if (now() - last < 350) return;
    lastChat.set(p.id, now());
    const who = room.seats[seatOf(room, p.id)] || room.specs.get(p.id);
    const m = { id: p.id, name: who.name, avatar: who.avatar, role: role, text: t, t: now(), ch: busy(room) && role === 'spectator' ? 'spec' : 'all' };
    room.chat.push(m);
    if (room.chat.length > CONST.CHAT_KEEP) room.chat.shift();
    if (batch) batch.rooms.set(room.id, room);
    emit(room, { type: 'chat', msg: m }, mem => !(m.ch === 'spec' && seatOf(room, mem.id) >= 0));
  }

  /* ---------- 準備、開局 ---------- */
  function setReady(p, value) {
    const room = roomFor(p.id); if (!room) return;
    const seat = seatOf(room, p.id); if (seat < 0) return;
    if (busy(room)) return;
    room.seats[seat].ready = value !== false;
    broadcast(room);
  }
  function start(p) {
    const room = roomFor(p.id); if (!room || room.hostId !== p.id) return;
    if (busy(room)) return;
    if (room.recovery) return fail(p, 'recovering');
    const seats = seatIdx(room);
    const err = R.canStart({ seats: seats, teams: teamsMap(room, seats), mode: room.settings.mode, setterMode: room.settings.setterMode });
    if (err) return fail(p, 'start_' + err);
    if (seats.some(i => room.seats[i].id !== room.hostId && !room.seats[i].ready)) return fail(p, 'start_not_ready');
    beginMatch(room);
  }
  /**
   * 再來一局投票（結算後）：在座的玩家全部投票就自動開下一場，不必等房主按開始。
   * 再按一次取消投票；有人離開、改設定或房主直接開始都會清掉投票。
   */
  function rematch(p, value) {
    const room = roomFor(p.id); if (!room || room.status !== 'finished') return;
    if (room.recovery) return fail(p, 'recovering');
    const seat = seatOf(room, p.id); if (seat < 0) return fail(p, 'not_player');
    room.seats[seat].rematch = value !== false;
    room.seats[seat].ready = value !== false;
    const seats = seatIdx(room);
    if (seats.length >= 2 && seats.every(i => room.seats[i].rematch)) {
      const err = R.canStart({ seats: seats, teams: teamsMap(room, seats), mode: room.settings.mode, setterMode: room.settings.setterMode });
      if (err) { for (const i of seats) room.seats[i].rematch = false; emit(room, { type: 'error', code: 'start_' + err, params: {} }); broadcast(room); return; }
      toast(room, 'rematchGo');
      beginMatch(room);
      return;
    }
    broadcast(room);
  }
  function beginMatch(room) {
    const seats = seatIdx(room);
    room.matchNo++;
    const teams = teamsMap(room, seats);
    room.match = {
      m: R.createMatch({ rounds: room.settings.rounds, seats: seats, teams: teams }),
      seats: seats, teams: teams, names: names(room), avatars: room.seats.map(s => s ? s.avatar : 0),
      seed: 'room:' + room.id + ':' + room.matchNo + ':' + R.randomSeed(), game: null, goAt: 0, deadline: 0, turnAt: 0, nextAt: 0
    };
    room.result = null;
    for (const s of room.seats) if (s) { s.ready = false; s.idleWarn = false; s.rematch = false; }
    startRound(room);
    broadcast(room);
  }
  /** 目前仍在座位上的參賽者 */
  function present(room) { const mt = room.match; return mt ? mt.seats.filter(i => room.seats[i] && room.seats[i].id === mt.ids[i] && (mt.gone || []).indexOf(i) < 0) : []; }
  function startRound(room) {
    const mt = room.match, k = mt.m.round;
    if (!mt.ids) { mt.ids = {}; mt.seats.forEach(i => { mt.ids[i] = room.seats[i].id; }); }
    const seats = present(room);
    const setter = room.settings.setterMode === 'player' ? R.pickSetter(seats, mt.teams, k) : null;
    const rng = R.rngFrom(mt.seed + ':r' + k);
    mt.game = R.createGame({ mode: room.settings.mode, seats: seats, teams: mt.teams, setter: setter, itemsOn: room.settings.items, rng: rng, startPos: k, firstTeam: k % 2 ? 'blue' : 'red' });
    const t = now();
    mt.nextAt = 0;
    room.status = 'playing';
    if (setter != null) {
      /* 出題玩家先選密碼（createGame 已備好隨機預設值，時間到就用它），選好才開始倒數 */
      mt.phase = 'set';
      mt.goAt = 0; mt.deadline = 0;
      mt.setAt = t;
      mt.setDeadline = t + CONST.SET_MS;
      for (const i of seats) room.seats[i].lastAct = t;
    } else beginPlay(room);
  }
  /** 開始猜：倒數 3 秒後第一位出手 */
  function beginPlay(room) {
    const mt = room.match;
    mt.phase = 'play';
    mt.setDeadline = 0;
    mt.goAt = now() + COUNTDOWN_MS;
    mt.turnAt = mt.goAt;
    mt.deadline = room.settings.turnSec ? mt.goAt + room.settings.turnSec * 1000 : 0;
    for (const i of present(room)) room.seats[i].lastAct = mt.goAt;
  }
  /** 出題玩家鎖定密碼 */
  function setSecret(p, value) {
    const room = roomFor(p.id); if (!room || room.status !== 'playing' || !room.match || room.match.phase !== 'set') return;
    if (room.recovery) return fail(p, 'recovering');
    const seat = seatOf(room, p.id);
    const g = room.match.game;
    if (seat < 0 || g.setter !== seat) return fail(p, 'not_setter');
    const v = Number(value);
    if (!Number.isInteger(v) || v < R.MIN || v > R.MAX) return fail(p, 'bad_secret');
    g.secret = v;
    room.seats[seat].lastAct = now();
    beginPlay(room);
    toast(room, 'setterLocked', { n: room.seats[seat].name });
    broadcast(room);
  }
  function nextTurnClock(room) {
    const mt = room.match, t = now();
    mt.turnAt = t;
    mt.deadline = room.settings.turnSec ? t + room.settings.turnSec * 1000 : 0;
  }

  /* ---------- 行動 ---------- */
  function act(p, msg) {
    const room = roomFor(p.id); if (!room || room.status !== 'playing') return;
    if (room.recovery) return fail(p, 'recovering');
    const seat = seatOf(room, p.id); if (seat < 0) return fail(p, 'not_player');
    const mt = room.match, g = mt.game;
    const t = now();
    if (mt.phase !== 'play' || t < mt.goAt) return fail(p, 'not_started');
    if (R.current(g) !== seat) return fail(p, 'not_turn');
    const last = lastAct.get(p.id) || 0;
    if (t - last < CONST.ACT_GAP_MS) return fail(p, 'too_fast');
    lastAct.set(p.id, t);
    let r;
    const kind = msg && msg.kind;
    if (kind === 'guess') r = R.guess(g, seat, Number(msg.value));
    else if (kind === 'add') r = R.add(g, seat, Number(msg.value));
    else if (kind === 'item') r = R.useItem(g, seat, String(msg.item || ''), msg.target);
    else return fail(p, 'bad_act');
    if (!r.ok) return fail(p, r.err);
    room.seats[seat].lastAct = t; room.seats[seat].idleWarn = false;
    afterAct(room);
  }
  function afterAct(room) {
    const g = room.match.game;
    if (g.over) endRound(room);
    else nextTurnClock(room);
    broadcast(room);
  }
  function autoAct(room) {
    const mt = room.match;
    const r = R.autoAct(mt.game, R.rngFrom(mt.seed + ':auto:' + mt.game.history.length));
    if (r.ok) afterAct(room);
  }
  /** 有人在對局中離場：從順序移除；人數不足就提前結束這局 */
  function dropOut(room, seat) {
    const mt = room.match; if (!mt || !mt.game) return;
    const g = mt.game;
    const pres = present(room);
    (mt.gone = mt.gone || []).push(seat);       // 這一場之後都不算在場（座位就算被別人坐走也一樣）
    if (room.status === 'playing' && !g.over) {
      const before = R.current(g);
      const res = R.removePlayer(g, seat, pres);
      if (res.ended) endRound(room);
      else if (before === seat) nextTurnClock(room);
    } else if (g.items[seat]) g.items[seat] = { skip: 0, reverse: 0, assign: 0 };
    /* 局間有人走：剩下的人不夠下一局就直接結算 */
    if (room.status === 'between') {
      const left = present(room);
      const alive = mt.teams ? R.TEAMS.filter(tm => left.some(i => mt.teams[i] === tm)).length : left.length;
      if (alive < 2) finishMatch(room, left);
    }
  }
  function endRound(room) {
    const mt = room.match, g = mt.game;
    R.recordRound(mt.m, g);
    mt.deadline = 0;
    const pres = present(room);
    const alive = mt.teams ? R.TEAMS.filter(tm => pres.some(i => mt.teams[i] === tm)).length : pres.length;
    if (R.matchOver(mt.m) || alive < 2) { finishMatch(room, pres); return; }
    room.status = 'between';
    mt.nextAt = now() + BETWEEN_MS;
  }
  function finishMatch(room, pres) {
    const mt = room.match;
    room.status = 'finished';
    mt.deadline = 0; mt.nextAt = 0;
    const st = R.standings(mt.m, pres && pres.length ? pres : null);
    const early = mt.m.round < mt.m.rounds;
    room.result = { winners: st.winners, winTeams: st.winTeams || null, teams: !!mt.teams, hits: Object.assign({}, mt.m.hits), teamHits: Object.assign({}, mt.m.teamHits), early: early, present: (pres || []).slice() };
    toast(room, 'over');
  }

  /* ---------- 連線狀態 ---------- */
  function markDisconnected(pid) {
    const room = roomFor(pid); if (!room) return;
    const s = room.seats[seatOf(room, pid)] || room.specs.get(pid);
    if (!s) return;
    s.connected = false; s.dcAt = now();
    if (room.specs.has(pid) && !room.recovery) { room.specs.delete(pid); detach(pid); }
    broadcast(room);
  }
  /**
   * 重連：同一個 clientId（personId）回到原房間；resumeRoomId 是前端記住的房號（重新整理或後端重啟後）。
   * 回傳房間；找不到時回傳 null，並在有 resumeRoomId 時告知前端「原房間已不存在」。
   */
  function reconnect(p, resumeRoomId) {
    let room = roomFor(p.id);
    if (room && room.recovery && now() >= room.recovery.until) { tick(); room = roomFor(p.id); }
    if (!room) {
      if (resumeRoomId) send(p.id, { type: 'resume_fail', roomId: String(resumeRoomId).slice(0, 12) });
      return null;
    }
    const s = room.seats[seatOf(room, p.id)] || room.specs.get(p.id);
    if (!s) return null;
    s.connected = true; s.dcAt = 0;
    p.roomId = room.id; p.role = roleOf(room, p.id);
    finishRecovery(room, now());
    broadcast(room);
    return room;
  }
  /** 定期呼叫：斷線寬限、逾時、斷線代打、掛機、局間、復原寬限 */
  function tick() {
    const t = now();
    for (const room of Array.from(rooms.values())) {
      if (room.closed) continue;
      let changed = finishRecovery(room, t);
      if (room.recovery) continue;
      for (let i = 0; i < room.seats.length; i++) {
        const s = room.seats[i];
        if (s && !s.connected && t - s.dcAt > CONST.RECONNECT_MS) {
          changed = true;
          if (busy(room)) { dropOut(room, i); toast(room, 'dcLoss', { n: s.name }); }
          freeSeat(room, i);
          detach(s.id);
        }
      }
      if (humanSeats(room).length === 0) { closeRoom(room, 'no_players'); continue; }
      const mt = room.match;
      if (room.status === 'playing' && mt && mt.phase === 'set') {
        /* 出題時間到、或出題者斷線超過 10 秒：用預設密碼開始 */
        const ss = room.seats[mt.game.setter];
        if (t >= mt.setDeadline || !ss || (!ss.connected && t - Math.max(ss.dcAt, mt.setAt) > CONST.DC_TURN_MS)) { beginPlay(room); toast(room, 'setterAuto'); changed = true; }
      } else if (room.status === 'playing' && mt && mt.game && !mt.game.over && t >= mt.goAt) {
        const cur = R.current(mt.game);
        const s = room.seats[cur];
        if (mt.deadline && t >= mt.deadline) { autoAct(room); changed = false; }
        else if (s && !s.connected && t - Math.max(s.dcAt, mt.turnAt) > CONST.DC_TURN_MS) { autoAct(room); changed = false; }
        else if (s && s.connected) {
          const idle = t - (s.lastAct || mt.goAt);   // 以最後一次「真正操作」計算，逾時自動行動不算
          if (idle > CONST.IDLE_MS) {
            toast(room, 'idleOut', { n: s.name });
            send(s.id, { type: 'closed', roomId: room.id, reason: 'idle' });
            const id = s.id;
            dropOut(room, cur); freeSeat(room, cur); detach(id);
            if (humanSeats(room).length === 0) { closeRoom(room, 'no_players'); continue; }
            changed = true;
          } else if (idle > CONST.IDLE_WARN_MS && !s.idleWarn) {
            s.idleWarn = true; changed = true;
            send(s.id, { type: 'toast', code: 'idleWarn', params: {} });
          }
        }
      }
      if (room.status === 'between' && mt && mt.nextAt && t >= mt.nextAt) { startRound(room); changed = true; }
      if (changed) broadcast(room);
    }
  }

  /* ---------- 其他 ---------- */
  function roomFor(pid) { const id = where.get(pid); const r = id && rooms.get(id); return r && !r.closed ? r : null; }
  function fail(p, code, params) { if (p && p.id) send(p.id, { type: 'error', code: code, params: params || {} }); return null; }
  function sendRoom(pid) { const r = roomFor(pid); if (r) send(pid, { type: 'room', room: snapshot(r, pid) }); }
  function popDirty() { const d = dirty; dirty = false; return d; }
  function stats() {
    let players = 0, spectators = 0;
    for (const r of rooms.values()) { players += humanSeats(r).filter(s => s.connected).length; spectators += r.specs.size; }
    return { rooms: rooms.size, players: players, spectators: spectators };
  }

  return {
    CONST, rooms,
    create: persist(create), quick: persist(quick), join: persist(join), sit: persist(sit), stand: persist(stand), leave: persist(leave),
    kick: persist(kick), settings: persist(settings), setTeam: persist(setTeam), setPrivate: persist(setPrivate),
    inviteNew: persist(inviteNew), inviteRevoke: persist(inviteRevoke), chat: persist(chat),
    setReady: persist(setReady), start: persist(start), rematch: persist(rematch), act: persist(act), setSecret: persist(setSecret),
    markDisconnected: persist(markDisconnected), reconnect: persist(reconnect), tick: persist(tick), closeRoom: persist(closeRoom),
    listRooms, roomFor, sendRoom, snapshot, popDirty, stats
  };
}

module.exports = { createHub, CONST, cleanName, cleanText };
