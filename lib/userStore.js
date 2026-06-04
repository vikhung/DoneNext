'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

function readAll() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function writeAll(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function getAll() { return readAll(); }

function add(name) {
  const users = readAll();
  const n = name.trim();
  if (!n || users.includes(n)) return null;
  users.push(n);
  writeAll(users);
  return n;
}

function remove(name) {
  const users = readAll();
  const idx = users.indexOf(name);
  if (idx === -1) return false;
  users.splice(idx, 1);
  writeAll(users);
  return true;
}

module.exports = { getAll, add, remove };
