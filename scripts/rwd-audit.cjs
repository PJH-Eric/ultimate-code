/* ===== scripts/rwd-audit.cjs — 全畫面 RWD 巡檢（開發用，需要 playwright 與執行中的伺服器）=====
 * 用法：node scripts/rwd-audit.cjs [round]   → tmp/audit/<round>/*.png 與 report.json
 * 環境變數：BASE（預設 http://localhost:3110/）、SCENES、VIEWS_JSON、LANGS（預設 zh-Hant,en,zh-Hans）
 * 每個畫面 × 裝置 × 語言檢查：JS 錯誤、整頁水平溢出、按鈕／標籤文字被截斷、原生控制項外露、
 * 主要操作被遮住或在畫面外（且不在可捲動容器內）、元素互相重疊、彈窗塞得下。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const round = process.argv[2] || 'r';
const out = path.join(__dirname, '..', 'tmp', 'audit', round);
fs.mkdirSync(out, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:3110/';
const VIEWS = process.env.VIEWS_JSON ? JSON.parse(process.env.VIEWS_JSON) : [
  ['phoneS', 360, 640], ['phone', 390, 844], ['phoneL', 844, 390], ['tabP', 820, 1180], ['tabL', 1180, 820], ['desk', 1440, 900]
];
const LANGS = (process.env.LANGS || 'zh-Hant,en,zh-Hans').split(',');

let BROWSER = null;
/** 線上場景需要其他玩家：另開分頁加入同一房間 */
async function extra(p, name, opt) {
  opt = opt || {};
  const id = await p.evaluate(() => OnlineUI.room && OnlineUI.room.id);
  const ctx = await BROWSER.newContext({ viewport: { width: 800, height: 600 } });
  const q = await ctx.newPage();
  await q.goto(BASE); await q.waitForTimeout(300);
  await q.evaluate(() => OnlineUI.enterLobby()); await q.waitForTimeout(800);
  await q.evaluate(([id, name, want]) => Net.send({ type: 'join', roomId: id, name, want: want || 'player' }), [id, name, opt.want]); await q.waitForTimeout(400);
  if (opt.team) { await q.evaluate(team => Net.send({ type: 'team', team }), opt.team); await q.waitForTimeout(150); }
  if (opt.want !== 'spectator') await q.evaluate(() => Net.send({ type: 'ready', value: true }));
  await q.waitForTimeout(200);
  (p._ctx = p._ctx || []).push(ctx);
  return q;
}
async function createRoom(p, settings, name) {
  await p.evaluate(() => OnlineUI.enterLobby()); await p.waitForTimeout(900);
  await p.evaluate(([s, n]) => Net.send({ type: 'create', name: n, settings: s }), [settings, name || '測試玩家名字很長很長的人']); await p.waitForTimeout(700);
}
async function startOnline(p) { await p.evaluate(() => Net.send({ type: 'start' })); await p.waitForTimeout(700); }

const SCENES = {
  home: async () => {},
  solo: async p => p.evaluate(() => App.show('solo')),
  records: async p => p.evaluate(() => App.show('records')),
  help: async p => p.evaluate(() => App.show('help')),
  settings: async p => { await p.click('#btn-settings'); await p.waitForTimeout(250); },
  langMenu: async p => { await p.click('#btn-lang'); await p.waitForTimeout(150); },
  crack: async p => { await p.evaluate(() => Solo.start({ kind: 'crack', skipCountdown: true, seed: 'audit' })); await p.evaluate(() => { GameView._pick(30); GameView._submit(); }); await p.waitForTimeout(150); await p.evaluate(() => { GameView._pick(70); GameView._submit(); }); await p.waitForTimeout(150); await p.evaluate(() => GameView._pick(50)); },
  crackPad: async p => { await p.evaluate(() => Store.set('inputMode', 'pad')); await SCENES.crack(p); },
  crackHist: async p => { await SCENES.crack(p); await p.evaluate(() => GameView.showTab('hist')); },
  crackSide: async p => { await SCENES.crack(p); await p.evaluate(() => App.openSide()); await p.waitForTimeout(250); },
  countdown: async p => { await p.evaluate(() => Solo.start({ kind: 'crack', seed: 'audit' })); await p.waitForTimeout(300); },
  crackWin: async p => { await p.evaluate(() => Solo.start({ kind: 'crack', skipCountdown: true, seed: 'audit' })); await p.evaluate(() => { const s = Solo.active.st.secret; GameView._pick(s); GameView._submit(); }); await p.waitForTimeout(1500); },
  step: async p => { await p.evaluate(() => Solo.start({ kind: 'step', skipCountdown: true, seed: 'audit' })); await p.evaluate(() => { GameView._add(2); GameView._add(2); }); },
  stepLose: async p => { await p.evaluate(() => Solo.start({ kind: 'step', skipCountdown: true, seed: 'audit' })); await p.evaluate(() => { const m = Solo.active.st.mines[0]; let t = 0; while (m - t > 3) { const n = (m - t - 3 >= 1 && Solo.active.st.mines.indexOf(t + 3) < 0) ? 3 : (Solo.active.st.mines.indexOf(t + 2) < 0 ? 2 : 1); GameView._add(n); t = Solo.active.st.total; if (Solo.active.st.over) return; } GameView._add(m - t); }); await p.waitForTimeout(1800); },
  lobby: async p => { await p.evaluate(() => OnlineUI.enterLobby()); await p.waitForTimeout(1000); },
  room: async p => { await createRoom(p, { mode: 'range', teams: false }); await extra(p, '第二位玩家'); },
  roomTeams: async p => { await createRoom(p, { mode: 'range', teams: true, setterMode: 'player', rounds: 3, cap: 8 }); await p.evaluate(() => Net.send({ type: 'team', team: 'red' })); await extra(p, '藍隊玩家一號', { team: 'blue' }); await extra(p, '紅隊二號', { team: 'red' }); await extra(p, 'Blue Two', { team: 'blue' }); await extra(p, '觀戰的人', { want: 'spectator' }); },
  online: async p => { await SCENES.room(p); await extra(p, '第三位'); await startOnline(p); await p.waitForTimeout(400); },
  onlineCount: async p => { await createRoom(p, { mode: 'count', turnSec: 15 }); await extra(p, '玩家二'); await startOnline(p); await p.waitForTimeout(400); },
  onlineTeams: async p => { await SCENES.roomTeams(p); await startOnline(p); await p.waitForTimeout(400); },
  onlineSide: async p => { await SCENES.online(p); await p.evaluate(() => App.openSide()); await p.waitForTimeout(250); },
  onlineEnd: async p => { await SCENES.online(p); await p.evaluate(() => { const ids = OnlineUI.room.game; }); const qs = p._ctx.map(c => c.pages()[0]); for (const q of qs) { await q.evaluate(() => Net.send({ type: 'leave' })); await p.waitForTimeout(250); } await p.waitForTimeout(1600); }
};
const ONLY = process.env.SCENES ? process.env.SCENES.split(',') : Object.keys(SCENES);

async function check(p, view) {
  return p.evaluate(view => {
    const issues = [];
    const vw = innerWidth, vh = innerHeight;
    if (document.documentElement.scrollWidth > vw + 1) issues.push('整頁水平溢出 ' + document.documentElement.scrollWidth);
    const visible = el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || n.hidden) return false; } return true; };
    /* 按鈕文字截斷 */
    document.querySelectorAll('button, .btn, .pill-btn, .seg-btn, .chip, .menu-opt, .item-btn').forEach(b => {
      if (!visible(b)) return;
      if (b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflow !== 'visible') issues.push('按鈕截斷：' + (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 20));
      const r = b.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) issues.push('按鈕超出畫面寬：' + (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 20));
      [...b.querySelectorAll('span, b, small')].forEach(s => { if (s.children.length === 0 && s.scrollWidth > s.clientWidth + 2 && getComputedStyle(s).textOverflow !== 'ellipsis' && getComputedStyle(s).overflow === 'hidden') issues.push('文字被切：' + s.textContent.trim().slice(0, 20)); });
    });
    /* 原生控制項外露 */
    document.querySelectorAll('select, input[type=checkbox], input[type=radio], input[type=range], progress, meter').forEach(el => { if (visible(el)) issues.push('原生控制項：' + el.tagName); });
    /* 主要操作：要嘛在視窗內，要嘛位於可捲動容器中 */
    const inScroller = el => { for (let n = el.parentElement; n; n = n.parentElement) { const cs = getComputedStyle(n); if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return true; } return false; };
    const sel = ['#k-submit', '.step-big', '.item-btn', '.res-actions .btn', '.modal-foot .btn', '#btn-settings', '#btn-lang', '#btn-back', '.g-tabs button', '.room-actions .btn'];
    document.querySelectorAll(sel.join(',')).forEach(el => {
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      const out = r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1;
      if (out && !inScroller(el)) issues.push('操作在畫面外且無法捲動到：' + (el.textContent || el.id || el.className).trim().slice(0, 24));
      /* 被其他元素蓋住（取中心點） */
      if (!out) {
        const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
        const top = document.elementFromPoint(cx, cy);
        if (top && !el.contains(top) && !top.closest('.sb-track, .toasts')) {
          const lay = n => n.closest('.modal-mask, .result-layer, .countdown, .menu-pop, .side, .side-backdrop, .result-share-dialog-layer, .server-outage-mask');
          const name = (el.textContent || el.id || '').trim().slice(0, 20);
          if (top.closest('.lc-root') && !lay(el)) issues.push('被大廳聊天遮住：' + name);
          else if (lay(el) === lay(top) && !top.closest('.lc-root')) issues.push('操作被遮住：' + name + ' ← ' + (String(top.className) || top.tagName));
        }
      }
    });
    /* 文字被擠壓成直排（容器太窄） */
    document.querySelectorAll('.bubble, .pc-name, .gt-text, .rd-label, .res-title, .mc-text b, .big-btn b, .seat-name, .rr-main b').forEach(el => { if (!visible(el) || !el.textContent.trim()) return; const r = el.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(el).fontSize) * 1.6; if (r.height > lh * 3.2 && r.width < r.height) issues.push('文字擠壓：' + el.textContent.trim().slice(0, 16)); });
    /* 會捲動的區域要看得到自訂捲軸，而且捲軸在最上層（沒被遮罩或其他層蓋住） */
    document.querySelectorAll('.scroll').forEach(el => {
      if (!visible(el) || el.scrollHeight <= el.clientHeight + 2 || el.getBoundingClientRect().height < 40) return;
      if (el.closest('[inert]')) return;
      const r = el.getBoundingClientRect();
      const x = Math.min(vw - 1, r.right - 5), y = Math.min(vh - 1, Math.max(0, r.top + Math.min(r.height, vh - r.top) / 2));
      const hit = document.elementFromPoint(x, y);
      if (!hit || !hit.closest('.sb-track')) issues.push('捲軸看不到：' + (el.id || String(el.className).split(' ')[0]));
    });
    /* 彈窗塞得下 */
    document.querySelectorAll('.modal, .result-card, .menu-pop').forEach(m => { if (!visible(m)) return; const r = m.getBoundingClientRect(); if (r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1 || r.left < -1) issues.push('彈窗超出畫面：' + m.className); });
    /* 文字溢出容器（玩家卡、標題） */
    document.querySelectorAll('.pc, .seat, .room-row, .h-row, .rec, .ach, .stat').forEach(el => { if (visible(el) && el.scrollWidth > el.clientWidth + 2) issues.push('內容溢出：' + el.className.split(' ')[0]); });
    return [...new Set(issues)];
  }, view);
}

(async () => {
  const browser = await chromium.launch(); BROWSER = browser;
  const report = [];
  let total = 0;
  for (const lang of LANGS) {
    for (const [vname, w, h] of VIEWS) {
      for (const scene of ONLY) {
        if (!SCENES[scene]) continue;
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: false, deviceScaleFactor: 1 });
        await ctx.addInitScript(lang => { try { localStorage.setItem('ultimate-code:v1', JSON.stringify({ lang, nickname: '測試玩家' })); } catch (e) {} }, lang);
        const p = await ctx.newPage();
        const errors = [];
        p.on('pageerror', e => errors.push('JS 錯誤：' + e.message));
        p.on('console', m => { if (m.type() === 'error' && !/favicon|404|backend-routing|ERR_CONNECTION|WebSocket/.test(m.text())) errors.push('console：' + m.text().slice(0, 120)); });
        try {
          await p.goto(BASE, { waitUntil: 'load' });
          await p.waitForTimeout(250);
          await SCENES[scene](p);
          await p.waitForTimeout(350);
          const issues = errors.concat(await check(p, vname));
          const file = `${scene}-${vname}-${lang}.png`;
          await p.screenshot({ path: path.join(out, file) });
          report.push({ scene, view: vname, lang, issues, file });
          total += issues.length;
          if (issues.length) console.log(`✗ ${scene} ${vname} ${lang}: ${issues.join(' | ')}`);
        } catch (e) {
          report.push({ scene, view: vname, lang, issues: ['腳本失敗：' + e.message.split('\n')[0]] });
          total++;
          console.log(`✗ ${scene} ${vname} ${lang}: 腳本失敗 ${e.message.split('\n')[0]}`);
        }
        for (const c of p._ctx || []) await c.close();
        await ctx.close();
      }
    }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`巡檢完成：${report.length} 個畫面，問題 ${total} 項 → ${out}`);
  await browser.close();
  process.exit(total ? 1 : 0);
})();
