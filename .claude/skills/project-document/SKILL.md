更新專案文件，確保內容與程式碼實際行為一致。

---
name: project-document
description: 當使用者要求同步文件與程式碼、更新說明文件、或詢問現有文件是否正確時使用。
---


## 更新目標

1. **README.md** — 使用者入門說明；重點確認下列內容與程式碼一致：
   - 功能說明（篩選、排序、拖曳、複製的實際行為）
   - 啟動指令與 port 設定方式
   - Windows 服務安裝流程（npm install → npm run installService）
   - 資料儲存路徑（`data/` 目錄下的三個 JSON 檔）
   - 任務欄位的選項值（狀態、優先序、項目類型預設值）

2. **CLAUDE.md** — 給 Claude Code 參考的架構說明；重點確認下列項目：
   - 常用指令（啟動、服務安裝）
   - 高階架構描述（request flow、資料持久化方式）
   - Todo 資料模型欄位（含 `sortOrder`）
   - API 端點表格（含 clone、types 路由）
   - 前端架構說明（tabs、拖曳 DnD、drop zone）

## 更新原則

- **以程式碼為準**：先用 Read 工具讀取 `server.js`、`lib/router.js`、`lib/todoStore.js`、`public/app.js`、`public/index.html` 以及要更新的目標文件目前的完整內容，再逐段比對；不根據記憶修改
- 只更新與程式碼實際行為不符的地方，不改動仍然正確的內容
- 不修改人工維護的段落（如使用情境描述、決策說明等非從程式碼衍生的內容）

## 更新完畢後

列出每個文件實際修改了哪些地方（檔名 + 簡述），若某個文件不需要修改請說明原因。
