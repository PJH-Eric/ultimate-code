# 線上備援：Render → Cloudflare

新連線先連 **Render**（主機），Render 連不上時改連 **Cloudflare**（game-lobby 的 Durable Object 備援）。Oracle 依指示**先不使用**。

## 運作方式

| 環節 | 位置 | 說明 |
| --- | --- | --- |
| 選擇後端 | game-lobby `cloudflare/site-backend.js`（GitHub Pages 上的 `/game-lobby/backend-routing.js`） | 本遊戲頁面載入這支共用腳本，`Net` 透過 `GameBackend.select()`／`createSocket()` 依序探測 Render、Cloudflare。設定：`'ultimate-code': ['ultimate-code-sg', '/ws']`（Render 服務名 `ultimate-code-sg`；`ultimate-code.onrender.com` 已被他人使用，Cloudflare worker 預設 `ultimate-code-backup`）。 |
| Cloudflare 後端 | game-lobby `cloudflare/build.cjs`＋`games.cjs` | 把本專案的 `server.js` 原樣包進 Durable Object。`server.js` 偵測外層傳入的 `runtime`，改用它的 ws／計時器／房間儲存，game-lobby 不需要為本遊戲寫特例。設定：`'ultimate-code': { path: '/ws', maxPayload: 8192 }`。 |
| 房間固定後端 | `public/js/modes/online-ui.js` | 進房後 `GameBackend.rememberRoom()` 記住這間房在哪個後端；重新整理、斷線重連都連回同一個後端。邀請連結經 `GameBackend.pinInvite()` 帶 `backend=`，受邀者也進到同一個後端。離開或房間結束時 `forgetRoom()`。 |
| 回房 | `server.js`、`public/js/online.js` | 同一分頁記住房號，重連時 `hello` 帶 `resumeRoomId`；伺服器依 `clientId` 認出原玩家送回原座位，房間不存在回 `resume_fail`。斷線 30 秒內保留座位；切回分頁或網路恢復時立即重連。 |

## 已驗證

- `node scripts/cloudflare-check.mjs`：用 game-lobby 的 `build.cjs` 實際打包本遊戲（45 KB、不含 `node:sqlite`），再用它的 `runtime.mjs` 轉接層連兩位玩家打完一局、`/health` 正常、再來一局投票可用。
- game-lobby `node --test cloudflare/backend-router.test.cjs`：14/14 通過（加入本遊戲設定後）。

## 限制

- Render 免費方案與 Cloudflare 目前都是**記憶體內房間**：該後端重新啟動或休眠時房間會消失（玩家會收到「原房間已不存在」並回到大廳）。`lib/room-store.js`（SQLite）保留給日後有持久磁碟的主機；Cloudflare 若要保存房間，需在 game-lobby `worker.mjs` 為本遊戲提供 `runtime.roomStore`（guess-ab 已有同樣做法，本專案的 `server.js` 會自動使用）。
- 已經在 Render 進行中的房間不會搬到 Cloudflare；Render 掛掉時，新開的房間才會在 Cloudflare。

## 部署狀態

- **Cloudflare 備援已上線**：https://ultimate-code-backup.eric-games.workers.dev（實測 /health、WebSocket 建房、非允許來源 403、累加地雷規則）。
- **結構與其他 14 款遊戲相同**（2026-11-23 比對後調整）：repo 自帶 `cloudflare/`（含 `build-worker.cjs`，從 stair-kids 複製並登錄 ultimate-code），根目錄 `wrangler.toml`（Durable Object `LOBBY`、observability logs／traces）。已移除自寫的 GitHub Actions Worker 部署（缺 token 時只顯示綠燈、實際沒部署）。
- **自動部署（Cloudflare Workers Builds，需在 Cloudflare 頁面連一次 Git）**：Workers & Pages → ultimate-code-backup → Settings → Build → Connect → GitHub `PJH-Eric/ultimate-code`，分支 main，根目錄 `/`。
  - Build command：`cd cloudflare && npm ci && node build-worker.cjs`
  - Deploy command：`npx wrangler deploy`
  - 其他遊戲的實際指令存在 Cloudflare 頁面裡（wrangler 的登入授權沒有讀取 Workers Builds 的權限）；上面兩行已在本機用同樣方式驗證：打包 45 KB、`wrangler deploy --dry-run` 綁定 LOBBY 正確。
- **手動部署**：`cd cloudflare && npm ci && node build-worker.cjs`，回到根目錄再 `wrangler deploy`。
- **Render**：workspace 免費額度用完，`ultimate-code-sg` 尚未建立；前端 GAME_SERVER_URL 指向 Cloudflare Worker。
