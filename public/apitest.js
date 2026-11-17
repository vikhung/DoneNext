'use strict';

// API TEST：API 測試工具（類似 Postman Collection Runner）
// - 類別（Collection）存於 data/apitest/<類別名稱>.json，一個類別含多支 API
// - 請求由伺服器代發（POST /api/apitest/send），變數 ${N()} / ${AN()} / ${DATETIME()} 於伺服器端展開
// - 批次發送由瀏覽器編排：N 位虛擬使用者同時起跑，各自循序發送並於每次之間休息
// 沿用 app.js 的全域 api() 與 esc()。

const AT_API_DEFAULTS = {
  name: '新 API', method: 'GET', url: '', headers: '', body: '',
  count: 1, concurrency: 1, intervalSec: 0, timeoutSec: 30, insecureTLS: false,
};

let atCollections = [];                         // [{ name, apis: [...] }]
let atCurrent = { colName: null, apiId: null }; // 目前編輯中的 API
let atDirty = false;
let atRenamingCol = null;                       // 正在改名的類別名稱
let atResults = [];                             // 畫面上所有執行的結果，跨次累積（供展開時延遲渲染）
let atRunNo = 0;                                // 第幾次執行（清除結果後歸零）
let atRun = null;                               // { stop, total, wakers:Set }

const atEl = id => document.getElementById(id);

// ── 資料存取 ───────────────────────────────────────────────
function atFindCol(name) { return atCollections.find(c => c.name === name); }

function atCurrentApi() {
  const col = atFindCol(atCurrent.colName);
  return col ? col.apis.find(a => a.id === atCurrent.apiId) : null;
}

async function atLoad() {
  try {
    atCollections = await api('GET', '/api/apitest/collections');
  } catch (err) {
    atCollections = [];
    atEl('at-tree').innerHTML = `<div class="tool-error">載入失敗：${esc(err.message)}</div>`;
    return;
  }
  atRenderTree();
}

async function atSaveCol(col) {
  const saved = await api('PUT', `/api/apitest/collections/${encodeURIComponent(col.name)}`, { apis: col.apis });
  const idx = atCollections.findIndex(c => c.name === col.name);
  if (idx === -1) atCollections.push(saved); else atCollections[idx] = saved;
  atCollections.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return saved;
}

// ── 側欄 ───────────────────────────────────────────────────
function atRenderTree() {
  const tree = atEl('at-tree');
  if (!atCollections.length) {
    tree.innerHTML = '<div class="at-tree-empty">尚無類別</div>';
    return;
  }
  tree.innerHTML = atCollections.map(col => `
    <div class="at-col">
      ${col.name === atRenamingCol ? `
      <div class="at-col-head">
        <input type="text" class="at-rename-input" data-col="${esc(col.name)}" value="${esc(col.name)}" maxlength="50">
        <button type="button" class="btn btn-primary btn-sm" data-act="rename-ok" data-col="${esc(col.name)}" title="確定改名">✓</button>
        <button type="button" class="btn btn-secondary btn-sm" data-act="rename-cancel" data-col="${esc(col.name)}" title="取消">✕</button>
      </div>` : `
      <div class="at-col-head">
        <span class="at-col-name" title="${esc(col.name)}">📁 ${esc(col.name)}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-act="add-api" data-col="${esc(col.name)}">+ API</button>
        <button type="button" class="btn btn-secondary btn-sm" data-act="rename" data-col="${esc(col.name)}" title="修改類別名稱">✎</button>
        <button type="button" class="btn btn-danger btn-sm" data-act="del-col" data-col="${esc(col.name)}">刪除</button>
      </div>`}
      ${col.apis.length ? col.apis.map(a => `
        <div class="at-api${col.name === atCurrent.colName && a.id === atCurrent.apiId ? ' active' : ''}"
             data-act="open-api" data-col="${esc(col.name)}" data-id="${esc(a.id)}">
          <span class="at-api-method at-m-${esc(a.method.toLowerCase())}">${esc(a.method)}</span>
          <span class="at-api-name" title="${esc(a.name)}">${esc(a.name)}</span>
          <button type="button" class="at-api-del" data-act="del-api" data-col="${esc(col.name)}" data-id="${esc(a.id)}" title="刪除此 API">✕</button>
        </div>`).join('') : '<div class="at-tree-empty">尚無 API</div>'}
    </div>`).join('');
}

// 類別改名（同時改檔名）；編輯中的 API 若屬於該類別，一併跟著指向新名稱
async function atRenameCol(oldName, rawName) {
  const newName = String(rawName || '').trim();
  if (!newName || newName === oldName) {
    atRenamingCol = null;
    atRenderTree();
    return;
  }
  try {
    const renamed = await api('POST', `/api/apitest/collections/${encodeURIComponent(oldName)}/rename`, { newName });
    const idx = atCollections.findIndex(c => c.name === oldName);
    if (idx !== -1) atCollections[idx] = renamed;
    atCollections.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    if (atCurrent.colName === oldName) {
      atCurrent.colName = renamed.name;
      atEl('at-editor-path').textContent = `📁 ${renamed.name}`;
    }
    atRenamingCol = null;
    atRenderTree();
  } catch (err) {
    alert('改名失敗：' + err.message);
  }
}

function atStartRename(colName) {
  atRenamingCol = colName;
  atRenderTree();
  const input = atEl('at-tree').querySelector('.at-rename-input');
  if (input) { input.focus(); input.select(); }
}

atEl('at-tree').addEventListener('keydown', e => {
  if (!e.target.classList.contains('at-rename-input')) return;
  if (e.key === 'Enter') atRenameCol(e.target.dataset.col, e.target.value);
  else if (e.key === 'Escape') { atRenamingCol = null; atRenderTree(); }
});

function atConfirmDiscard() {
  return !atDirty || confirm('目前的修改尚未儲存，確定要放棄嗎？');
}

atEl('at-tree').addEventListener('click', async e => {
  const target = e.target.closest('[data-act]');
  if (!target) return;
  const { act, col: colName, id } = target.dataset;
  const col = atFindCol(colName);
  if (!col) return;

  try {
    if (act === 'rename') {
      atStartRename(colName);
    } else if (act === 'rename-ok') {
      await atRenameCol(colName, atEl('at-tree').querySelector('.at-rename-input').value);
    } else if (act === 'rename-cancel') {
      atRenamingCol = null;
      atRenderTree();
    } else if (act === 'open-api') {
      if (colName === atCurrent.colName && id === atCurrent.apiId) return;
      if (!atConfirmDiscard()) return;
      atOpenApi(colName, id);
    } else if (act === 'add-api') {
      if (!atConfirmDiscard()) return;
      const before = new Set(col.apis.map(a => a.id));
      const saved = await atSaveCol({ name: col.name, apis: [...col.apis, { ...AT_API_DEFAULTS }] });
      const created = saved.apis.find(a => !before.has(a.id));
      atOpenApi(saved.name, created.id);
    } else if (act === 'del-api') {
      const doomed = col.apis.find(a => a.id === id);
      if (!doomed || !confirm(`確定刪除 API「${doomed.name}」？`)) return;
      await atSaveCol({ name: col.name, apis: col.apis.filter(a => a.id !== id) });
      if (atCurrent.colName === colName && atCurrent.apiId === id) atCloseEditor();
      atRenderTree();
    } else if (act === 'del-col') {
      if (!confirm(`確定刪除類別「${col.name}」？其下 ${col.apis.length} 支 API 會一併刪除。`)) return;
      await api('DELETE', `/api/apitest/collections/${encodeURIComponent(col.name)}`);
      atCollections = atCollections.filter(c => c.name !== col.name);
      if (atCurrent.colName === colName) atCloseEditor();
      atRenderTree();
    }
  } catch (err) {
    alert('操作失敗：' + err.message);
  }
});

async function atAddCollection() {
  const input = atEl('at-new-col-name');
  const name = input.value.trim();
  if (!name) return;
  // Windows 檔名不分大小寫，避免覆寫既有類別
  if (atCollections.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    alert('類別已存在');
    return;
  }
  try {
    await atSaveCol({ name, apis: [] });
    input.value = '';
    atRenderTree();
  } catch (err) {
    alert('新增失敗：' + err.message);
  }
}

atEl('at-btn-add-col').addEventListener('click', atAddCollection);
atEl('at-new-col-name').addEventListener('keydown', e => { if (e.key === 'Enter') atAddCollection(); });

// ── 編輯區 ─────────────────────────────────────────────────
function atOpenApi(colName, apiId) {
  atCurrent = { colName, apiId };
  const a = atCurrentApi();
  if (!a) return atCloseEditor();

  atEl('at-editor-path').textContent = `📁 ${colName}`;
  atEl('at-name').value        = a.name;
  atEl('at-method').value      = a.method;
  atEl('at-url').value         = a.url;
  atEl('at-headers').value     = a.headers;
  atEl('at-body').value        = a.body;
  atEl('at-count').value       = a.count;
  atEl('at-concurrency').value = a.concurrency;
  atEl('at-interval').value    = a.intervalSec;
  atEl('at-timeout').value     = a.timeoutSec;
  atEl('at-insecure').checked  = a.insecureTLS;

  atDirty = false;
  atShowMsg('');
  atEl('at-saved').classList.add('at-hidden');
  atEl('at-empty').classList.add('at-hidden');
  atEl('at-editor').classList.remove('at-hidden');
  atUpdatePlan();
  atRenderTree();
}

function atCloseEditor() {
  atCurrent = { colName: null, apiId: null };
  atDirty = false;
  atEl('at-editor').classList.add('at-hidden');
  atEl('at-empty').classList.remove('at-hidden');
}

function atClampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function atReadForm() {
  const count = Math.floor(atClampNum(atEl('at-count').value, 1, 1000, 1));
  return {
    name:        atEl('at-name').value.trim() || '未命名 API',
    method:      atEl('at-method').value,
    url:         atEl('at-url').value.trim(),
    headers:     atEl('at-headers').value,
    body:        atEl('at-body').value,
    count,
    concurrency: Math.min(count, Math.floor(atClampNum(atEl('at-concurrency').value, 1, 50, 1))),
    intervalSec: atClampNum(atEl('at-interval').value, 0, 3600, 0),
    timeoutSec:  atClampNum(atEl('at-timeout').value, 1, 300, 30),
    insecureTLS: atEl('at-insecure').checked,
  };
}

// 把 count 筆分給 users 位使用者：平均分配，餘數由前幾位各多 1 筆
function atSplitCounts(count, users) {
  const base = Math.floor(count / users);
  const extra = count % users;
  return Array.from({ length: users }, (_, i) => base + (i < extra ? 1 : 0));
}

function atUpdatePlan() {
  const f = atReadForm();
  const parts = atSplitCounts(f.count, f.concurrency);
  const per = parts[0] === parts[parts.length - 1] ? `各 ${parts[0]} 次` : `${parts[parts.length - 1]}–${parts[0]} 次`;
  const rest = f.intervalSec > 0 ? `，每次發送後休息 ${f.intervalSec} 秒` : '，連續發送不休息';
  atEl('at-plan').textContent = f.concurrency > 1
    ? `共 ${f.count} 筆，由 ${f.concurrency} 人同時發送（每人${per}）${rest}`
    : `共 ${f.count} 筆，循序發送${rest}`;
}

function atShowMsg(message) {
  const el = atEl('at-msg');
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

atEl('at-editor').addEventListener('input', () => {
  atDirty = true;
  atEl('at-saved').classList.add('at-hidden');
  atUpdatePlan();
});

atEl('at-btn-save').addEventListener('click', async () => {
  const col = atFindCol(atCurrent.colName);
  if (!col || !atCurrentApi()) return;
  const form = atReadForm();
  const apis = col.apis.map(a => (a.id === atCurrent.apiId ? { ...a, ...form } : a));
  try {
    await atSaveCol({ name: col.name, apis });
    atDirty = false;
    atShowMsg('');
    atEl('at-saved').classList.remove('at-hidden');
    atRenderTree();
  } catch (err) {
    atShowMsg('儲存失敗：' + err.message);
  }
});

// ── 批次發送 ───────────────────────────────────────────────
function atSleep(ms) {
  return new Promise(resolve => {
    if (!atRun || atRun.stop || ms <= 0) return resolve();
    const waker = () => { clearTimeout(timer); atRun.wakers.delete(waker); resolve(); };
    const timer = setTimeout(waker, ms);
    atRun.wakers.add(waker);
  });
}

async function atRunBatch() {
  if (atRun) return;
  const form = atReadForm();
  if (!form.url) { atShowMsg('請輸入 URL'); return; }
  atShowMsg('');

  const payload = {
    method: form.method, url: form.url, headers: form.headers, body: form.body,
    timeoutSec: form.timeoutSec, insecureTLS: form.insecureTLS,
  };
  // 重複發送時不清除先前結果：每次執行以標題列開頭、總結區塊結尾，接續在清單後方
  const run = {
    stop: false, total: form.count, wakers: new Set(), label: `${form.method} ${form.name}`,
    no: ++atRunNo, startIdx: atResults.length, startedMs: Date.now(),
  };
  atRun = run;
  const setting = `${form.count} 筆／${form.concurrency} 人併發／間隔 ${form.intervalSec} 秒`;
  atAppendHtml(`
    <div class="at-run-head">
      <span class="at-run-no">第 ${run.no} 次執行</span>
      <span class="at-run-label">${esc(run.label)}</span>
      <span class="at-run-setting">${esc(setting)}</span>
      <span class="at-time">${esc(atFormatTime(new Date().toISOString()))}</span>
    </div>`, true);
  atEl('at-btn-send').disabled = true;
  atEl('at-btn-stop').disabled = false;
  atRenderSummary();

  let seq = 0;
  const worker = async (user, times) => {
    for (let i = 0; i < times && !run.stop; i++) {
      const no = ++seq;
      let result;
      try {
        result = await api('POST', '/api/apitest/send', payload);
      } catch (err) {
        result = { request: null, response: null, durationMs: 0, startedAt: new Date().toISOString(), error: '無法連線到本站伺服器：' + err.message };
      }
      result.seq = no;
      result.user = user;
      atAppendResult(result);
      if (i < times - 1 && !run.stop) await atSleep(form.intervalSec * 1000);
    }
  };

  const counts = atSplitCounts(form.count, form.concurrency);
  await Promise.all(counts.map((times, i) => worker(i + 1, times)));

  run.finished = true;
  run.elapsedMs = Date.now() - run.startedMs;
  atAppendHtml(atRunSummaryHtml(run));
  atRun = null;
  atEl('at-btn-send').disabled = false;
  atEl('at-btn-stop').disabled = true;
  atRenderSummary(run);
}

atEl('at-btn-send').addEventListener('click', atRunBatch);

atEl('at-btn-stop').addEventListener('click', () => {
  if (!atRun) return;
  atRun.stop = true;
  [...atRun.wakers].forEach(wake => wake());
  atEl('at-btn-stop').disabled = true;
});

atEl('at-btn-clear').addEventListener('click', () => {
  atEl('at-results').innerHTML = '';
  if (!atRun) {
    atResults = [];
    atRunNo = 0;
    atEl('at-summary').innerHTML = '';
  }
});

// ── 結果呈現 ───────────────────────────────────────────────
// 2xx 綠、3xx 藍、4xx 黃、5xx 紅；連線失敗/逾時（無狀態碼）另以 err 呈現
function atStatusClass(result) {
  if (!result.response) return 'at-err';
  const s = result.response.status;
  if (s >= 200 && s < 300) return 'at-2xx';
  if (s >= 300 && s < 400) return 'at-3xx';
  if (s >= 400 && s < 500) return 'at-4xx';
  if (s >= 500 && s < 600) return 'at-5xx';
  return 'at-other';
}

function atFormatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// 結果區為固定高度的捲動區塊：使用者停在底部時自動跟到最新內容，往上翻閱時不打擾
function atAppendHtml(html, forceScroll) {
  const list = atEl('at-results');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.insertAdjacentHTML('beforeend', html);
  if (forceScroll || atBottom) list.scrollTop = list.scrollHeight;
}

function atRunResults(run) {
  return atResults.slice(run.startIdx);
}

function atSec(ms) { return (ms / 1000).toFixed(3); }

// 毫秒時間戳 → HH:mm:ss
function atClock(ms) { return atFormatTime(new Date(ms).toISOString()).slice(0, 8); }

// 每次執行結束後附在該次最後一筆結果之後的總結；成功 = 狀態碼 200，其餘（含無回應）皆算失敗
function atRunSummaryHtml(run) {
  const results = atRunResults(run);
  const sent = results.length;
  const ok = results.filter(r => r.response && r.response.status === 200).length;
  const times = results.filter(r => r.response).map(r => r.durationMs);

  const dist = new Map();
  results.forEach(r => {
    const key = r.response ? String(r.response.status) : '無回應';
    dist.set(key, (dist.get(key) || 0) + 1);
  });
  const distText = [...dist.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant', { numeric: true }))
    .map(([k, n]) => `${k} × ${n}`).join('、');

  const stopped = sent < run.total;
  const timing = times.length
    ? `平均 <b>${atSec(times.reduce((a, b) => a + b, 0) / times.length)}</b> 秒回應｜最大 <b>${atSec(Math.max(...times))}</b> 秒｜最小 <b>${atSec(Math.min(...times))}</b> 秒`
      + (times.length < sent ? `（僅計有回應的 ${times.length} 筆）` : '')
    : '無任何回應，無法統計回應時間';

  return `
    <div class="at-run-summary">
      <div class="at-run-summary-title">第 ${run.no} 次執行總結｜${esc(run.label)}${stopped ? '（已停止）' : ''}</div>
      <div>本次共發送 <b>${sent}</b> 筆${stopped ? `（預定 ${run.total} 筆）` : ''}</div>
      <div title="從按下「發送」到全部完成的時間，包含各筆之間的間隔等待，以及瀏覽器與本站之間的傳輸">執行區間：<b>${esc(atClock(run.startedMs))} - ${esc(atClock(run.startedMs + run.elapsedMs))}</b>（歷時 ${atSec(run.elapsedMs)} 秒，含間隔等待與本站轉送）</div>
      <div>${timing}</div>
      <div><span class="at-sum-ok"><b>${ok}</b> 筆成功（200）</span>　<span class="at-sum-fail${sent - ok ? '' : ' at-sum-zero'}"><b>${sent - ok}</b> 筆失敗（非 200）</span></div>
      <div class="at-sum-dist">狀態碼分布：${esc(distText) || '—'}</div>
    </div>`;
}

function atAppendResult(result) {
  const idx = atResults.push(result) - 1;
  const statusText = result.response
    ? `${result.response.status} ${result.response.statusText}`.trim()
    : '失敗';
  const html = `
    <div class="at-result ${atStatusClass(result)}" data-idx="${idx}">
      <div class="at-result-head">
        <span class="at-toggle">▶</span>
        <span class="at-seq">#${result.seq}</span>
        <span class="at-user">使用者 ${result.user}</span>
        <span class="at-status">${esc(statusText)}</span>
        <span class="at-result-msg">${result.error ? esc(result.error) : ''}</span>
        <span class="at-ms">${esc(result.durationMs)} ms</span>
        <span class="at-time">${esc(atFormatTime(result.startedAt))}</span>
      </div>
      <div class="at-result-body at-hidden"></div>
    </div>`;
  atAppendHtml(html);
  atRenderSummary();
}

function atHeaderText(pairs) {
  return (pairs || []).map(([k, v]) => `${k}: ${v}`).join('\n');
}

function atPrettyBody(text) {
  const t = String(text || '');
  const first = t.trimStart()[0];
  if (first === '{' || first === '[') {
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch { /* 非 JSON，原樣顯示 */ }
  }
  return t;
}

function atBlock(title, text) {
  const body = text ? esc(text) : '<span class="at-none">（無）</span>';
  return `<div class="at-block"><div class="at-block-title">${esc(title)}</div><pre>${body}</pre></div>`;
}

function atDetailHtml(result) {
  const req = result.request;
  const res = result.response;
  let html = '';
  if (req) {
    html += `<div class="at-line">${esc(req.method)} ${esc(req.url)}</div>`;
    html += atBlock('Request Header', atHeaderText(req.headers));
    html += atBlock('Request Body', req.body);
  }
  if (res) {
    html += atBlock('Response Header', atHeaderText(res.headers));
    html += atBlock('Response Body' + (res.truncated ? '（內容過長，已截斷）' : ''), atPrettyBody(res.body));
  } else {
    html += atBlock('錯誤訊息', result.error || '未知錯誤');
  }
  return html;
}

atEl('at-results').addEventListener('click', e => {
  const head = e.target.closest('.at-result-head');
  if (!head) return;
  const row = head.parentElement;
  const body = row.querySelector('.at-result-body');
  const result = atResults[Number(row.dataset.idx)];
  if (!result) return;
  if (!body.dataset.rendered) {
    body.innerHTML = atDetailHtml(result);
    body.dataset.rendered = '1';
  }
  const open = body.classList.toggle('at-hidden') === false;
  head.querySelector('.at-toggle').textContent = open ? '▼' : '▶';
});

function atRenderSummary(finishedRun) {
  const run = atRun || finishedRun;
  if (!run) return;
  const counts = { 'at-2xx': 0, 'at-3xx': 0, 'at-4xx': 0, 'at-5xx': 0, 'at-err': 0, 'at-other': 0 };
  const times = [];
  const results = atRunResults(run);
  results.forEach(r => {
    counts[atStatusClass(r)]++;
    if (r.response) times.push(r.durationMs);
  });
  const state = run.finished
    ? (results.length < run.total ? '已停止' : '已完成')
    : (run.stop ? '停止中…' : '執行中…');
  const chip = (cls, label) => counts[cls] ? `<span class="at-chip ${cls}">${label} ${counts[cls]}</span>` : '';
  const timing = times.length
    ? `<span class="at-timing">平均 ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)} ms｜最小 ${Math.min(...times)} ms｜最大 ${Math.max(...times)} ms</span>`
    : '';
  atEl('at-summary').innerHTML = `
    <span class="at-summary-title">第 ${run.no} 次｜${esc(run.label)}</span>
    <span class="at-progress">${state} ${results.length} / ${run.total}</span>
    ${chip('at-2xx', '2xx')}${chip('at-3xx', '3xx')}${chip('at-4xx', '4xx')}${chip('at-5xx', '5xx')}${chip('at-other', '其他')}${chip('at-err', '失敗')}
    ${timing}`;
}

atLoad();
