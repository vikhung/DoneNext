對所有 *.js 進行靜態安全分析，並評估 Node.js v18 現代化改善空間。

---
name: code-security
description: 當使用者要求安全審查、code review 的安全面向、或提交前進行靜態分析時使用。
---


## A. 安全弱點掃描

用 Read 工具讀取以下檔案完整內容後再分析，不根據記憶判斷：
`server.js`、`lib/router.js`、`lib/todoStore.js`、`lib/userStore.js`、`lib/typeStore.js`、`lib/logger.js`、`public/app.js`

只回報信心度 >80%、有實際可利用路徑的問題：

1. **XSS（前端 HTML 生成）**：`public/app.js` 將任務資料（task、assignedTo、description、status 等欄位）注入 HTML 時，確認每個欄位都經過 `esc()` 轉義（需涵蓋 `&`、`<`、`>`、`"`、`'` 五個字元）。特別檢查 `taskHtml()`、`renderUserList()`、`renderTypeList()`、`doSearch()` 中的每個 template literal 插值。

2. **Path Traversal（靜態檔案伺服）**：`server.js` 的 `serveStatic()` 以 URL path 組成本機檔案路徑；確認是否有以 `path.resolve()` 加上 `startsWith(PUBLIC_DIR)` 檢查防止目錄穿越（如 `../../etc/passwd`）。

3. **Prototype Pollution（JSON 解析）**：`lib/todoStore.js`、`lib/userStore.js`、`lib/typeStore.js` 以 `JSON.parse` 讀取 data 檔案後，確認是否只透過固定屬性名稱存取，`update()` 中的 patch 合併有無以外部 key 動態設定物件屬性（如 `obj[userInputKey] = value`）。

4. **輸入驗證**：`lib/router.js` 對 POST body 的驗證是否完整：
   - `POST /api/todos`：`task` 必填、其餘欄位是否有長度或型別限制
   - `POST /api/users`：`name` 必填且 trim 後非空
   - `POST /api/types`：`name` 必填且 trim 後非空

5. **MIME Sniffing**：`server.js` 回傳靜態檔案時是否為每種副檔名設定明確的 `Content-Type`，避免瀏覽器 MIME sniffing 攻擊。

## B. Node.js v18+ 現代化評估

範圍：`server.js`、`lib/` 下所有 `.js`

1. 非同步 I/O：檔案讀寫是否使用同步 API（`readFileSync`/`writeFileSync`）？評估對高並發的影響（本專案為單一內部使用，說明可接受程度）。
2. HTTP 伺服器：是否使用內建 `http` 模組，未引入 Express 等框架？
3. 子行程：是否有 `exec`、`execSync`（shell 字串拼接）的使用？
4. UUID 生成：是否使用內建 `crypto.randomUUID()`？

## 輸出格式

**安全弱點**：每筆列出檔名、行號、問題描述、利用情境、修復建議。
**現代化評估**：每項列出狀態（✓ 已符合 / ✗ 需改善）及改善方式。

若兩個維度都無問題，明確說明「無發現問題」。
