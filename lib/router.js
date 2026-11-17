'use strict';
const store = require('./todoStore');
const users = require('./userStore');
const types = require('./typeStore');
const apiTests = require('./apiTestStore');
const apiSender = require('./apiSender');
const logger = require('./logger');

const APITEST_COL_RE = /^\/api\/apitest\/collections\/(.+)$/;
const APITEST_RENAME_RE = /^\/api\/apitest\/collections\/([^/]+)\/rename$/;
const TODO_ID_RE = /^\/api\/todos\/([^/]+)$/;
const CLONE_RE   = /^\/api\/todos\/([^/]+)\/clone$/;
const USER_NAME_RE = /^\/api\/users\/(.+)$/;
const TYPE_NAME_RE = /^\/api\/types\/(.+)$/;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function handle(req, res) {
  const parsed   = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;
  const query    = Object.fromEntries(parsed.searchParams.entries());
  const method   = req.method;

  // ── Users ──────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/users') {
    return json(res, 200, users.getAll());
  }

  if (method === 'POST' && pathname === '/api/users') {
    const body = await parseBody(req);
    if (!body.name || !body.name.trim()) return json(res, 400, { error: '姓名為必填' });
    const result = users.add(body.name);
    if (!result) return json(res, 409, { error: '人員已存在' });
    logger.info('CREATE user', { name: result });
    return json(res, 201, { name: result });
  }

  const userMatch = pathname.match(USER_NAME_RE);
  if (userMatch && method === 'DELETE') {
    const name = decodeURIComponent(userMatch[1]);
    const ok = users.remove(name);
    if (!ok) return json(res, 404, { error: '找不到人員' });
    logger.info('DELETE user', { name });
    return json(res, 200, { success: true });
  }

  // ── Types ──────────────────────────────────────────────

  if (method === 'GET' && pathname === '/api/types') {
    return json(res, 200, types.getAll());
  }

  if (method === 'POST' && pathname === '/api/types') {
    const body = await parseBody(req);
    if (!body.name || !body.name.trim()) return json(res, 400, { error: '類型名稱為必填' });
    const result = types.add(body.name);
    if (!result) return json(res, 409, { error: '類型已存在' });
    logger.info('CREATE type', { name: result });
    return json(res, 201, { name: result });
  }

  const typeMatch = pathname.match(TYPE_NAME_RE);
  if (typeMatch && method === 'DELETE') {
    const name = decodeURIComponent(typeMatch[1]);
    const ok = types.remove(name);
    if (!ok) return json(res, 404, { error: '找不到類型' });
    logger.info('DELETE type', { name });
    return json(res, 200, { success: true });
  }

  // ── API TEST ───────────────────────────────────────────

  if (method === 'GET' && pathname === '/api/apitest/collections') {
    return json(res, 200, apiTests.list());
  }

  if (method === 'POST' && pathname === '/api/apitest/send') {
    const body = await parseBody(req);
    const result = await apiSender.send(body);
    // 只記摘要，不記 header / body（可能含憑證）
    logger.info('APITEST send', {
      method: result.request ? result.request.method : body.method,
      url: result.request ? result.request.url : body.url,
      status: result.response ? result.response.status : null,
      durationMs: result.durationMs,
      error: result.error,
    });
    return json(res, 200, result);
  }

  const renameMatch = pathname.match(APITEST_RENAME_RE);
  if (renameMatch && method === 'POST') {
    let name;
    try { name = decodeURIComponent(renameMatch[1]); }
    catch { return json(res, 400, { error: '類別名稱格式錯誤' }); }
    const body = await parseBody(req);
    const newName = typeof body.newName === 'string' ? body.newName.trim() : '';
    if (!apiTests.isValidName(name) || !apiTests.isValidName(newName)) {
      return json(res, 400, { error: '類別名稱不合法（不可含 \\ / : * ? " < > | 等字元，長度 1–50）' });
    }
    if (!apiTests.exists(name)) return json(res, 404, { error: '找不到類別' });
    const renamed = apiTests.rename(name, newName);
    if (!renamed) return json(res, 409, { error: '類別名稱已存在' });
    logger.info('RENAME apitest collection', { from: name, to: newName });
    return json(res, 200, renamed);
  }

  const colMatch = pathname.match(APITEST_COL_RE);
  if (colMatch && (method === 'PUT' || method === 'DELETE')) {
    let name;
    try { name = decodeURIComponent(colMatch[1]); }
    catch { return json(res, 400, { error: '類別名稱格式錯誤' }); }
    if (!apiTests.isValidName(name)) {
      return json(res, 400, { error: '類別名稱不合法（不可含 \\ / : * ? " < > | 等字元，長度 1–50）' });
    }

    if (method === 'PUT') {
      const body = await parseBody(req);
      const saved = apiTests.save(name, body);
      logger.info('SAVE apitest collection', { name, apis: saved.apis.length });
      return json(res, 200, saved);
    }

    const ok = apiTests.remove(name);
    if (!ok) return json(res, 404, { error: '找不到類別' });
    logger.info('DELETE apitest collection', { name });
    return json(res, 200, { success: true });
  }

  // ── Todos ──────────────────────────────────────────────

  // GET /api/todos/search  — must come before the :id pattern
  if (method === 'GET' && pathname === '/api/todos/search') {
    const results = store.getAll(query);
    logger.info('SEARCH todos', query);
    return json(res, 200, results);
  }

  if (method === 'GET' && pathname === '/api/todos') {
    const results = store.getAll(query);
    logger.info('LIST todos', query);
    return json(res, 200, results);
  }

  if (method === 'POST' && pathname === '/api/todos') {
    const body = await parseBody(req);
    if (!body.task || !body.task.trim()) return json(res, 400, { error: '任務項目為必填' });
    const todo = store.create(body);
    logger.info('CREATE todo', { id: todo.id, task: todo.task });
    return json(res, 201, todo);
  }

  const cloneMatch = pathname.match(CLONE_RE);
  if (cloneMatch && method === 'POST') {
    const id = cloneMatch[1];
    const cloned = store.clone(id);
    if (!cloned) return json(res, 404, { error: '找不到任務' });
    logger.info('CLONE todo', { id, newId: cloned.id });
    return json(res, 201, cloned);
  }

  const m = pathname.match(TODO_ID_RE);
  if (m) {
    const id = m[1];

    if (method === 'GET') {
      const todo = store.getById(id);
      if (!todo) return json(res, 404, { error: '找不到任務' });
      logger.info('GET todo', { id });
      return json(res, 200, todo);
    }

    if (method === 'PUT') {
      const body = await parseBody(req);
      const todo = store.update(id, body);
      if (!todo) return json(res, 404, { error: '找不到任務' });
      logger.info('UPDATE todo', { id });
      return json(res, 200, todo);
    }

    if (method === 'DELETE') {
      const ok = store.remove(id);
      if (!ok) return json(res, 404, { error: '找不到任務' });
      logger.info('DELETE todo', { id });
      return json(res, 200, { success: true });
    }
  }

  json(res, 404, { error: 'Not found' });
}

module.exports = { handle };
