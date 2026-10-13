# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start server (default port 3000)
node server.js

# Start on a specific port
node server.js 8080
# or
PORT=8080 node server.js

# Install Windows service (requires Administrator + npm install first)
npm install
npm run installService

# Remove Windows service
npm run uninstallService
```

The server itself has no external dependencies — pure Node.js stdlib. `npm install` is only needed for the service installation scripts (node-windows).

## Architecture

This is a company-internal task management web app. The server uses only Node.js built-ins (`http`, `fs`, `path`, `crypto`).

### Request flow

```
HTTP request
  └─ server.js           — static file server + top-level error handler
       └─ lib/router.js  — routes /api/todos/*, /api/users/*, /api/types/* (no framework)
            ├─ lib/todoStore.js  — synchronous JSON file CRUD
            ├─ lib/userStore.js  — synchronous JSON file CRUD
            ├─ lib/typeStore.js  — synchronous JSON file CRUD
            └─ lib/logger.js    — daily rotating log file
```

### Data persistence

- All data stored as JSON files under `data/` — synchronous `readFileSync`/`writeFileSync` on every request. No database, no caching layer.
- `data/` and `logs/` directories are auto-created on first write if missing.
- Logs rotate daily to `logs/YYYY-MM-DD.log` via `lib/logger.js`.

### Todo model

Fields: `id` (UUID), `task`, `assignedTo`, `assignedDate`, `startDate`, `dueDate`, `status`, `priority`, `type`, `description`, `parentId`, `sortOrder`, `createdAt`, `updatedAt`.

- `assignedDate` format: `YYYY-MM-DDTHH:MM` (date chosen by user, time auto-recorded on save).
- `sortOrder` (number) controls manual drag-and-drop ordering. Auto-assigned on create; migrated from index-based values on first read for existing records without it.
- `parentId` enables an arbitrary-depth task tree. Deleting a parent cascades to all descendants (BFS loop in `todoStore.remove`).
- Valid statuses: `進行中`, `已完成`
- Valid priorities: `高`, `中`, `低`
- `id` and `createdAt` are immutable after creation; `update()` strips them from patches.
- New root tasks get `sortOrder = minExisting - 65536` (appear at top); new subtasks get `sortOrder = minSiblingOrder - 65536` (also appear at top, within their parent).
- When a subtask's (any non-root task's) `status` is updated to `已完成` from a different prior status, `todoStore.update` auto-recalculates its `sortOrder` to `maxSiblingOrder + 65536`, moving it to the bottom of its parent's children — unless the caller explicitly supplies `sortOrder` in the same patch (e.g. drag-and-drop reordering).

### Frontend

Vanilla JS, no framework, no bundler — plain `<script>` tags sharing one global scope. Two-tier tab navigation in `public/index.html`:

- **Top-level tabs** (`.top-tabs` / `.top-tab-btn` buttons, each toggling a sibling `.top-section`): **任務管理**, **常用工具**, **異動說明**. Adding another top-level feature only requires a new button + `.top-section` in HTML — no JS changes needed.
- **任務管理** (`public/app.js`) wraps the original task-management UI, itself a second tier of sub-tabs (`.tabs` / `.tab-btn` / `.tab-content`, same visual pattern reused one level down):
  - **任務列表**: task list with filter/sort bar and drag-and-drop reordering
  - **查詢歷史**: multi-field search across all tasks
  - **管理作業**: user list management and type list management
  - **使用說明**: static help page
- **常用工具** (`public/toolkit.js`, loaded after `app.js`) is its own sub-tab group with the same `.tabs`/`.tab-content` pattern:
  - **JSON Viewer**: paste JSON, live-parsed (debounced) into a collapsible tree (`#json-tree`) with `+`/`−` expand/collapse toggles; invalid JSON shows an inline error under the textarea instead of `alert()`.
  - **Base64 編解碼**: button-triggered encode/decode between plain text and Base64, using `TextEncoder`/`TextDecoder` (not raw `btoa`/`atob`) so multi-byte UTF-8 text (e.g. Chinese) round-trips correctly.
  - Toolkit code has no dependency on todo state; it reuses the global `esc()` defined in `app.js` for XSS-safe rendering.
- **異動說明** (`#top-changelog`) is a static, single-view top-level section (no internal sub-tabs) listing version history.

Tab-switching logic lives in `app.js`: one handler for `.top-tab-btn` (toggles `.top-section`), and one for `.tab-btn` that scopes its query to `btn.closest('.top-section')` — this keeps the 任務管理 sub-tabs and 常用工具 sub-tabs as independent groups so switching one doesn't reset the other's active state.

The task tree is built client-side from the flat array returned by `GET /api/todos`. All HTML is constructed via template literals with an `esc()` helper to prevent XSS.

**Drag-and-drop**: each task row has a drag handle (⠿). Drop zones (8px divs) are inserted between every task row via `renderWithDropZones()`. Dropping on a zone reorders/reparents; dropping on a task-main makes it a child. `sortOrder` is recalculated using midpoint between neighbours' values.

**Sort**: default is manual (`sortOrder` ascending). Clicking a sort button activates field-based descending sort; clicking again reverts to manual. Sort only applies to root tasks — children always use `sortOrder`.

**Status filter**: applied after `buildTree()` — only root tasks are filtered; children are always shown.

### API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/todos` | List all (supports filter query params) |
| POST | `/api/todos` | Create todo |
| GET | `/api/todos/search` | Search (same filters as GET /api/todos) |
| GET | `/api/todos/:id` | Get one |
| PUT | `/api/todos/:id` | Update (parentId + sortOrder used for drag-and-drop) |
| DELETE | `/api/todos/:id` | Delete (cascades to all descendants) |
| POST | `/api/todos/:id/clone` | Deep-clone task and all descendants |
| GET | `/api/users` | List users |
| POST | `/api/users` | Add user |
| DELETE | `/api/users/:name` | Remove user |
| GET | `/api/types` | List item types |
| POST | `/api/types` | Add item type |
| DELETE | `/api/types/:name` | Remove item type |

Filter query params for todos: `task`, `assignedTo`, `status`, `assignedDateFrom`, `assignedDateTo`, `startDateFrom`, `startDateTo`, `dueDateFrom`, `dueDateTo`.
