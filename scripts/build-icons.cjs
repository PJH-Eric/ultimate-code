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
  await browser.close();
})();
