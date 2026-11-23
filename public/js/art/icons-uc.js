/* ===== art/icons-uc.js — 終極密碼新增的介面圖示（currentColor，接在 icons.js 後面）=====
 * 道具（跳過／迴轉／指定）、地雷、隊伍形狀（紅隊三角、藍隊方塊）、太小／太大箭頭、數字鍵盤、保險箱。
 */
(function (root) {
  'use strict';
  var set = root.Art.get('icons');
  var S = '<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">';
  function it(key, n, body) { return { key: key, n: n, tone: 'cool', tag: key, color: '#26405E', svg: body }; }
  set.items.push(
    it('skip', ['跳過', '跳过', 'Skip'], S + '<path d="M16 24 L46 50 L16 76 Z"/><path d="M50 24 L80 50 L50 76 Z"/><path d="M88 22 V78"/></g>'),
    it('reverse', ['迴轉', '回转', 'Reverse'], S + '<path d="M22 44 A30 30 0 0 1 78 34"/><path d="M80 14 L80 36 L58 36"/><path d="M78 56 A30 30 0 0 1 22 66"/><path d="M20 86 L20 64 L42 64"/></g>'),
    it('assign', ['指定', '指定', 'Assign'], S + '<circle cx="50" cy="50" r="32"/><circle cx="50" cy="50" r="13"/><path d="M50 6 V22 M50 78 V94 M6 50 H22 M78 50 H94"/></g>'),
    it('mine', ['地雷', '地雷', 'Mine'], S + '<circle cx="46" cy="58" r="26" fill="currentColor"/><path d="M62 38 L72 28"/><path d="M72 28 Q82 18 88 26"/><path d="M84 10 L86 16 M92 16 L86 18 M90 6 L88 12"/></g>' + '<circle cx="37" cy="50" r="6" fill="#fff"/>'),
    it('team-red', ['紅隊', '红队', 'Red team'], '<path d="M50 12 L90 84 H10 Z" fill="currentColor" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/>'),
    it('team-blue', ['藍隊', '蓝队', 'Blue team'], '<rect x="14" y="14" width="72" height="72" rx="10" fill="currentColor"/>'),
    it('up', ['太小', '太小', 'Too low'], S + '<path d="M50 86 V16 M22 42 L50 14 L78 42"/></g>'),
    it('down', ['太大', '太大', 'Too high'], S + '<path d="M50 14 V84 M22 58 L50 86 L78 58"/></g>'),
    it('keypad', ['數字鍵盤', '数字键盘', 'Keypad'], S + '<rect x="12" y="10" width="20" height="20" rx="5"/><rect x="40" y="10" width="20" height="20" rx="5"/><rect x="68" y="10" width="20" height="20" rx="5"/><rect x="12" y="40" width="20" height="20" rx="5"/><rect x="40" y="40" width="20" height="20" rx="5"/><rect x="68" y="40" width="20" height="20" rx="5"/><rect x="40" y="70" width="20" height="20" rx="5"/></g>'),
    it('safe', ['保險箱', '保险箱', 'Safe'], S + '<rect x="12" y="14" width="76" height="66" rx="12"/><circle cx="50" cy="47" r="17"/><path d="M50 30 V36 M50 58 V64 M33 47 H39 M61 47 H67"/><path d="M24 80 V88 M76 80 V88"/></g>'),
    it('target', ['目標', '目标', 'Goal'], S + '<path d="M26 90 V12"/><path d="M26 14 H80 L68 30 L80 46 H26"/></g>'),
    it('arrow-right', ['順時針', '顺时针', 'Forward'], S + '<path d="M14 50 H82 M58 26 L84 50 L58 74"/></g>'),
    it('arrow-left', ['逆時針', '逆时针', 'Backward'], S + '<path d="M86 50 H18 M42 26 L16 50 L42 74"/></g>'),
    it('medal', ['成就', '成就', 'Achievement'], S + '<path d="M34 10 L42 40 M66 10 L58 40"/><circle cx="50" cy="62" r="26"/><path d="M50 48 L54 58 L65 59 L57 66 L59 77 L50 71 L41 77 L43 66 L35 59 L46 58 Z" fill="currentColor" stroke-width="3"/></g>'),
    it('history', ['紀錄', '记录', 'History'], S + '<circle cx="54" cy="50" r="34"/><path d="M54 30 V50 L68 60"/><path d="M8 40 L20 52 L30 38"/></g>')
  );
})(typeof self !== 'undefined' ? self : this);
