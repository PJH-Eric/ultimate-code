/* ===== ui/result.js — 結算（疊在遊戲畫面上的 overlay，不切換頁面、背景保留盤面）=====
 * 固定三顆按鈕：再來一局／回到房間／回到首頁（目前模式不能用的會停用並說明原因）。
 * 內容：輸家或輸的隊伍、密碼揭曉、本局統計、星數、排名（中標次數）、新紀錄與新成就。
 * 卡片帶 data-result-share，共用的 result-share.js 會在底部加上「分享結果」把卡片做成圖片。
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var onKey = null;
  var builder = null;

  function t(k, p) { return root.I18N.t(k, p); }

  /**
   * @param {{kind:'win'|'lose'|'draw'|'info', title:string, sub?:string, mood:string, reveal?:{label,value},
   *   lines?:string[], stars?:number, badges?:string[], ranking?:Array<{name,avatar,team,info,me,win}>,
   *   again:{label?,onClick?,disabled?,note?}, room:{onClick?,disabled?,note?}, home:{onClick}}|function} o
   */
  function show(o) {
    builder = typeof o === 'function' ? o : null;
    render(builder ? builder() : o, false);
  }
  function render(o, relang) {
    var K = root.Kit, G = root.GameView;
    var layer = doc.getElementById('result-layer');
    var keepAct = relang && doc.activeElement && layer.contains(doc.activeElement) ? doc.activeElement.getAttribute('data-act') : null;
    if (onKey) doc.removeEventListener('keydown', onKey, true);
    var html = '<div class="result-card" role="dialog" aria-modal="true" aria-labelledby="res-title"><div class="res-main scroll" data-result-share>' +
      '<div class="res-head res-' + o.kind + '">' + G.hostSvg(o.mood, 'res-host') +
      '<div><h2 id="res-title" class="res-title">' + K.esc(o.title) + '</h2>' + (o.sub ? '<p class="res-sub">' + K.esc(o.sub) + '</p>' : '') + '</div></div>';
    if (o.stars != null) {
      html += '<div class="res-stars" role="img" aria-label="' + K.esc(t('res.starsAria', { n: o.stars })) + '">';
      for (var i = 0; i < 3; i++) html += '<i class="' + (i < o.stars ? 'on' : '') + '" style="--d:' + (i * 0.18) + 's">' + K.icon(i < o.stars ? 'star' : 'star-empty') + '</i>';
      html += '</div>';
    }
    if (o.reveal) html += '<div class="res-reveal"><span class="res-label">' + K.icon(o.reveal.icon || 'safe') + K.esc(o.reveal.label) + '</span>' + G.dial(o.reveal.value, 'res-dial') + '</div>';
    if (o.lines && o.lines.length) html += '<ul class="res-lines">' + o.lines.map(function (l) { return '<li>' + K.esc(l) + '</li>'; }).join('') + '</ul>';
    if (o.badges && o.badges.length) html += '<ul class="res-badges">' + o.badges.map(function (b) { return '<li>' + K.icon(b.icon || 'medal') + '<span>' + K.esc(b.text) + '</span></li>'; }).join('') + '</ul>';
    if (o.ranking && o.ranking.length) {
      html += '<ol class="res-ranks">' + o.ranking.map(function (r) {
        return '<li class="' + (r.me ? 'me ' : '') + (r.win ? 'win' : 'lose') + '">' + '<span class="rk-av">' + G.avatar(r.avatar) + G.teamMark(r.team) + '</span>' +
          '<span class="rk-name">' + K.esc(r.name) + '</span><span class="rk-info">' + K.esc(r.info) + '</span>' +
          '<b class="rk-res">' + K.icon(r.win ? 'trophy' : 'mine') + '</b></li>';
      }).join('') + '</ol>';
    }
    html += '</div><div class="res-actions">' +
      btn('again', 'primary', 'refresh', o.again && o.again.label || t('res.again'), o.again) +
      btn('room', '', 'users', t('res.room'), o.room) +
      btn('home', 'ghost', 'home', t('res.home'), o.home) + '</div>';
    html += '</div>';
    layer.innerHTML = html;
    layer.hidden = false;
    doc.body.classList.add('result-open');
    if (!relang) { layer.classList.remove('in'); void layer.offsetWidth; layer.classList.add('in'); }
    ['again', 'room', 'home'].forEach(function (k) {
      var b = layer.querySelector('[data-act="' + k + '"]');
      if (b && o[k] && o[k].onClick && !o[k].disabled) b.addEventListener('click', function () { hide(); o[k].onClick(); });
    });
    var first = keepAct ? layer.querySelector('[data-act="' + keepAct + '"]') : layer.querySelector('.res-actions button:not([disabled])');
    if (first) { if (relang) first.focus({ preventScroll: true }); else setTimeout(function () { if (first.isConnected) first.focus({ preventScroll: true }); }, 60); }
    onKey = function (e) {
      if (layer.hidden) return;
      if (doc.querySelector('.result-share-dialog-layer:not([hidden])')) return;   // 分享圖片視窗自己困住焦點
      if (e.key === 'Tab') {
        var f = Array.prototype.slice.call(layer.querySelectorAll('button:not([disabled])'));
        if (!f.length) return;
        var i = f.indexOf(doc.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    doc.addEventListener('keydown', onKey, true);
    K.refreshScroll();
  }
  function btn(act, kind, ico, label, cfg) {
    var K = root.Kit;
    var dis = !cfg || cfg.disabled || !cfg.onClick;
    var note = cfg && cfg.note ? cfg.note : '';
    return '<button type="button" class="btn ' + kind + '" data-act="' + act + '"' + (dis ? ' disabled aria-disabled="true"' : '') + (note ? ' title="' + K.esc(note) + '"' : '') + '>' +
      K.icon(ico) + '<span>' + K.esc(label) + '</span>' + (dis && note ? '<small class="btn-note">' + K.esc(note) + '</small>' : '') + '</button>';
  }
  function hide() {
    var layer = doc.getElementById('result-layer');
    if (layer.hidden) return;
    layer.hidden = true;
    builder = null;
    doc.body.classList.remove('result-open');
    layer.innerHTML = '';
    if (onKey) doc.removeEventListener('keydown', onKey, true);
    onKey = null;
  }
  function visible() { return !doc.getElementById('result-layer').hidden; }

  if (root.I18N) root.I18N.onChange(function () { if (builder && visible()) render(builder(), true); });

  root.Result = { show: show, hide: hide, visible: visible };
})(typeof self !== 'undefined' ? self : this);
