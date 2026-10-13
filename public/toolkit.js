'use strict';

// 常用工具：JSON Viewer + Base64 編解碼
// 純前端文字轉換，不依賴任何 API；沿用 app.js 定義的全域 esc() 做 XSS 逃逸。

// ── JSON Viewer ────────────────────────────────────────────
const JSON_MAX_CHILDREN = 500;
const JSON_AUTO_EXPAND_DEPTH = 2;

let jsonCurrentData = undefined;
let jsonExpandOverrides = new Map(); // path -> boolean
let jsonDebounceTimer = null;

function jsonIsExpanded(path, depth) {
  if (jsonExpandOverrides.has(path)) return jsonExpandOverrides.get(path);
  return depth < JSON_AUTO_EXPAND_DEPTH;
}

function jsonRenderPrimitive(value) {
  if (value === null) return `<span class="json-null">null</span>`;
  const t = typeof value;
  if (t === 'string')  return `<span class="json-string">"${esc(value)}"</span>`;
  if (t === 'number')  return `<span class="json-number">${esc(String(value))}</span>`;
  if (t === 'boolean') return `<span class="json-boolean">${value}</span>`;
  return '';
}

function jsonRenderNode(key, value, path, depth) {
  const keyHtml = key === null ? '' : `<span class="json-key">${esc(key)}</span><span class="json-punct">: </span>`;
  const isContainer = value !== null && typeof value === 'object';

  if (!isContainer) {
    return `<div class="json-row">${keyHtml}${jsonRenderPrimitive(value)}</div>`;
  }

  const isArray  = Array.isArray(value);
  const entries  = isArray ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  const count    = entries.length;
  const expanded = jsonIsExpanded(path, depth);
  const summary  = isArray ? `Array[${count}]` : `Object{${count}}`;

  let html = `<div class="json-row">`;
  html += count === 0
    ? `<span class="json-toggle-spacer"></span>`
    : `<button type="button" class="json-toggle" data-path="${esc(path)}" data-depth="${depth}">${expanded ? '−' : '+'}</button>`;
  html += keyHtml;
  html += `<span class="json-summary">${esc(summary)}</span>`;
  html += `</div>`;

  if (expanded && count > 0) {
    const limited = entries.slice(0, JSON_MAX_CHILDREN);
    html += `<div class="json-node">`;
    html += limited.map(([k, v]) =>
      jsonRenderNode(k, v, isArray ? `${path}[${k}]` : `${path}.${k}`, depth + 1)
    ).join('');
    if (count > JSON_MAX_CHILDREN) {
      html += `<div class="json-row json-summary">…還有 ${count - JSON_MAX_CHILDREN} 筆未顯示</div>`;
    }
    html += `</div>`;
  }
  return html;
}

function jsonRenderTree() {
  document.getElementById('json-tree').innerHTML = jsonRenderNode(null, jsonCurrentData, 'root', 0);
}

function jsonShowEmpty() {
  document.getElementById('json-tree').innerHTML = '<div class="empty-state">貼上 JSON 內容以檢視樹狀結構</div>';
}

function jsonHandleInput() {
  const text     = document.getElementById('json-input').value.trim();
  const errorEl  = document.getElementById('json-error');

  if (!text) {
    errorEl.classList.add('hidden');
    jsonCurrentData = undefined;
    jsonShowEmpty();
    return;
  }

  try {
    jsonCurrentData = JSON.parse(text);
    jsonExpandOverrides.clear();
    errorEl.classList.add('hidden');
    jsonRenderTree();
  } catch (err) {
    errorEl.textContent = 'JSON 格式錯誤：' + err.message;
    errorEl.classList.remove('hidden');
  }
}

document.getElementById('json-input').addEventListener('input', () => {
  clearTimeout(jsonDebounceTimer);
  jsonDebounceTimer = setTimeout(jsonHandleInput, 250);
});

document.getElementById('json-tree').addEventListener('click', e => {
  const btn = e.target.closest('.json-toggle');
  if (!btn) return;
  const path  = btn.dataset.path;
  const depth = Number(btn.dataset.depth);
  jsonExpandOverrides.set(path, !jsonIsExpanded(path, depth));
  jsonRenderTree();
});

// ── Base64 編解碼 ──────────────────────────────────────────
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function base64ToUtf8(str) {
  let bin;
  try {
    bin = atob(str.trim());
  } catch {
    throw new Error('不是有效的 Base64 字串');
  }
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('內容不是有效的 UTF-8 編碼');
  }
}

function b64ShowError(message) {
  const errorEl = document.getElementById('b64-error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function b64ClearError() {
  document.getElementById('b64-error').classList.add('hidden');
}

document.getElementById('btn-b64-encode').addEventListener('click', () => {
  try {
    document.getElementById('b64-encoded').value = utf8ToBase64(document.getElementById('b64-plain').value);
    b64ClearError();
  } catch (err) {
    b64ShowError('編碼失敗：' + err.message);
  }
});

document.getElementById('btn-b64-decode').addEventListener('click', () => {
  try {
    document.getElementById('b64-plain').value = base64ToUtf8(document.getElementById('b64-encoded').value);
    b64ClearError();
  } catch (err) {
    b64ShowError('解碼失敗：' + err.message);
  }
});

document.getElementById('btn-b64-clear').addEventListener('click', () => {
  document.getElementById('b64-plain').value = '';
  document.getElementById('b64-encoded').value = '';
  b64ClearError();
});
