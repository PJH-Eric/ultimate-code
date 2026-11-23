# 三級備援與重啟回房（Oracle → Render → Cloudflare）

依 `game-lobby/Oracle三級備援實作計畫書.md` 實作本專案程式內的部分。共用路由（`game-lobby/cloudflare/site-backend.js`）屬於 game-lobby repo，**尚未修改**，需要時由 game-lobby 另行加入。

## 本專案已完成

| 項目 | 位置 | 說明 |
| --- | --- | --- |
| 房間快照 | `lib/room-store.js`、`lib/rooms.js` | 設定 `UC_ROOM_DB_PATH` 才啟用（node:sqlite，WAL＋synchronous FULL）。每個改變房間的操作先寫入快照、成功後才送出訊息；寫入失敗就結束程序等待重啟。離開、踢人、撤銷邀請、關房都會寫入，重啟後不會復活。 |
| 啟動復原 | `lib/rooms.js` | 從快照重建 `rooms` 與 `where`，全部標成斷線；從復原完成起算 **120 秒**回房寬限，期間暫停倒數、出題時間與回合計時，也不會因斷線關房。全員回來或寬限到期才結束復原，計時往後順延停機時間。 |
| 回房請求 | `server.js` | `hello` 帶 `resumeRoomId`，伺服器依 `clientId` 認出原玩家並送回房間；房間不存在時回 `resume_fail`。快照在 `listen` 之前載入，`/health` 可用時一定已復原。健康檢查不輸出房間內容與密碼。 |
| 前端固定後端 | `public/js/online.js`、`public/js/modes/online-ui.js` | 同一分頁 `sessionStorage` 記住房號，並呼叫 `GameBackend.rememberRoom()／forgetRoom()`；邀請連結經 `GameBackend.pinInvite()` 加上 `backend=`。重新整理後自動以 `resumeRoomId` 連回，畫面顯示「等待原房間恢復」，重試上限 **3 分鐘**、可取消、可再試一次。只有主動離開、或伺服器確認關房／被踢／房間不存在時才清除。 |
| 共用路由腳本 | `public/index.html` | 載入 `/game-lobby/backend-routing.js`（GitHub Pages 上由 game-lobby 產出；本機 404 不影響）。 |
| Oracle 部署設定 | `deploy/oracle/` | `server.env`、systemd unit、Caddy 片段。 |

## 驗證

- `node tests/rooms.test.js`：快照還原房號／座位／輪次／已確認的猜測、寬限中不逾時不關房、全員回來後計時順延、`resume_fail`、離開與關房不復活、寬限到期零人關房。
- `node scripts/online-flow.cjs`：真的啟動伺服器（SQLite），三個瀏覽器開組隊對局、出題、猜、用道具，重新整理回原座位，**SIGKILL 伺服器停機 55 秒後重啟**，三人回到同一房號、座位與局面，再打完三局並再來一局。

## 上線前還需要（不在本 repo）

1. game-lobby `cloudflare/site-backend.js` 的 `settings` 加入 `'ultimate-code': ['<render 服務名>', '/ws']`，並在 `ORACLE_PILOT_ORIGINS` 加入 Oracle 網址；`scripts/build-pages.js` 的 `oraclePilotGames` 加入 `ultimate-code`。
2. Render：免費服務的本機檔案在休眠或重啟時會消失，需要獨立的持久儲存才能做重啟回房；未完成前 Render 端照現狀（純記憶體）。
3. Cloudflare：需要 Durable Object 版本的房間持久化（`game-lobby/cloudflare/worker.mjs`）。
4. Oracle VM：確認可用埠、網域與記憶體（計畫書門檻：可用記憶體 ≥ 200 MiB）。

目前依使用者指示**只做本機 git，不 push、不部署**。
