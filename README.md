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

1. **學校資料**：約 483 所全港日間本地中學（教育局「學校位置及資料」開放數據；不含特殊、國際、英基及夜校），含中文校名、分區、類型、地址、電話、網址；可按十八區、類型與民間參考組別篩選。組別僅部分學校有資料，其餘為「未知／不適用」，卡片上以色塊顯示。
2. **升中項目**：執行時讀取 `data/events.json`（開放日、資訊日、報名／放榜等），可按狀態篩選。不連線 Notion、亦不需後端。現有條目多來自前身沙田區清單，並非全港完整日程。
3. **地圖**：Leaflet + OSM；標記隨學校資料篩選同步；各校以彩色中文縮寫徽章標記（favicon 成功載入時疊上校徽），滑鼠移上／輕觸顯示校名。
4. **距離工具**：在地圖上點選一點，依直線距離由近至遠列出目前篩選下的學校（預設顯示最近 40 所）；選點以紅色圖釘標示。

## 如何新增／修改升中項目

只改 **`data/events.json`**（單一資料來源）。根物件含 `title`、`timezone`（`Asia/Hong_Kong`）、可選 `syncedAt`／`source`（上次手動匯出的時間與來源連結）、`schema`（欄位說明）與 `events` 陣列。在 `events` 加一筆或改現有欄位後，重新整理頁面即可。

內容可自 Notion 或其他來源手動覆寫本檔；**站內不連線 Notion API**，亦無自動同步。

| 欄位 | 說明 |
| --- | --- |
| `id` | 唯一字串，例如 `ev-10` |
| `title` | 標題 |
| `type` | 類型徽章，現有值：`開放日`、`資訊日`、`報名／申請`、`放榜／結果`、`註冊` |
| `status` | 須與篩選按鈕完全一致：`官方確認`、`暫定（坊間）`、`已過` |
| `schools` | 校名陣列；教育局／全港項目用 `[]` |
| `isDateTime` | `true`：開始／結束為 **ISO 8601 UTC**（結尾 `Z`），畫面轉香港時間（UTC+8）顯示。`false`：僅 **日曆日** `YYYY-MM-DD`，以香港日期解讀（不含時刻） |
| `dateStart` | 必填 |
| `dateEnd` | 可選／`null` |
| `keyDateStart` / `keyDateIsDateTime` / `keyPoints` | 可選關鍵節點（截止、派票等） |
| `notes` | 說明 |
| `sourceUrl` | 來源網址 |

香港時間注意：有時刻的活動請把本地時間換成 UTC 再寫入。例如香港 2026-11-14 12:00 寫成 `2026-11-14T04:00:00.000Z`。純日期勿加 `Z`，用 `2027-01-04`。

## 資料與授權

- 學校聯絡／地址／分區／座標：教育局「學校位置及資料」開放數據（data.gov.hk）。
- 升中事件：`data/events.json` 靜態內容；請以學校／教育局官網核實。
- 地圖圖磚：© OpenStreetMap contributors。
- 「民間參考組別」非官方評級，僅供參考；未有可靠來源的學校不填寫組別。
