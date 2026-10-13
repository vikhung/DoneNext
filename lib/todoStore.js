'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'todos.json');

function readAll() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const todos = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    let dirty = false;
    todos.forEach((t, i) => {
      if (t.sortOrder == null) {
        t.sortOrder = (i + 1) * 65536;
        dirty = true;
      }
    });
    if (dirty) writeAll(todos);
    return todos;
  } catch {
    return [];
  }
}

function writeAll(todos) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2), 'utf8');
}

function now() {
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function matchFilter(todo, filter) {
  if (filter.task && !(todo.task || '').includes(filter.task)) return false;
  if (filter.assignedTo && !(todo.assignedTo || '').includes(filter.assignedTo)) return false;
  if (filter.status && todo.status !== filter.status) return false;
  if (filter.assignedDateFrom && todo.assignedDate < filter.assignedDateFrom) return false;
  if (filter.assignedDateTo && todo.assignedDate > filter.assignedDateTo) return false;
  if (filter.startDateFrom && todo.startDate < filter.startDateFrom) return false;
  if (filter.startDateTo && todo.startDate > filter.startDateTo) return false;
  if (filter.dueDateFrom && todo.dueDate < filter.dueDateFrom) return false;
  if (filter.dueDateTo && todo.dueDate > filter.dueDateTo) return false;
  return true;
}

function getAll(filter) {
  const todos = readAll();
  if (!filter || Object.keys(filter).length === 0) return todos;
  return todos.filter(t => matchFilter(t, filter));
}

function getById(id) {
  return readAll().find(t => t.id === id) || null;
}

function create(data) {
  const todos = readAll();
  let defaultOrder;
  if (data.parentId) {
    const siblings = todos.filter(t => t.parentId === data.parentId);
    const minSib = siblings.reduce((m, t) => Math.min(m, t.sortOrder || 0), 0);
    defaultOrder = minSib - 65536;
  } else {
    const minOrder = todos.reduce((m, t) => Math.min(m, t.sortOrder || 0), 0);
    defaultOrder = minOrder - 65536;
  }
  const isoNow = new Date().toISOString();
  const todo = {
    id: crypto.randomUUID(),
    task: data.task || '',
    assignedTo: data.assignedTo || '',
    assignedDate: data.assignedDate || now(),
    startDate: data.startDate || '',
    dueDate: data.dueDate || '',
    status: data.status || '進行中',
    priority: data.priority || '中',
    type: data.type || '專案需求',
    description: data.description || '',
    parentId: data.parentId || null,
    sortOrder: data.sortOrder !== undefined ? data.sortOrder : defaultOrder,
    createdAt: isoNow,
    updatedAt: isoNow,
  };
  todos.push(todo);
  writeAll(todos);
  return todo;
}

function update(id, data) {
  const todos = readAll();
  const idx = todos.findIndex(t => t.id === id);
  if (idx === -1) return null;
  const prohibited = ['id', 'createdAt'];
  const patch = Object.fromEntries(
    Object.entries(data).filter(([k]) => !prohibited.includes(k))
  );

  // 子任務設為已完成時，自動移到同層子任務的最下方
  const current = todos[idx];
  if (
    current.parentId &&
    patch.status === '已完成' &&
    current.status !== '已完成' &&
    patch.sortOrder === undefined
  ) {
    const siblings = todos.filter(t => t.parentId === current.parentId && t.id !== id);
    const maxSib = siblings.reduce((m, t) => Math.max(m, t.sortOrder || 0), 0);
    patch.sortOrder = maxSib + 65536;
  }

  todos[idx] = { ...todos[idx], ...patch, id, updatedAt: new Date().toISOString() };
  writeAll(todos);
  return todos[idx];
}

function remove(id) {
  const todos = readAll();
  if (!todos.find(t => t.id === id)) return false;

  // Collect all descendant IDs
  const toRemove = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of todos) {
      if (t.parentId && toRemove.has(t.parentId) && !toRemove.has(t.id)) {
        toRemove.add(t.id);
        changed = true;
      }
    }
  }
  writeAll(todos.filter(t => !toRemove.has(t.id)));
  return true;
}

function clone(id) {
  const todos = readAll();
  const src = todos.find(t => t.id === id);
  if (!src) return null;

  const maxOrder = todos.reduce((m, t) => Math.max(m, t.sortOrder || 0), 0);
  const nowStr = new Date().toISOString();
  const subtree = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    const task = todos.find(t => t.id === cur);
    if (!task) continue;
    subtree.push(task);
    todos.filter(t => t.parentId === cur).forEach(t => queue.push(t.id));
  }

  const idMap = {};
  subtree.forEach(t => { idMap[t.id] = crypto.randomUUID(); });

  const cloned = subtree.map(t => ({
    ...t,
    id: idMap[t.id],
    parentId: t.id === id ? t.parentId : idMap[t.parentId],
    sortOrder: t.id === id ? maxOrder + 65536 : (t.sortOrder ?? 0),
    createdAt: nowStr,
    updatedAt: nowStr,
  }));

  todos.push(...cloned);
  writeAll(todos);
  return cloned[0];
}

module.exports = { getAll, getById, create, update, remove, clone };
