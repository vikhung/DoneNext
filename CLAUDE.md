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

# Package the full deployable set into dist/<project-dir-name>_deploy_YYYYMMDD.rar (requires WinRAR)
npm run deploy
```

`npm run deploy` (`scripts/deploy.js`) always packages the **full set** from the working tree, regardless of commit state: `server.js`, `package.json`, `package-lock.json`, `lib/`, `public/`, the two service scripts, plus the docs (`README.md`, `CLAUDE.md`, `LICENSE`). `.claude/`, the deploy script itself, and git-ignored paths (`data/`, `logs/`, `node_modules/`) are never included. The archive is written to `dist/` as `<project directory name>_deploy_YYYYMMDD.rar` (e.g. `DoneNext_deploy_20261113.rar`); re-running on the same day replaces that day's archive, other `.rar` files in `dist/` are kept, and anything else in `dist/` is removed. When adding a new top-level file or directory that must ship, add it to `DEPLOY_PATHS` in that script.

The server itself has no external dependencies — pure Node.js stdlib. `npm install` is only needed for the service installation scripts (node-windows).

## Architecture

This is a company-internal task management web app. The server uses only Node.js built-ins (`http`, `https`, `fs`, `path`, `crypto`, `zlib`).

### Request flow

```
HTTP request
  └─ server.js           — static file server + top-level error handler
       └─ lib/router.js  — routes /api/todos/*, /api/users/*, /api/types/*, /api/apitest/* (no framework)
            ├─ lib/todoStore.js     — synchronous JSON file CRUD
            ├─ lib/userStore.js     — synchronous JSON file CRUD
            ├─ lib/typeStore.js     — synchronous JSON file CRUD
            ├─ lib/apiTestStore.js  — API TEST collections, one JSON file per collection
            ├─ lib/apiSender.js     — sends one outbound HTTP(S) request on behalf of the browser
            │    └─ lib/apiTemplate.js — expands ${N()} / ${AN()} / ${DATETIME()} variables
            └─ lib/logger.js       — daily rotating log file
```

### Data persistence

- All data stored as JSON files under `data/` — synchronous `readFileSync`/`writeFileSync` on every request. No database, no caching layer.
- `data/` and `logs/` directories are auto-created on first write if missing.
- Logs rotate daily to `logs/YYYY-MM-DD.log` via `lib/logger.js`.
- API TEST collections live in `data/apitest/<類別名稱>.json` (the collection name **is** the file name). `apiTestStore.isValidName` rejects path separators, `..`, Windows-reserved names and anything resolving outside that directory — keep every new entry point going through it.

### API TEST

- A collection (類別) holds many API definitions: `id`, `name`, `method`, `url`, `headers` (multi-line `Key: Value` text, `#` = comment), `body`, plus run settings `count` (1–1000), `concurrency` (1–50, ≤ count), `intervalSec` (0–3600), `timeoutSec` (1–300), `insecureTLS`. `apiTestStore.save` normalizes/clamps all of these.
- Requests are sent **by the server** (`apiSender.send`), not the browser — avoids CORS and exposes full headers. It never rejects (failures come back as `result.error`), does not follow redirects, opens a new connection per request (`agent: false`), decompresses gzip/deflate/br, and truncates bodies over 1 MB.
- Variables are expanded server-side per request in URL, headers and body: `${N(n)}` random digits, `${AN(n)}` random `0-9A-Z`, `${DATETIME(fmt)}` with tokens `yyyy MM dd hh/HH mm ss SSS` (24-hour). Unknown `${...}` is left untouched.
- Batch runs are orchestrated in the browser (`atRunBatch` in `public/apitest.js`): `count` is split across `concurrency` virtual users that start together; each sends sequentially and sleeps `intervalSec` after each response. One `POST /api/apitest/send` per request, so results stream in and the run can be stopped.
- Results accumulate across runs — starting a new run never clears the list (only the 清除結果 button does). Each run appends a `.at-run-head` row, its result rows, then a `.at-run-summary` block (sent count, run interval `HH:mm:ss - HH:mm:ss` with browser-side wall time — which is always a bit longer than the server-measured response times because it includes interval sleeps and the browser↔this-server hop, avg/max/min response time in seconds, success = status **200** only vs. everything else incl. no-response, status-code distribution). `atResults` is one array for all runs; each run remembers its `startIdx`, and per-run stats come from `atRunResults(run)`.
- `APITEST send` log lines record only method/url/status/duration — never headers or bodies (they may carry credentials).
- The send endpoint lets anyone who can reach this site make the server host issue arbitrary HTTP requests; acceptable for an internal tool, but do not expose the site publicly.

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

- **Top-level tabs** (`.top-tabs` / `.top-tab-btn` buttons, each toggling a sibling `.top-section`): **任務管理**, **常用工具**, **API TEST**, **異動說明**. Adding another top-level feature only requires a new button + `.top-section` in HTML — no JS changes needed.
- **任務管理** (`public/app.js`) wraps the original task-management UI, itself a second tier of sub-tabs (`.tabs` / `.tab-btn` / `.tab-content`, same visual pattern reused one level down):
  - **任務列表**: task list with filter/sort bar and drag-and-drop reordering
    - **待辦清單** (`#btn-pending` in the toolbar → `#pending-modal`, logic in `app.js`: `collectPending` / `renderPending`): modal listing leaf-level unfinished tasks (status ≠ `已完成` and no unfinished descendants), grouped by root task with a breadcrumb path, filterable by assignee, overdue `dueDate` highlighted. Computed client-side from `allTodos`; independent of `listFilter`. Its 編輯 button closes the modal and opens the task edit modal.
  - **查詢歷史**: multi-field search across all tasks
  - **管理作業**: user list management and type list management
  - **使用說明**: static help page
- **常用工具** (`public/toolkit.js`, loaded after `app.js`) is its own sub-tab group with the same `.tabs`/`.tab-content` pattern:
  - **JSON Viewer**: paste JSON, live-parsed (debounced) into a collapsible tree (`#json-tree`) with `+`/`−` expand/collapse toggles; invalid JSON shows an inline error under the textarea instead of `alert()`.
  - **Base64 編解碼**: button-triggered encode/decode between plain text and Base64, using `TextEncoder`/`TextDecoder` (not raw `btoa`/`atob`) so multi-byte UTF-8 text (e.g. Chinese) round-trips correctly.
  - Toolkit code has no dependency on todo state; it reuses the global `esc()` defined in `app.js` for XSS-safe rendering.
- **API TEST** (`#top-apitest`, `public/apitest.js`, loaded after `toolkit.js`) is a single-view section (no sub-tabs) laid out as three columns for wide screens: left sidebar tree of collections → APIs, middle editor + run settings, right results. While it is active the shared `.container` max-width is lifted (`.container:has(#top-apitest.active)`) and `.at-layout` is pinned to the viewport height, so each column scrolls on its own — `#at-results` is the scroll container for result rows (auto-follows the newest row only while the user is at the bottom); the page itself must not grow with the result count. Below 1180px the results column drops under the other two as a fixed-height (70vh) scroll box. All identifiers/classes are prefixed `at` / `.at-`; it reuses the global `api()` and `esc()` from `app.js`. Result rows are colour-coded by status class (`at-2xx` green, `at-3xx` blue, `at-4xx` yellow, `at-5xx` red, `at-err` for no response) and render their Request/Response header+body detail lazily on first expand.
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
| GET | `/api/apitest/collections` | List all API TEST collections (with their APIs) |
| PUT | `/api/apitest/collections/:name` | Create or overwrite a collection (`{ apis: [...] }`) |
| POST | `/api/apitest/collections/:name/rename` | Rename a collection (renames the file; `{ newName }`, 409 if taken) |
| DELETE | `/api/apitest/collections/:name` | Delete a collection file |
| POST | `/api/apitest/send` | Expand variables and send one request; returns request/response/duration |

Filter query params for todos: `task`, `assignedTo`, `status`, `assignedDateFrom`, `assignedDateTo`, `startDateFrom`, `startDateTo`, `dueDateFrom`, `dueDateTo`.
