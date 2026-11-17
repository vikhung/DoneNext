'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { METHODS } = require('./apiSender');

// API TEST 類別（Collection）儲存：一個類別一個檔 data/apitest/<類別名稱>.json
const DIR = path.resolve(__dirname, '..', 'data', 'apitest');
const EXT = '.json';
const MAX_NAME_LEN = 50;
const RESERVED_RE  = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const FORBIDDEN_RE = /[\\/:*?"<>|\u0000-\u001f]/;

function isValidName(name) {
  if (typeof name !== 'string') return false;
  if (!name || name !== name.trim()) return false;
  if (name.length > MAX_NAME_LEN) return false;
  if (FORBIDDEN_RE.test(name)) return false;
  if (name.includes('..') || name.startsWith('.') || name.endsWith('.')) return false;
  if (RESERVED_RE.test(name)) return false;
  // 最後防線：解析後的路徑必須仍在 DIR 之下
  return path.dirname(path.resolve(DIR, name + EXT)) === DIR;
}

function fileOf(name) { return path.join(DIR, name + EXT); }

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeApi(api) {
  const a = api && typeof api === 'object' ? api : {};
  const method = String(a.method || 'GET').toUpperCase();
  const count  = Math.floor(clamp(a.count, 1, 1000, 1));
  return {
    id:          typeof a.id === 'string' && a.id ? a.id : crypto.randomUUID(),
    name:        String(a.name || '').trim().slice(0, 100) || '未命名 API',
    method:      METHODS.includes(method) ? method : 'GET',
    url:         String(a.url || '').trim(),
    headers:     String(a.headers || ''),
    body:        String(a.body || ''),
    count,
    concurrency: Math.min(count, Math.floor(clamp(a.concurrency, 1, 50, 1))),
    intervalSec: clamp(a.intervalSec, 0, 3600, 0),
    timeoutSec:  clamp(a.timeoutSec, 1, 300, 30),
    insecureTLS: !!a.insecureTLS,
  };
}

function readFile(name) {
  try {
    const data = JSON.parse(fs.readFileSync(fileOf(name), 'utf8'));
    return {
      name, // 以檔名為準
      updatedAt: data.updatedAt || null,
      apis: Array.isArray(data.apis) ? data.apis.map(normalizeApi) : [],
    };
  } catch {
    return null;
  }
}

function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter(f => f.toLowerCase().endsWith(EXT))
    .map(f => f.slice(0, -EXT.length))
    .filter(isValidName)
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    .map(readFile)
    .filter(Boolean);
}

function exists(name) {
  return isValidName(name) && fs.existsSync(fileOf(name));
}

function save(name, body) {
  if (!isValidName(name)) return null;
  const collection = {
    name,
    updatedAt: new Date().toISOString(),
    apis: Array.isArray(body && body.apis) ? body.apis.map(normalizeApi) : [],
  };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileOf(name), JSON.stringify(collection, null, 2), 'utf8');
  return collection;
}

// 類別改名 = 檔案改名。回傳改名後的類別；新名稱已被其他類別佔用時回傳 null。
// 檔名比對不分大小寫（Windows 檔案系統不分大小寫，避免覆寫既有檔案），但允許只改自己的大小寫。
function rename(oldName, newName) {
  if (!exists(oldName) || !isValidName(newName)) return null;
  if (oldName === newName) return readFile(oldName);
  const oldFile = (oldName + EXT).toLowerCase();
  const newFile = (newName + EXT).toLowerCase();
  const taken = fs.readdirSync(DIR).some(f => f.toLowerCase() === newFile && f.toLowerCase() !== oldFile);
  if (taken) return null;

  const current = readFile(oldName);
  if (!current) return null;
  fs.renameSync(fileOf(oldName), fileOf(newName));
  return save(newName, current);
}

function remove(name) {
  if (!exists(name)) return false;
  fs.unlinkSync(fileOf(name));
  return true;
}

module.exports = { list, exists, save, rename, remove, isValidName };
