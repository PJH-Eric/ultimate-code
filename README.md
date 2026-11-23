# 終極密碼（ultimate-code）

猜數字的經典派對遊戲，踩中的人輸。

- **一般模式（範圍縮小）**：密碼藏在 1～100，每猜一次範圍就縮小，猜中密碼的人輸。
- **累加模式（+1／+2／+3）**：從 0 開始輪流加 1～3，報到 100 的人輸。
- **道具**：跳過／迴轉／指定（每人各 1 個，用完就沒）。
- **單人挑戰**：破解（猜中過關、7 次內 3 星）、踩點（剛好走到 100、避開 5 顆地雷）。
- **線上**：2～8 人、紅藍組隊、隊友輪流出題、1／3／5 局、觀戰、邀請連結（可選玩家／觀戰、可用手機分享）、再來一局投票、房間與大廳聊天室。
- 繁體中文／简体中文／English；手機、平板、桌機直橫向。

完整規則與設計見 [規劃書.md](規劃書.md)，備援說明見 [docs/failover.md](docs/failover.md)。

## 本機啟動

需要 Node.js 26.12.1 以上，零依賴、不需要 `npm install`。

```bash
npm start            # http://localhost:3110
```

Windows 可直接雙擊 `啟動遊戲.bat`。

## 測試

```bash
npm test             # 規則、SEO、房間邏輯、大廳聊天、線上端對端
```

開發用（需要 playwright，例如 `NODE_PATH` 指向已安裝的 node_modules）：

| 指令 | 用途 |
| --- | --- |
| `node scripts/flow-check.cjs` | 單人完整一局、再來一局、分享圖片、鍵盤輸入、首頁與單人不連線 |
| `node scripts/online-flow.cjs` | 三個瀏覽器實際點選：開房、邀請、選隊、出題、猜、道具、重新整理回房、伺服器重啟回房、打完三局、再來一局投票 |
| `node scripts/rwd-audit.cjs <輪次>` | 全畫面 × 6 種裝置 × 3 語系巡檢與截圖（`tmp/audit/`） |
| `node scripts/cloudflare-check.mjs` | 用 game-lobby 的 build.cjs 打包並在 Cloudflare 轉接層打完一局 |
| `node scripts/build-icons.cjs`、`npm run build:art` | 由向量美術產生圖示、SEO 分享圖與 cover |

## 部署

- **前端**：GitHub Pages（`.github/workflows/pages.yml`）。repo Variables 設 `GAME_SERVER_URL`（Render 網址）；部署時注入伺服器網址、GA4 與 SEO（`seo.config.json`）。GA4 只在 `pjh-eric.github.io` 載入。
- **後端**：Render（`render.yaml`，region singapore），環境變數 `GAME_ALLOWED_ORIGIN` 填 Pages 網址。
- **備援**：Render 連不上時改連 Cloudflare（game-lobby 的共用路由與 Durable Object）。
- 伺服器網址只從 `public/js/config.js` 讀取。

目前只做本機 git，尚未 push 與部署。
