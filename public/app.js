'use strict';

// ── State ──────────────────────────────────────────────────
let allTodos    = [];
let allUsers    = [];
let allTypes    = [];
let expandedIds = new Set();
let dragId = null;
let dragDescendantIds = new Set();
let listFilter  = { status: '進行中' };
let sortState   = { field: null, dir: 'desc' };

// ── API helper ─────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Escape HTML ────────────────────────────────────────────
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Status badge ───────────────────────────────────────────
const STATUS_CLS   = { '首次':'first','進行中':'progress','已完成':'done','暫停':'pause','取消':'cancel' };
const STATUS_ORDER = { '首次':1,'進行中':2,'暫停':3,'已完成':4,'取消':5 };
const PRIORITY_CLS = { '高':'high','中':'mid','低':'low' };
const PRIORITY_ORDER = { '高':1,'中':2,'低':3 };

function priorityBadge(p) {
  if (!p) return '';
  return `<span class="badge badge-pri-${PRIORITY_CLS[p]||'mid'}">${esc(p)}</span>`;
}

function badge(status) {
  return `<span class="badge badge-${STATUS_CLS[status]||'first'}">${esc(status)}</span>`;
}

// ── Sort ───────────────────────────────────────────────────
function applySort(todos) {
  const { field, dir } = sortState;
  if (!field) {
    return [...todos].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }
  return [...todos].sort((a, b) => {
    let va = a[field] || '';
    let vb = b[field] || '';
    if (field === 'status') {
      va = STATUS_ORDER[va] || 99;
      vb = STATUS_ORDER[vb] || 99;
    }
    let cmp = (typeof va === 'number')
      ? va - vb
      : va.localeCompare(vb, 'zh-TW', { sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
  });
}

function updateSortBar() {
  document.querySelectorAll('.sort-btn').forEach(btn => {
    const active = !!sortState.field && btn.dataset.sort === sortState.field;
    btn.classList.toggle('active', active);
    let arrow = btn.querySelector('.sort-arrow');
    if (active) {
      if (!arrow) {
        arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        btn.appendChild(arrow);
      }
      arrow.textContent = sortState.dir === 'asc' ? ' ▲' : ' ▼';
    } else if (arrow) {
      arrow.remove();
    }
  });
}

// ── Build tree ─────────────────────────────────────────────
function buildTree(todos) {
  const map = {};
  todos.forEach(t => { map[t.id] = { ...t, children: [] }; });
  const roots = [];
  todos.forEach(t => {
    if (t.parentId && map[t.parentId]) map[t.parentId].children.push(map[t.id]);
    else if (!t.parentId) roots.push(map[t.id]);
  });
  return roots;
}

// ── Drag helpers ───────────────────────────────────────────
function getAllDescendantIds(taskId) {
  const ids = new Set();
  const queue = [taskId];
  while (queue.length) {
    const cur = queue.shift();
    allTodos.filter(t => t.parentId === cur).forEach(t => { ids.add(t.id); queue.push(t.id); });
  }
  return ids;
}

// ── Descendant helpers ─────────────────────────────────────
function hasUnfinishedDescendants(taskId) {
  const queue = [...allTodos.filter(t => t.parentId === taskId)];
  while (queue.length) {
    const t = queue.shift();
    if (t.status !== '已完成') return true;
    allTodos.filter(c => c.parentId === t.id).forEach(c => queue.push(c));
  }
  return false;
}

// ── Drop zone rendering ─────────────────────────────────────
function dropZoneHtml(parentId, afterId, beforeId) {
  return `<div class="drop-zone" data-parent-id="${esc(parentId||'')}" data-after-id="${esc(afterId||'')}" data-before-id="${esc(beforeId||'')}"></div>`;
}

function renderWithDropZones(tasks, parentId, level) {
  if (!tasks.length) return dropZoneHtml(parentId, '', '');
  let html = dropZoneHtml(parentId, '', tasks[0].id);
  tasks.forEach((t, i) => {
    html += taskHtml(t, level);
    html += dropZoneHtml(parentId, t.id, tasks[i + 1] ? tasks[i + 1].id : '');
  });
  return html;
}

// ── Render single task row (recursive) ────────────────────
function taskHtml(task, level) {
  const hasKids  = task.children && task.children.length > 0;
  const expanded = expandedIds.has(task.id);

  const expandBtn = hasKids
    ? `<button class="btn-expand" data-id="${esc(task.id)}" title="${expanded?'收合':'展開'}">${expanded?'&#9660;':'&#9654;'}</button>`
    : `<span class="expand-placeholder"></span>`;

  const descHtml = task.description
    ? `<div class="task-desc" title="${esc(task.description)}">${esc(task.description)}</div>`
    : '';

  const meta = [];
  if (!task.parentId && task.priority) meta.push(priorityBadge(task.priority));
  if (!task.parentId && task.type)     meta.push(`<span class="badge badge-pause">${esc(task.type)}</span>`);
  if (task.assignedTo)  meta.push(`<span class="meta-item">負責人:&nbsp;${esc(task.assignedTo)}</span>`);
  if (task.assignedDate) meta.push(`<span class="meta-item">新增:&nbsp;${esc(task.assignedDate.replace('T', ' '))}</span>`);
  if (task.startDate)   meta.push(`<span class="meta-item">開始:&nbsp;${esc(task.startDate)}</span>`);
  if (task.dueDate)     meta.push(`<span class="meta-item">截止:&nbsp;${esc(task.dueDate)}</span>`);

  const childrenHtml = (hasKids && expanded)
    ? `<div class="task-children">${renderWithDropZones(task.children, task.id, level + 1)}</div>`
    : '';

  return `<div class="task-row level-${level}" data-id="${esc(task.id)}">
  <div class="task-main">
    <span class="drag-handle" draggable="true" data-id="${esc(task.id)}" title="拖曳移動">⠿</span>
    ${expandBtn}
    <div class="task-info">
      <div class="task-title">${esc(task.task)}</div>
      ${descHtml}
      <div class="task-meta">${badge(task.status)}${meta.join('')}</div>
    </div>
    <div class="task-actions">
      <button class="btn btn-sm btn-secondary btn-edit" data-id="${esc(task.id)}">編輯</button>
      <button class="btn btn-sm btn-warning btn-subtask" data-id="${esc(task.id)}">子任務</button>
      <button class="btn btn-sm btn-secondary btn-clone" data-id="${esc(task.id)}">複製</button>
      <button class="btn btn-sm btn-danger btn-delete" data-id="${esc(task.id)}">刪除</button>
    </div>
  </div>
  ${childrenHtml}
</div>`;
}

// ── Render todo list ───────────────────────────────────────
function renderList() {
  const container = document.getElementById('todo-list');

  // 子任務（含子子任務）固定以自訂排序（sortOrder）排列
  const bySortOrder = [...allTodos].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  let roots = buildTree(bySortOrder);

  // 所有過濾條件僅作用於根任務，子任務一律顯示
  if (listFilter.status)     roots = roots.filter(t => t.status === listFilter.status);
  if (listFilter.assignedTo) roots = roots.filter(t => (t.assignedTo || '').includes(listFilter.assignedTo));
  if (listFilter.priority)   roots = roots.filter(t => t.priority === listFilter.priority);
  if (listFilter.type)       roots = roots.filter(t => t.type     === listFilter.type);

  // 根任務依排序列設定排列
  roots = applySort(roots);

  if (roots.length === 0) {
    container.innerHTML = '<div class="empty-state">尚無任務，請點擊「+ 新增任務」建立第一個任務</div>';
    return;
  }

  container.innerHTML = renderWithDropZones(roots, null, 0);
  bindListEvents(container);
  bindDragEvents(container);
}

function bindListEvents(container) {
  container.querySelectorAll('.btn-expand').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      expandedIds.has(id) ? expandedIds.delete(id) : expandedIds.add(id);
      renderList();
    });
  });

  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const todo = allTodos.find(t => t.id === btn.dataset.id);
      if (todo) openModal(todo, null);
    });
  });

  container.querySelectorAll('.btn-subtask').forEach(btn => {
    btn.addEventListener('click', () => {
      const parent = allTodos.find(t => t.id === btn.dataset.id);
      if (parent) openModal(null, parent);
    });
  });

  container.querySelectorAll('.btn-clone').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api('POST', `/api/todos/${btn.dataset.id}/clone`);
        await loadTodos();
      } catch (err) { alert('複製失敗：' + err.message); }
    });
  });

  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const todo = allTodos.find(t => t.id === btn.dataset.id);
      const kids = allTodos.filter(t => t.parentId === btn.dataset.id);
      const msg  = kids.length
        ? `確定刪除「${todo ? todo.task : ''}」？\n（含 ${kids.length} 個子任務，一併刪除）`
        : `確定刪除「${todo ? todo.task : ''}」？`;
      if (!confirm(msg)) return;
      try {
        await api('DELETE', `/api/todos/${btn.dataset.id}`);
        await loadTodos();
      } catch (err) {
        alert('刪除失敗：' + err.message);
      }
    });
  });
}

// ── Drag and Drop ──────────────────────────────────────────
function bindDragEvents(container) {
  container.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('dragstart', e => {
      const id = handle.dataset.id;
      dragId = id;
      dragDescendantIds = getAllDescendantIds(id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      const row = handle.closest('.task-row');
      if (row) {
        e.dataTransfer.setDragImage(row, 20, 20);
        setTimeout(() => row.classList.add('dragging'), 0);
      }
      e.stopPropagation();
    });

    handle.addEventListener('dragend', () => {
      dragId = null;
      dragDescendantIds = new Set();
      document.querySelectorAll('.task-row.dragging').forEach(r => r.classList.remove('dragging'));
      document.querySelectorAll('.task-main.drop-target').forEach(m => m.classList.remove('drop-target'));
      document.querySelectorAll('.drop-zone.active').forEach(z => z.classList.remove('active'));
    });
  });

  // 放到任務本體 → 成為該任務的子任務（加到子任務末端）
  container.querySelectorAll('.task-main').forEach(main => {
    const id = main.closest('.task-row').dataset.id;

    main.addEventListener('dragover', e => {
      if (!dragId || dragId === id || dragDescendantIds.has(id)) return;
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.drop-zone.active').forEach(z => z.classList.remove('active'));
      main.classList.add('drop-target');
    });

    main.addEventListener('dragleave', e => {
      if (!main.contains(e.relatedTarget)) main.classList.remove('drop-target');
    });

    main.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      main.classList.remove('drop-target');
      if (!dragId || dragId === id || dragDescendantIds.has(id)) return;
      const srcId = dragId;
      dragId = null;
      // 加到子任務末端：sortOrder = 現有子任務最大值 + 65536
      const children = allTodos.filter(t => t.parentId === id);
      const maxOrder = children.reduce((m, t) => Math.max(m, t.sortOrder ?? 0), 0);
      const patch1 = { parentId: id, sortOrder: maxOrder + 65536 };
      const srcTask1 = allTodos.find(t => t.id === srcId);
      if (srcTask1 && !srcTask1.parentId) {
        const newParent1 = allTodos.find(t => t.id === id);
        if (newParent1) { patch1.priority = newParent1.priority; patch1.type = newParent1.type; }
      }
      try {
        await api('PUT', `/api/todos/${srcId}`, patch1);
        await loadTodos();
      } catch (err) { alert('移動失敗：' + err.message); }
    });
  });

  // 放到任務間的 drop-zone → 平行搬移（可跨層級）
  container.querySelectorAll('.drop-zone').forEach(zone => {
    zone.addEventListener('dragover', e => {
      if (!dragId) return;
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.drop-zone.active').forEach(z => { if (z !== zone) z.classList.remove('active'); });
      document.querySelectorAll('.task-main.drop-target').forEach(m => m.classList.remove('drop-target'));
      zone.classList.add('active');
    });

    zone.addEventListener('dragleave', () => zone.classList.remove('active'));

    zone.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('active');
      if (!dragId) return;

      const srcId      = dragId;
      const newParentId = zone.dataset.parentId || null;
      const afterId    = zone.dataset.afterId  || null;
      const beforeId   = zone.dataset.beforeId || null;

      // 防止拖到自身後代的 zone
      if (newParentId && dragDescendantIds.has(newParentId)) { dragId = null; return; }
      // 緊鄰自身不做事
      if (afterId === srcId || beforeId === srcId) { dragId = null; return; }

      dragId = null;

      const afterTask  = afterId  ? allTodos.find(t => t.id === afterId)  : null;
      const beforeTask = beforeId ? allTodos.find(t => t.id === beforeId) : null;
      const prevOrder  = afterTask  ? (afterTask.sortOrder  ?? 0) : null;
      const nextOrder  = beforeTask ? (beforeTask.sortOrder ?? 0) : null;

      let newSortOrder;
      if (prevOrder !== null && nextOrder !== null) newSortOrder = (prevOrder + nextOrder) / 2;
      else if (prevOrder !== null)                  newSortOrder = prevOrder  + 65536;
      else if (nextOrder !== null)                  newSortOrder = nextOrder  - 65536;
      else                                          newSortOrder = Date.now();

      const patch2 = { parentId: newParentId, sortOrder: newSortOrder };
      const srcTask2 = allTodos.find(t => t.id === srcId);
      if (srcTask2 && !srcTask2.parentId && newParentId) {
        const newParent2 = allTodos.find(t => t.id === newParentId);
        if (newParent2) { patch2.priority = newParent2.priority; patch2.type = newParent2.type; }
      }
      try {
        await api('PUT', `/api/todos/${srcId}`, patch2);
        await loadTodos();
      } catch (err) { alert('移動失敗：' + err.message); }
    });
  });
}

// ── Load todos ─────────────────────────────────────────────
async function loadTodos() {
  try {
    allTodos = await api('GET', '/api/todos');
    renderList();
  } catch (err) {
    document.getElementById('todo-list').innerHTML =
      `<div class="empty-state">載入失敗：${esc(err.message)}</div>`;
  }
}

// ── Users ──────────────────────────────────────────────────
async function loadUsers() {
  try {
    allUsers = await api('GET', '/api/users');
    populateUserDatalist();
  } catch { /* non-fatal */ }
}

function populateUserDatalist() {
  // datalist inputs (task form + search form)
  ['users-datalist', 'search-users-datalist'].forEach(id => {
    const dl = document.getElementById(id);
    if (!dl) return;
    dl.innerHTML = allUsers.map(u => `<option value="${esc(u)}">`).join('');
  });

  // select dropdown (list filter)
  const sel = document.getElementById('filter-assignedTo');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">全部</option>' +
    allUsers.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
  if (current) sel.value = current; // restore selection if still valid
}

function renderUserList() {
  const container = document.getElementById('user-list-main');
  if (!container) return;
  if (allUsers.length === 0) {
    container.innerHTML = '<div class="user-empty">尚無人員，請在下方新增</div>';
    return;
  }
  container.innerHTML = allUsers.map(u => `
    <div class="user-item">
      <span class="user-item-name">${esc(u)}</span>
      <button class="btn btn-sm btn-danger btn-del-user" data-name="${esc(u)}">移除</button>
    </div>`).join('');

  container.querySelectorAll('.btn-del-user').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`確定移除「${btn.dataset.name}」？`)) return;
      try {
        await api('DELETE', `/api/users/${encodeURIComponent(btn.dataset.name)}`);
        await loadUsers();
        renderUserList();
      } catch (err) {
        alert('移除失敗：' + err.message);
      }
    });
  });
}

// ── Types ──────────────────────────────────────────────────
async function loadTypes() {
  try {
    allTypes = await api('GET', '/api/types');
    populateTypeSelects();
  } catch { /* non-fatal */ }
}

function populateTypeSelects() {
  const opts = allTypes.map(tp => `<option value="${esc(tp)}">${esc(tp)}</option>`).join('');

  const formSel = document.getElementById('f-type');
  if (formSel) {
    const current = formSel.value;
    formSel.innerHTML = opts;
    if (current) formSel.value = current;
  }

  const filterSel = document.getElementById('filter-type');
  if (filterSel) {
    const current = filterSel.value;
    filterSel.innerHTML = '<option value="">全部</option>' + opts;
    if (current) filterSel.value = current;
  }
}

function renderTypeList() {
  const container = document.getElementById('type-list-main');
  if (!container) return;
  if (allTypes.length === 0) {
    container.innerHTML = '<div class="user-empty">尚無類型，請在下方新增</div>';
    return;
  }
  container.innerHTML = allTypes.map(tp => `
    <div class="user-item">
      <span class="user-item-name">${esc(tp)}</span>
      <button class="btn btn-sm btn-danger btn-del-type" data-name="${esc(tp)}">移除</button>
    </div>`).join('');

  container.querySelectorAll('.btn-del-type').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`確定移除「${btn.dataset.name}」？`)) return;
      try {
        await api('DELETE', `/api/types/${encodeURIComponent(btn.dataset.name)}`);
        await loadTypes();
        renderTypeList();
      } catch (err) {
        alert('移除失敗：' + err.message);
      }
    });
  });
}

// ── Task Modal ─────────────────────────────────────────────
function now() {
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openModal(todo, parentTask) {
  const modal      = document.getElementById('modal');
  const parentInfo = document.getElementById('f-parent-info');
  document.getElementById('todo-form').reset();
  document.getElementById('f-id').value       = '';
  document.getElementById('f-parentId').value = '';
  parentInfo.classList.add('hidden');
  parentInfo.textContent = '';

  const priRow   = document.getElementById('f-priority-type-row');
  const isSubtask = !!(parentTask || (todo && todo.parentId));
  priRow.style.display = isSubtask ? 'none' : '';

  if (todo) {
    document.getElementById('modal-title').textContent    = '編輯任務';
    document.getElementById('f-id').value                 = todo.id;
    document.getElementById('f-task').value               = todo.task || '';
    document.getElementById('f-assignedTo').value         = todo.assignedTo || '';
    const _dt = todo.assignedDate || now();
    document.getElementById('f-assignedDate').value       = _dt.slice(0, 10);
    document.getElementById('f-assignedTime').value       = _dt.slice(11, 16);
    document.getElementById('f-startDate').value          = todo.startDate || '';
    document.getElementById('f-dueDate').value            = todo.dueDate || '';
    document.getElementById('f-status').value             = todo.status   || '進行中';
    document.getElementById('f-priority').value           = todo.priority || '中';
    document.getElementById('f-type').value               = todo.type     || '專案需求';
    document.getElementById('f-description').value        = todo.description || '';
    if (todo.parentId) document.getElementById('f-parentId').value = todo.parentId;
  } else if (parentTask) {
    document.getElementById('modal-title').textContent    = '新增子任務';
    document.getElementById('f-parentId').value           = parentTask.id;
    const _np = now();
    document.getElementById('f-assignedDate').value       = _np.slice(0, 10);
    document.getElementById('f-assignedTime').value       = _np.slice(11, 16);
    document.getElementById('f-status').value             = '進行中';
    parentInfo.textContent = `上層任務：${parentTask.task}`;
    parentInfo.classList.remove('hidden');
  } else {
    document.getElementById('modal-title').textContent    = '新增任務';
    const _ne = now();
    document.getElementById('f-assignedDate').value       = _ne.slice(0, 10);
    document.getElementById('f-assignedTime').value       = _ne.slice(11, 16);
    document.getElementById('f-status').value             = '進行中';
    document.getElementById('f-priority').value           = '中';
    document.getElementById('f-type').value               = '專案需求';
  }

  // Reset and conditionally disable 已完成 for root tasks with unfinished children
  const statusSel = document.getElementById('f-status');
  statusSel.querySelectorAll('option').forEach(o => { o.disabled = false; });
  if (todo && !todo.parentId && todo.status !== '已完成' && hasUnfinishedDescendants(todo.id)) {
    const doneOpt = statusSel.querySelector('option[value="已完成"]');
    if (doneOpt) doneOpt.disabled = true;
  }

  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('f-task').focus(), 50);
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

// ── Form submit ────────────────────────────────────────────
document.getElementById('todo-form').addEventListener('submit', async e => {
  e.preventDefault();
  const taskVal = document.getElementById('f-task').value.trim();
  if (!taskVal) {
    alert('請輸入任務項目');
    document.getElementById('f-task').focus();
    return;
  }

  const id       = document.getElementById('f-id').value;
  const parentId = document.getElementById('f-parentId').value;
  const _d = document.getElementById('f-assignedDate').value;
  const _t = document.getElementById('f-assignedTime').value;
  const payload  = {
    task:         taskVal,
    assignedTo:   document.getElementById('f-assignedTo').value.trim(),
    assignedDate: _d && _t ? `${_d}T${_t}` : _d,
    startDate:    document.getElementById('f-startDate').value,
    dueDate:      document.getElementById('f-dueDate').value,
    status:       document.getElementById('f-status').value,
    priority:     document.getElementById('f-priority').value,
    type:         document.getElementById('f-type').value,
    description:  document.getElementById('f-description').value.trim(),
  };
  if (parentId) payload.parentId = parentId;

  // Block setting root task to 已完成 when descendants are unfinished
  if (!parentId && id && payload.status === '已完成') {
    const original = allTodos.find(t => t.id === id);
    if (original && original.status !== '已完成' && hasUnfinishedDescendants(id)) {
      alert('尚有未完成的子任務，無法設為「已完成」');
      return;
    }
  }

  try {
    if (id) await api('PUT',  `/api/todos/${id}`, payload);
    else    await api('POST', '/api/todos',        payload);
    closeModal();
    await loadTodos();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
});

// ── Search ─────────────────────────────────────────────────
async function doSearch() {
  const params = new URLSearchParams();
  const v = id => document.getElementById(id).value.trim();
  const d = id => document.getElementById(id).value;

  if (v('s-task'))             params.set('task',            v('s-task'));
  if (v('s-assignedTo'))       params.set('assignedTo',      v('s-assignedTo'));
  if (v('s-status'))           params.set('status',          v('s-status'));
  if (d('s-assignedDateFrom')) params.set('assignedDateFrom', d('s-assignedDateFrom'));
  if (d('s-assignedDateTo'))   params.set('assignedDateTo',   d('s-assignedDateTo'));
  if (d('s-startDateFrom'))    params.set('startDateFrom',    d('s-startDateFrom'));
  if (d('s-startDateTo'))      params.set('startDateTo',      d('s-startDateTo'));
  if (d('s-dueDateFrom'))      params.set('dueDateFrom',      d('s-dueDateFrom'));
  if (d('s-dueDateTo'))        params.set('dueDateTo',        d('s-dueDateTo'));

  const container = document.getElementById('search-results');
  container.innerHTML = '<div class="empty-state">查詢中…</div>';

  try {
    const results = await api('GET', `/api/todos/search?${params}`);
    if (results.length === 0) {
      container.innerHTML = '<div class="empty-state">查無符合條件的任務</div>';
      return;
    }

    const idMap = {};
    allTodos.forEach(t => { idMap[t.id] = t; });

    container.innerHTML = results.map(t => {
      const parentLabel = t.parentId && idMap[t.parentId]
        ? `<span class="meta-item">上層:&nbsp;${esc(idMap[t.parentId].task)}</span>` : '';
      const meta = [];
      if (t.assignedTo)  meta.push(`<span class="meta-item">負責人:&nbsp;${esc(t.assignedTo)}</span>`);
      if (t.assignedDate) meta.push(`<span class="meta-item">新增:&nbsp;${esc(t.assignedDate)}</span>`);
      if (t.startDate)   meta.push(`<span class="meta-item">開始:&nbsp;${esc(t.startDate)}</span>`);
      if (t.dueDate)     meta.push(`<span class="meta-item">截止:&nbsp;${esc(t.dueDate)}</span>`);

      const descHtml = t.description
        ? `<div class="task-desc" title="${esc(t.description)}">${esc(t.description)}</div>` : '';

      return `<div class="search-result-row">
  <div class="task-info">
    <div class="task-title">${esc(t.task)}</div>
    ${descHtml}
    <div class="task-meta">${badge(t.status)}${parentLabel}${meta.join('')}</div>
  </div>
  <div class="task-actions">
    <button class="btn btn-sm btn-secondary btn-edit-s" data-id="${esc(t.id)}">編輯</button>
  </div>
</div>`;
    }).join('');

    container.querySelectorAll('.btn-edit-s').forEach(btn => {
      btn.addEventListener('click', () => {
        const todo = allTodos.find(t => t.id === btn.dataset.id);
        if (todo) openModal(todo, null);
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state">查詢失敗：${esc(err.message)}</div>`;
  }
}

// ── Wire-up events ─────────────────────────────────────────

// Top-level tabs（任務管理 / 常用工具 / 異動說明 / 未來新功能）
document.querySelectorAll('.top-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.top-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.top-section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`top-${btn.dataset.top}`).classList.add('active');
  });
});

// Sub-level tabs — 限定在所屬 .top-section 範圍內切換，避免多組頁籤互相干擾
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const scope = btn.closest('.top-section') || document;
    scope.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    scope.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    scope.querySelector(`#tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'manage') { renderUserList(); renderTypeList(); }
  });
});

// Toolbar
document.getElementById('btn-add').addEventListener('click', () => openModal(null, null));

function applyListFilter() {
  listFilter.assignedTo = document.getElementById('filter-assignedTo').value;
  listFilter.status     = document.getElementById('filter-status').value;
  listFilter.priority   = document.getElementById('filter-priority').value;
  listFilter.type       = document.getElementById('filter-type').value;
  renderList();
}
['filter-assignedTo', 'filter-status', 'filter-priority', 'filter-type'].forEach(id => {
  document.getElementById(id).addEventListener('change', applyListFilter);
});

// Sort bar
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const f = btn.dataset.sort;
    if (sortState.field === f) {
      sortState.field = null; // 再次點選 → 回到自定義排序
    } else {
      sortState.field = f;
      sortState.dir   = 'desc';
    }
    updateSortBar();
    renderList();
  });
});

// Task modal
document.getElementById('btn-cancel').addEventListener('click',    closeModal);
document.getElementById('modal-backdrop').addEventListener('click', closeModal);

// User management (inline in 管理作業 tab)
document.getElementById('btn-add-user').addEventListener('click', async () => {
  const input = document.getElementById('new-user-name');
  const name  = input.value.trim();
  if (!name) { input.focus(); return; }
  try {
    await api('POST', '/api/users', { name });
    await loadUsers();
    renderUserList();
    input.value = '';
    input.focus();
  } catch (err) {
    alert('新增失敗：' + err.message);
  }
});

document.getElementById('new-user-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-add-user').click(); }
});

document.getElementById('btn-add-type').addEventListener('click', async () => {
  const input = document.getElementById('new-type-name');
  const name  = input.value.trim();
  if (!name) { input.focus(); return; }
  try {
    await api('POST', '/api/types', { name });
    await loadTypes();
    renderTypeList();
    input.value = '';
    input.focus();
  } catch (err) {
    alert('新增失敗：' + err.message);
  }
});

document.getElementById('new-type-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-add-type').click(); }
});

// Escape closes task modal
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Search
document.getElementById('btn-search').addEventListener('click', doSearch);

document.getElementById('btn-search-clear').addEventListener('click', () => {
  ['s-task','s-assignedTo'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('s-status').value = '';
  ['s-assignedDateFrom','s-assignedDateTo',
   's-startDateFrom','s-startDateTo',
   's-dueDateFrom','s-dueDateTo'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('search-results').innerHTML = '';
});

// ── Init ───────────────────────────────────────────────────
updateSortBar();
loadUsers();
loadTypes();
loadTodos();
