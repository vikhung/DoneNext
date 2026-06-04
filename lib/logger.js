'use strict';
const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

function getLogPath() {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(LOGS_DIR, `${today}.log`);
}

function formatDateTime() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function write(level, message, payload) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const payloadStr = payload ? ` | ${JSON.stringify(payload)}` : '';
  const line = `[${formatDateTime()}] [${level}] ${message}${payloadStr}\n`;
  fs.appendFileSync(getLogPath(), line, 'utf8');
}

module.exports = {
  info:  (msg, payload) => write('INFO',  msg, payload),
  warn:  (msg, payload) => write('WARN',  msg, payload),
  error: (msg, payload) => write('ERROR', msg, payload),
};
