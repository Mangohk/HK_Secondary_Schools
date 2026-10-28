# `scan-state.json`（掃描狀態）

寫給維護掃描結果的人。與 `events.json` 同在 `data/`。頁面不讀這個檔；升中項目仍只讀 `events.json`。

改 `events.json` 的同一個 commit 還要 append `changelog.json`（「更新記錄」分頁讀這個檔）：一筆變更一列，欄位含 `loggedAt`（香港日）、`changeKind`、`eventId`、`eventType`、`title`、`summary`、`schools`、`schoolIds`、`districts`、`source`。不要用一行週次摘要代替逐筆記錄。

某區或某校掃完並合併事件後，更新這裡對應的條目，並把根欄位 `updatedAt` 設成當時的 ISO 8601 UTC（結尾 `Z`）。

## 欄位

- `districts.<區名>`：`lastScannedAt`、`lastStatus`（`ok` 或 `error`）。失敗時加上 `lastError`；成功則省略。
- `schools.<校名>`：同上，並加 `district`（與 `districts` 的區名相同）。沒有逐校掃描紀錄時保持 `{}`。
- `rotation.lastDistrictBatch`、`rotation.lastRotatedAt`：輪替尚未跑過時為 `null`。
- `lightScan.lastRanAt`、`lightScan.lastStatus`：輕量掃描尚未跑過時為 `null`。

區名用掃描批次的短名（`沙田`、`九龍城`、`觀塘`），與學校資料裡的 `沙田區` 顯示名分開。還沒掃過的區不要建鍵。

## 2026-10-14 已記入

`lastScannedAt` 用該次合併寫進 `events.json` 的 `syncedAt`：

| 區 | lastScannedAt | 合併 |
| --- | --- | --- |
| 沙田 | 2026-10-14T02:51:39Z | #55 |
| 九龍城 | 2026-10-14T03:04:06Z | #56 |
| 觀塘 | 2026-10-14T03:10:30Z | #57 |

三區 `lastStatus` 都是 `ok`。`schools` 留空：批次只列出有改動的事件，不能當成完整的逐校掃描名單。
