'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'types.json');
const DEFAULTS = ['專案需求', '系統維運', '注意事項'];

function readAll() {
  if (!fs.existsSync(DATA_FILE)) return [...DEFAULTS];
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return [...DEFAULTS]; }
}

function writeAll(types) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(types, null, 2), 'utf8');
}

function getAll() { return readAll(); }

function add(name) {
  const types = readAll();
  const n = name.trim();
  if (!n || types.includes(n)) return null;
  types.push(n);
  writeAll(types);
  return n;
}

function remove(name) {
  const types = readAll();
  const idx = types.indexOf(name);
  if (idx === -1) return false;
  types.splice(idx, 1);
  writeAll(types);
  return true;
}

module.exports = { getAll, add, remove };
