# 香港升中資訊網 (HK_Secondary_Schools)

全港日間本地中學公開資料、Leaflet / OpenStreetMap 地圖標記，以及點擊地圖量測直線距離（Haversine）。

本專案由 [Mangohk/shatin-sec-school](https://github.com/Mangohk/shatin-sec-school)（沙田區中學 · 資料與地圖）複製起步，學校名單已擴至教育局開放數據覆蓋的全港日間中學。

## 如何開啟

無需建置、無需地圖 API 金鑰。

**建議用 HTTP 開啟**（GitHub Pages 或本機靜態伺服器），因為「升中項目」會在執行時 `fetch('data/events.json')`。直接雙擊 `index.html`（`file://`）時，瀏覽器通常無法讀取本地 JSON，該分頁會顯示錯誤說明，學校名單仍可從內嵌 `data/schools-data.js` 顯示。

本機範例：

```bash
python3 -m http.server 8080
# 然後開啟 http://127.0.0.1:8080/
```

地圖圖磚與學校 favicon 仍需網路連線。

## Site

https://mangohk.github.io/HK_Secondary_Schools/

## 功能

1. **學校資料**：約 483 所全港日間本地中學（教育局「學校位置及資料」開放數據；不含特殊、國際、英基及夜校），含中文校名、三位短編號（`seq`）、分區、類型、地址、電話、網址；可按十八區、類型與民間參考組別篩選，亦可按編號排序。組別多數來自 [大考 BigExam](https://dse.bigexam.hk/zh-hk/ssp) 的民間估算（非教育局官方），其餘為「未知／不適用」，卡片上以色塊顯示。可按「關注」標記學校，並用「只看關注」收窄清單。
2. **升中項目**：執行時讀取 `data/events.json`（開放日、資訊日、報名／放榜等），可按狀態（全部、官方確認、暫定）篩選。已過項目預設隱藏，清單頂端可展開，並按開始日期排。不連線 Notion、亦不需後端。現有條目多來自前身沙田區清單，並非全港完整日程。
3. **更新記錄**：執行時讀取 `data/changelog.json`。這是資料變更日誌（新／更新／刪除），不是活動日曆。篩選（近 7 日／近 30 日／全部、分區、學校、變更性質、項目類型）只作用於本分頁，預設近 30 日。
4. **地圖**：Leaflet + OSM；標記隨學校資料篩選同步；各校以彩色中文縮寫徽章標記（favicon 成功載入時疊上校徽），滑鼠移上／輕觸顯示校名。
5. **距離工具**：在地圖上點選一點，依直線距離由近至遠列出目前篩選下的學校（預設顯示最近 40 所）；選點以紅色圖釘標示。
6. **登入與偏好（可選）**：訪客可直接使用。若已設定 Firebase，可用 **Google 登入**；已登入時會把分區／類型／民間組別／「顯示教育局／全港項目」／「顯示已過升中項目」（`showPast`）與關注學校（`nameZh`）同步到 Firestore，跨裝置還原。帳戶裡已有的 `showPast`（或舊欄 `hidePast`）會跟從雲端，登入時不會覆蓋。搜尋字詞只留在本機工作階段，不入帳戶。

## Firebase 登入設定（維護者）

本站以 GitHub Pages 靜態託管，Auth／Firestore 全在瀏覽器端。**切勿**把 Admin SDK 或 service account 金鑰提交到本 repo。

1. 在 [Firebase Console](https://console.firebase.google.com/) 建立專案。
2. 啟用 **Authentication → Sign-in method → Google**。
3. **Authentication → Settings → Authorized domains** 加入：
   - `mangohk.github.io`（正式站）
   - `localhost`（本機 HTTP 測試）
4. 建立 **Firestore** 資料庫；用 repo 根目錄的 [`firestore.rules`](./firestore.rules) 部署規則（`users/{uid}` 僅本人讀寫）。
5. 新增 Web app，複製設定到 [`js/firebase-config.js`](./js/firebase-config.js)（取代 `YOUR_*` placeholder）。`apiKey` 等屬公開 web config，靠 Security Rules 保護資料。
6. 正式站路徑為 `/HK_Secondary_Schools/`。建議用 **popup** Google 登入（已實作）；若改 redirect，須確認回傳 URL 與 authorized domains 正確。

未填妥 config 時，頁首會顯示「登入未設定」，站點仍以訪客模式運作（關注／篩選只在記憶體，重整即失；v1 不寫 `localStorage`）。

## 如何新增／修改升中項目

只改 **`data/events.json`**（單一資料來源）。根物件含 `title`、`timezone`（`Asia/Hong_Kong`）、可選 `syncedAt`／`source`（上次手動匯出的時間與來源連結）、`schema`（欄位說明）與 `events` 陣列。在 `events` 加一筆或改現有欄位後，重新整理頁面即可。

同一 commit 必須 append **`data/changelog.json`** 的 `entries`：每個有變動的 `eventId` 一列（`changeKind` 為 `added`、`updated` 或 `removed`），不要只寫一行「本週 N 項」。`loggedAt` 用合併日的香港日（`YYYY-MM-DD`）。`source` 為 `weekly-scan`、`manual` 或 `backfill`。

內容可自 Notion 或其他來源手動覆寫本檔；**站內不連線 Notion API**，亦無自動同步。

| 欄位 | 說明 |
| --- | --- |
| `id` | 唯一字串，例如 `ev-10` |
| `title` | 標題 |
| `type` | 類型徽章，現有值：`開放日`、`資訊日`、`報名／申請`、`放榜／結果`、`註冊` |
| `status` | `官方確認`、`暫定（坊間）`、`已過`。清單狀態按鈕只剩全部、官方確認、暫定；`已過` 仍寫在資料裡，畫面預設收起 |
| `schools` | 校名陣列；教育局／全港項目用 `[]` |
| `isDateTime` | `true`：開始／結束為 **ISO 8601 UTC**（結尾 `Z`），畫面轉香港時間（UTC+8）顯示。`false`：僅 **日曆日** `YYYY-MM-DD`，以香港日期解讀（不含時刻） |
| `dateStart` | 必填 |
| `dateEnd` | 可選／`null` |
| `keyDateStart` / `keyDateIsDateTime` / `keyPoints` | 可選關鍵節點（截止、派票等） |
| `keyDateKind` | 可選。`ticket-open`（索票／登記開始）、`deadline`（截止）、`other`（其他）。缺省視為 `other` |
| `notes` | 說明 |
| `sourceUrl` | 來源網址 |

香港時間注意：有時刻的活動請把本地時間換成 UTC 再寫入。例如香港 2026-11-14 12:00 寫成 `2026-11-14T04:00:00.000Z`。純日期勿加 `Z`，用 `2027-01-04`。

### 登記關鍵日（`keyDateKind`）

頁面只在記憶體派生「登記」虛擬項目，**不會寫回** `events.json`。條件要三個同時成立：

1. `keyDateKind` 是 `ticket-open`
2. `keyDateStart` 有值
3. `keyDateStart` 的香港日與 `dateStart` 的香港日不同

缺省或任何其他值（包括 `deadline`、`other`）都不會派生。同一香港日的派票（例如活動當日現場派票）不要標 `ticket-open`。

只在關鍵日**確實是索票或登記開始**時才標 `ticket-open`。截止、確認電郵、活動當日派票、詳情未定的預告，都不要標。

**覆寫或更新現有項目時必須保留已有的 `keyDateKind`。** 不要在同步時清掉或改回未標，除非該關鍵日已不再是索票／登記開始。其他欄位照常更新時，這個欄位原樣留下。

## 學校短編號（seq）

每所學校有一個三位、補零的短編號 `seq`（例如 `017`）。學校資料清單、升中項目的學校選單，以及我的關注會在校名前面顯示這個編號。內部對應仍用教育局 12 位 `id`。升中項目的 `schools` 校名，以及 Firestore 關注清單的校名，都維持原樣。

初始編號跟 `js/app.js` 的 `DISTRICT_ORDER`（十八區，港島 → 九龍 → 新界）。同一區內先按類型（官立、資助、直資、私立），再按中文校名（`zh-Hant`）。由 `001` 連續編，每區之後預留 8 個空號。若某區放不進 `001`–`899`，多出的學校用 `900` 起的溢位號。學校日後轉區仍保留原編號。

地圖標記、距離清單，以及學校卡片裡的地址／電話詳情暫不顯示編號。搜尋欄輸入 1 至 3 位純數字時按編號篩選：`17` 與 `017` 都對到 `017`，編號中含有所輸入數字的學校也會出現。較長的數字（例如電話）仍走原本的文字搜尋。清單排序可在「按分區」與「按編號」之間切換。

這次 483 所全部分在 `001`–`619`。區後預留是空號。`900` 起的溢位號留作日後某區超出 `899` 時使用。

| 分區 | 學校數目 | 首個 seq | 最後 seq | 區後預留 |
| --- | ---: | --- | --- | --- |
| 中西區 | 12 | 001 | 012 | 013–020 |
| 灣仔區 | 17 | 021 | 037 | 038–045 |
| 東區 | 32 | 046 | 077 | 078–085 |
| 南區 | 18 | 086 | 103 | 104–111 |
| 油尖旺區 | 25 | 112 | 136 | 137–144 |
| 深水埗區 | 28 | 145 | 172 | 173–180 |
| 九龍城區 | 41 | 181 | 221 | 222–229 |
| 黃大仙區 | 24 | 230 | 253 | 254–261 |
| 觀塘區 | 35 | 262 | 296 | 297–304 |
| 葵青區 | 31 | 305 | 335 | 336–343 |
| 荃灣區 | 15 | 344 | 358 | 359–366 |
| 屯門區 | 37 | 367 | 403 | 404–411 |
| 元朗區 | 41 | 412 | 452 | 453–460 |
| 北區 | 20 | 461 | 480 | 481–488 |
| 大埔區 | 22 | 489 | 510 | 511–518 |
| 沙田區 | 46 | 519 | 564 | 565–572 |
| 西貢區 | 28 | 573 | 600 | 601–608 |
| 離島區 | 11 | 609 | 619 | 620–627 |

## 資料與授權

- 學校聯絡／地址／分區／座標：教育局「學校位置及資料」開放數據（data.gov.hk）。
- 升中事件：`data/events.json` 靜態內容；請以學校／教育局官網核實。
- 地圖圖磚：© OpenStreetMap contributors。
- 「民間參考組別」：主要來自 [大考 BigExam 中學組別及教學語言](https://dse.bigexam.hk/zh-hk/ssp) 的第三方估算（依公開文憑試表現等），**並非教育局官方評級**，僅供參考；未能可靠對應的學校不填寫組別。
