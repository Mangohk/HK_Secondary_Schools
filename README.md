# 香港升中資訊網 (HK_Secondary_Schools)

本專案由 [Mangohk/shatin-sec-school](https://github.com/Mangohk/shatin-sec-school)（沙田區中學 · 資料與地圖）複製起步。


靜態網頁：列出沙田區中學公開資料、Leaflet / OpenStreetMap 地圖標記，以及點擊地圖量測直線距離（Haversine）。

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
https://mangohk.github.io/shatin-sec-school/

## 功能

1. **學校資料**：45 所沙田區中學（教育局／中學概覽公開名單），含中文校名、類型、地址、電話、網址；每校有明確民間參考組別（Band 1／2／3 或未知／不適用），可篩選，卡片上以色塊顯示。
2. **升中項目**：執行時讀取 `data/events.json`（開放日、資訊日、報名／放榜等），可按狀態篩選。不連線 Notion、亦不需後端。
3. **地圖**：Leaflet + OSM；各校以彩色中文縮寫徽章標記（favicon 成功載入時疊上校徽），滑鼠移上／輕觸顯示校名。
4. **距離工具**：在地圖上點選一點，依直線距離由近至遠列出所有學校；選點以紅色圖釘標示。

## 如何新增／修改升中項目

只改 **`data/events.json`**（單一資料來源）。根物件含 `title`、`timezone`（`Asia/Hong_Kong`）、可選 `syncedAt`／`source`（上次從 Notion 手動匯出的時間與資料庫連結）、`schema`（欄位說明）與 `events` 陣列。在 `events` 加一筆或改現有欄位後，重新整理頁面即可。

內容可自 Notion「沙田升中事件清單」手動覆寫本檔；**站內不連線 Notion API**，亦無自動同步。

| 欄位 | 說明 |
| --- | --- |
| `id` | 唯一字串，例如 `ev-10` |
| `title` | 標題 |
| `type` | 類型徽章，現有值：`開放日`、`資訊日`、`報名／申請`、`放榜／結果`、`註冊` |
| `status` | 須與篩選按鈕完全一致：`官方確認`、`暫定（坊間）`、`已過` |
| `schools` | 校名陣列；教育局／全區項目用 `[]` |
| `isDateTime` | `true`：開始／結束為 **ISO 8601 UTC**（結尾 `Z`），畫面轉香港時間（UTC+8）顯示。`false`：僅 **日曆日** `YYYY-MM-DD`，以香港日期解讀（不含時刻） |
| `dateStart` | 必填 |
| `dateEnd` | 可選／`null` |
| `keyDateStart` / `keyDateIsDateTime` / `keyPoints` | 可選關鍵節點（截止、派票等） |
| `notes` | 說明 |
| `sourceUrl` | 來源網址 |

香港時間注意：有時刻的活動請把本地時間換成 UTC 再寫入。例如香港 2026-11-14 12:00 寫成 `2026-11-14T04:00:00.000Z`。純日期勿加 `Z`，用 `2027-01-04`。

## 資料與授權

- 學校聯絡／地址：教育局分區學校名單、中學學位分配辦法沙田區公開手冊等。
- 升中事件：`data/events.json` 靜態內容；請以學校／教育局官網核實。
- 座標：OpenStreetMap / Photon（鄰里層級）；個別地址以公開校址微調。
- 地圖圖磚：© OpenStreetMap contributors。
- 「民間參考組別」非官方評級，僅供參考。
