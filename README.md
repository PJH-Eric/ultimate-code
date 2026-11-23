# 終極密碼（ultimate-code）

猜數字的經典派對遊戲，踩中的人輸。

- **一般模式（範圍縮小）**：密碼藏在 1～100，每猜一次範圍就縮小，猜中密碼的人輸。
- **累加模式（+1／+2／+3）**：從 0 開始輪流加 1～3，報到 100 的人輸。
- 道具：跳過／迴轉／指定（每人各 1 個）。
- 單人挑戰（破解、踩點）＋線上多人（紅藍組隊、輪流出題、觀戰、邀請連結、聊天室）。
- 繁體中文／简体中文／English。

完整規則與設計見 [規劃書.md](規劃書.md)。

## 本機啟動

需要 Node.js 26.12.1 以上，零依賴、不需要 `npm install`。

```bash
npm start            # http://localhost:3110
```

Windows 可直接雙擊 `啟動遊戲.bat`。

## 測試

```bash
npm test             # 規則單元測試、大廳聊天、線上端對端
```

## 部署

- 前端：GitHub Pages（`.github/workflows/pages.yml`），repo Variables 設 `GAME_SERVER_URL`。
- 後端：Render（`render.yaml`，region singapore），環境變數 `GAME_ALLOWED_ORIGIN` 填 Pages 網址。
- 伺服器網址只從 `public/js/config.js` 讀取（建置時由 `scripts/inject-server-url.js` 注入）。

目前只做本機 git，尚未 push 與部署。
