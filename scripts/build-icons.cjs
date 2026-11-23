/* ===== scripts/build-icons.cjs — 從 public/favicon.svg 產生 PNG 圖示（開發用，需要 playwright）=====
 * favicon-96.png、apple-touch-icon.png（180，含底色）、icons/icon-192.png、icons/icon-512.png（PWA，含安全邊距）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const pub = path.join(__dirname, '..', 'public');
const svg = fs.readFileSync(path.join(pub, 'favicon.svg'), 'utf8');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  async function render(file, size, pad, bg) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent('<html><body style="margin:0;background:' + (bg || 'transparent') + '"><div style="width:' + size + 'px;height:' + size + 'px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:' + pad + 'px">' + svg.replace('<svg ', '<svg width="100%" height="100%" ') + '</div></body></html>');
    await page.screenshot({ path: path.join(pub, file), omitBackground: !bg });
    console.log('✓ ' + file);
  }
  fs.mkdirSync(path.join(pub, 'icons'), { recursive: true });
  await render('favicon-96.png', 96, 2);
  await render('apple-touch-icon.png', 180, 18, '#FFF4E0');
  await render('icons/icon-192.png', 192, 22, '#FFF4E0');
  await render('icons/icon-512.png', 512, 60, '#FFF4E0');
  /* favicon.ico：16／32／48 三種尺寸，ICO 裡直接放 PNG 資料 */
  const pngs = [];
  for (const s of [16, 32, 48]) {
    await page.setViewportSize({ width: s, height: s });
    await page.setContent('<html><body style="margin:0">' + svg.replace('<svg ', '<svg width="' + s + '" height="' + s + '" ') + '</body></html>');
    pngs.push({ s, buf: await page.screenshot({ omitBackground: true }) });
  }
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach((p, i) => {
    const e = 6 + i * 16;
    head[e] = p.s; head[e + 1] = p.s; head[e + 2] = 0; head[e + 3] = 0;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(p.buf.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += p.buf.length;
  });
  fs.writeFileSync(path.join(pub, 'favicon.ico'), Buffer.concat([head, ...pngs.map(p => p.buf)]));
  console.log('✓ favicon.ico（16/32/48）');
  await browser.close();
})();
