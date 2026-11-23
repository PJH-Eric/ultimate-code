/* ===== tests/seo.test.js — SEO／GA4 設定與分享圖檢查（不改原始檔，注入在暫存複本上做）===== */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { inject } = require('../scripts/inject-seo.js');
const root = path.join(__dirname, '..');

const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
assert.strictEqual(html.split('<!--SEO:HEAD-->').length, 2, 'index.html 要有一個 SEO 標記');
assert.ok(/<script src="js\/analytics\.js"><\/script>/.test(html), '載入 analytics.js');
for (const f of ['favicon.svg', 'favicon.ico', 'favicon-96.png', 'apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'manifest.webmanifest', 'robots.txt', 'assets/images/seo.webp', 'assets/images/cover.webp']) {
  assert.ok(fs.existsSync(path.join(root, 'public', f)), '缺少 ' + f);
}
function webp(file) { const b = fs.readFileSync(file); assert.strictEqual(b.toString('ascii', 8, 12), 'WEBP'); const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
assert.deepStrictEqual(webp(path.join(root, 'public/assets/images/seo.webp')), [1200, 630], 'SEO 圖 1200×630');
assert.deepStrictEqual(webp(path.join(root, 'public/assets/images/cover.webp')), [1200, 675], 'cover 1200×675');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-seo-'));
try {
  fs.mkdirSync(path.join(tmp, 'public', 'assets', 'images'), { recursive: true });
  fs.copyFileSync(path.join(root, 'seo.config.json'), path.join(tmp, 'seo.config.json'));
  fs.copyFileSync(path.join(root, 'public', 'index.html'), path.join(tmp, 'public', 'index.html'));
  fs.copyFileSync(path.join(root, 'public/assets/images/seo.webp'), path.join(tmp, 'public/assets/images/seo.webp'));
  const cfg = inject(tmp, {});
  inject(tmp, {});                                    // 重複注入不會累積標籤
  const out = fs.readFileSync(path.join(tmp, 'public', 'index.html'), 'utf8');
  assert.strictEqual(out.split('og:image"').length, 2, '重複注入只有一組 og:image');
  assert.ok(out.includes('"game_id":"ultimate-code"'));
  assert.ok(out.includes('<link rel="canonical" href="https://pjh-eric.github.io/ultimate-code/">'));
  assert.ok(out.includes('og:image:height" content="630"'));
  /* i18n 的標題要和 SEO 標題一致，JS 執行後才不會改回別的文案 */
  global.self = global; const d = {}; global.I18N = { add(l, t) { d[l] = Object.assign(d[l] || {}, t); } };
  require('../public/js/locales.js');
  assert.strictEqual(d['zh-Hant']['doc.title'], cfg.title);
  assert.strictEqual(d['zh-Hant']['doc.desc'], cfg.description);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('SEO 檢查通過');
