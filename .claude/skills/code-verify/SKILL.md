驗證所有 *.js 語法正確，並確認專案核心邏輯符合預期。

---
name: code-verify
description: 當使用者要求驗證程式可執行、確認環境正常、或在程式碼異動後想確認功能完整性時使用。
---


## 執行流程

### 1. 驗證開發環境版本
執行 `node --version`，確認為 v18 以上。

### 2. 語法檢查（所有 JS 檔）
分別對下列檔案執行 `node --check`：
- `server.js`
- `lib/router.js`
- `lib/todoStore.js`
- `lib/userStore.js`
- `lib/typeStore.js`
- `lib/logger.js`
- `scripts/install-service.js`
- `scripts/uninstall-service.js`

### 3. 確認伺服器無第三方套件依賴
用 Grep 工具在 `server.js` 與 `lib/` 下所有 `*.js` 搜尋 `require\('[^./]`（即 require 的模組名稱不以 `.` 或 `/` 開頭）。
允許的結果僅限 Node.js 內建模組：`http`、`fs`、`path`、`crypto`、`url`。
出現任何其他模組名稱即為異常。

### 4. 確認關鍵實作正確性

- **Path Traversal 防護**：用 Grep 確認 `server.js` 中同時存在 `PUBLIC_DIR` 與 `startsWith`（靜態檔案路徑驗證）
- **UUID 生成**：用 Grep 確認 `lib/todoStore.js` 中使用 `crypto.randomUUID()`
- **data 目錄自動建立**：用 Grep 確認 `todoStore.js`、`userStore.js`、`typeStore.js` 的 `writeAll` 函式內都有 `mkdirSync`
- **sortOrder 初始化**：用 Grep 確認 `todoStore.js` 的 `readAll` 函式內有 `sortOrder` 補值邏輯（`dirty`）
- **XSS 防護**：用 Grep 確認 `public/app.js` 中 `esc` 函式定義包含五個轉義字元（`&`、`<`、`>`、`"`、`'`）
- **Clone 深度複製**：用 Grep 確認 `lib/todoStore.js` 中 `clone` 函式內有 `idMap` 與 BFS 佇列（`queue`）

### 5. 確認 API 路由完整性
用 Grep 工具確認 `lib/router.js` 中下列路由都存在：
- `GET /api/todos`
- `POST /api/todos`
- `GET /api/todos/search`
- `/api/todos/:id`（含 GET、PUT、DELETE）
- `POST /api/todos/:id/clone`（CLONE_RE）
- `GET /api/users`、`POST /api/users`、`DELETE /api/users/:name`
- `GET /api/types`、`POST /api/types`、`DELETE /api/types/:name`

### 6. 實際啟動驗證
執行 `node server.js 9999 &`（背景啟動），等待 1 秒後對 `http://localhost:9999/api/todos` 發送 GET 請求，確認回傳 JSON 陣列。完成後終止 node 行程。

## 輸出格式

每個步驟顯示 ✓（通過）或 ✗（失敗），失敗時顯示錯誤訊息或不符合的行號。
所有步驟通過後，顯示「✓ 驗證完成」。
