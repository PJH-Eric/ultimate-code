/* ===== art/host.js — 主持人「保險箱小金」7 種表情（全新角色，手繪向量）=====
 * 蜜桃色圓角保險箱、肚子上一顆金色轉盤、頭頂一顆金色指示燈。
 * idle 待機、think 出題中、low 太小了（往上指）、high 太大了（往下指）、boom 踩中啦、happy 過關／歡呼、sleep 打瞌睡
 */
(function (root) {
  'use strict';
  var INK = '#26405E';
  function defs(k) {
    return '<defs><linearGradient id="h-' + k + '-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFC1B2"/><stop offset="1" stop-color="#FF8E75"/></linearGradient>' +
      '<linearGradient id="h-' + k + '-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE38F"/><stop offset="1" stop-color="#F2B22A"/></linearGradient></defs>';
  }
  /** 共用身體：opt.arms＝兩手的 svg、opt.face＝五官、opt.extra＝特效、opt.tilt＝身體傾斜角度、opt.light＝指示燈顏色 */
  function body(k, opt) {
    var tilt = opt.tilt ? ' transform="rotate(' + opt.tilt + ' 50 88)"' : '';
    return defs(k) +
      '<ellipse cx="50" cy="94" rx="28" ry="4" fill="' + INK + '" opacity=".12"/>' +
      '<g' + tilt + '>' +
      '<rect x="27" y="84" width="12" height="8" rx="3" fill="' + INK + '"/><rect x="61" y="84" width="12" height="8" rx="3" fill="' + INK + '"/>' +
      (opt.armsBack || '') +
      '<path d="M50 20 V12" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="50" cy="10" r="5.5" fill="' + (opt.light || 'url(#h-' + k + '-g)') + '" stroke="' + INK + '" stroke-width="2.5"/>' +
      '<rect x="15" y="19" width="70" height="68" rx="15" fill="url(#h-' + k + '-b)" stroke="' + INK + '" stroke-width="3"/>' +
      '<rect x="12" y="34" width="6" height="11" rx="2" fill="' + INK + '"/><rect x="12" y="62" width="6" height="11" rx="2" fill="' + INK + '"/>' +
      '<rect x="22" y="25" width="56" height="56" rx="11" fill="#FFE2D8" stroke="' + INK + '" stroke-width="2.5"/>' +
      '<ellipse cx="31" cy="31" rx="6" ry="3" transform="rotate(-25 31 31)" fill="#fff" opacity=".7"/>' +
      '<circle cx="50" cy="67" r="10" fill="url(#h-' + k + '-g)" stroke="' + INK + '" stroke-width="2.5"/>' +
      '<path d="M50 58.5 V61.5 M50 72.5 V75.5 M41.5 67 H44.5 M55.5 67 H58.5" stroke="' + INK + '" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M50 67 L' + (opt.dial || '54 62') + '" stroke="' + INK + '" stroke-width="2.5" stroke-linecap="round"/><circle cx="50" cy="67" r="2.2" fill="' + INK + '"/>' +
      '<ellipse cx="31" cy="51" rx="5" ry="3.2" fill="#FF7A63" opacity=".55"/><ellipse cx="69" cy="51" rx="5" ry="3.2" fill="#FF7A63" opacity=".55"/>' +
      opt.face + (opt.arms || '') + '</g>' + (opt.extra || '');
  }
  var eyes = '<circle cx="40" cy="43" r="4.6" fill="' + INK + '"/><circle cx="41.5" cy="41.3" r="1.6" fill="#fff"/><circle cx="60" cy="43" r="4.6" fill="' + INK + '"/><circle cx="61.5" cy="41.3" r="1.6" fill="#fff"/>';
  var armL = '<ellipse cx="11" cy="58" rx="5.5" ry="8" transform="rotate(20 11 58)" fill="#FF9B85" stroke="' + INK + '" stroke-width="2.5"/>';
  var armR = '<ellipse cx="89" cy="58" rx="5.5" ry="8" transform="rotate(-20 89 58)" fill="#FF9B85" stroke="' + INK + '" stroke-width="2.5"/>';
  var line = 'stroke="' + INK + '" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"';

  root.Art.add('host', {
    style: 'cute',
    items: [
      { key: 'idle', n: ['待機', '待机', 'Idle'], tone: 'warm', tag: 'idle', color: '#FF9B85',
        svg: body('idle', { face: eyes + '<path d="M44 51 Q50 56 56 51" ' + line + '/>', arms: armL + armR }) },
      { key: 'think', n: ['出題中', '出题中', 'Thinking'], tone: 'warm', tag: 'think', color: '#FF9B85',
        svg: body('think', { dial: '57 64', face: '<circle cx="42" cy="41" r="4.2" fill="' + INK + '"/><circle cx="62" cy="41" r="4.2" fill="' + INK + '"/><path d="M45 52 H55" ' + line + '/>',
          arms: armR + '<ellipse cx="24" cy="56" rx="5.5" ry="8" transform="rotate(-40 24 56)" fill="#FF9B85" stroke="' + INK + '" stroke-width="2.5"/>',
          extra: '<path d="M80 14 Q80 6 87 6 Q94 6 94 13 Q94 18 89 20 Q87 22 87 26" ' + line + '/><circle cx="87" cy="32" r="2.4" fill="' + INK + '"/>' }) },
      { key: 'low', n: ['太小了', '太小了', 'Too low'], tone: 'warm', tag: 'low', color: '#FF9B85',
        svg: body('low', { dial: '50 58', face: eyes + '<ellipse cx="50" cy="53" rx="4" ry="3.5" fill="' + INK + '"/>',
          arms: armL + '<ellipse cx="88" cy="30" rx="5.5" ry="9" transform="rotate(15 88 30)" fill="#FF9B85" stroke="' + INK + '" stroke-width="2.5"/>',
          extra: '<path d="M90 18 V4 M84 10 L90 3 L96 10" stroke="#3FA98A" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' }) },
      { key: 'high', n: ['太大了', '太大了', 'Too high'], tone: 'warm', tag: 'high', color: '#FF9B85',
        svg: body('high', { dial: '50 76', face: eyes + '<path d="M44 54 Q50 49 56 54" ' + line + '/>',
          arms: armL + '<ellipse cx="90" cy="76" rx="5.5" ry="9" transform="rotate(-15 90 76)" fill="#FF9B85" stroke="' + INK + '" stroke-width="2.5"/>',
          extra: '<path d="M93 84 V98 M87 92 L93 99 L99 92" stroke="#E0584B" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' }) },
      { key: 'boom', n: ['踩中啦', '踩中啦', 'Boom'], tone: 'warm', tag: 'boom', color: '#E0584B',
        svg: body('boom', { tilt: -6, light: '#E0584B', dial: '43 72',
          face: '<path d="M36 39 L44 47 M44 39 L36 47 M56 39 L64 47 M64 39 L56 47" ' + line + '/><ellipse cx="50" cy="54" rx="5" ry="4.5" fill="' + INK + '"/>',
          arms: '<ellipse cx="12" cy="40" rx="5.5" ry="9" transform="rotate(-30 12 40)" fill="#FF9B85" stroke="' + INK + '" stroke-width="2.5"/><ellipse cx="88" cy="40" rx="5.5" ry="9" transform="rotate(30 88 40)" fill="#FF9B85" stroke="' + INK + '" stroke-width="2.5"/>',
          extra: '<path d="M14 10 L20 18 M8 22 L17 23 M86 8 L80 17 M93 20 L84 22" stroke="#E0584B" stroke-width="3" stroke-linecap="round"/><circle cx="74" cy="8" r="4" fill="#FFC94A" stroke="' + INK + '" stroke-width="2"/><circle cx="26" cy="6" r="3" fill="#FFC94A" stroke="' + INK + '" stroke-width="2"/>' }) },
      { key: 'happy', n: ['歡呼', '欢呼', 'Cheer'], tone: 'warm', tag: 'happy', color: '#FF9B85',
        svg: body('happy', { dial: '46 62', face: '<path d="M35 44 Q40 37 45 44" ' + line + '/><path d="M55 44 Q60 37 65 44" ' + line + '/><path d="M43 50 Q50 60 57 50 Z" fill="' + INK + '" stroke="' + INK + '" stroke-width="2.5" stroke-linejoin="round"/>',
          arms: '<ellipse cx="11" cy="36" rx="5.5" ry="9" transform="rotate(-35 11 36)" fill="#FF9B85" stroke="' + INK + '" stroke-width="2.5"/><ellipse cx="89" cy="36" rx="5.5" ry="9" transform="rotate(35 89 36)" fill="#FF9B85" stroke="' + INK + '" stroke-width="2.5"/>',
          extra: '<path d="M84 4 L86 10 L92 12 L86 14 L84 20 L82 14 L76 12 L82 10 Z" fill="#FFC94A" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/><path d="M14 6 L15.5 10 L19.5 11.5 L15.5 13 L14 17 L12.5 13 L8.5 11.5 L12.5 10 Z" fill="#6BCFB0" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>' }) },
      { key: 'sleep', n: ['打瞌睡', '打瞌睡', 'Sleepy'], tone: 'warm', tag: 'sleep', color: '#FF9B85',
        svg: body('sleep', { light: '#C9D3DE', face: '<path d="M35 44 Q40 48 45 44" ' + line + '/><path d="M55 44 Q60 48 65 44" ' + line + '/><path d="M46 53 Q50 55 54 53" ' + line + '/>', arms: armL + armR,
          extra: '<path d="M76 18 H83 L76 26 H83" ' + line + '/><path d="M84 4 H93 L84 14 H93" ' + line + '/>' }) }
    ]
  });
})(typeof self !== 'undefined' ? self : this);
