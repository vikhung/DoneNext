'use strict';
const crypto = require('crypto');

// API TEST 指令化變數：
//   ${N(7)}                      → 7 個隨機數字 (0-9)
//   ${AN(10)}                    → 10 個隨機英數字 (0-9, A-Z)
//   ${DATETIME(yyyyMMddhhmmss)}  → 依格式產生目前日期時間 (24 小時制)
// 不認得的 ${...} 一律原樣保留。

const DIGITS = '0123456789';
const ALNUM  = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_RANDOM_LEN = 1000;

const VAR_RE      = /\$\{(N|AN|DATETIME)\(([^)}]*)\)\}/g;
const DATETIME_RE = /yyyy|MM|dd|HH|hh|mm|ss|SSS/g;

function randomChars(charset, len) {
  let out = '';
  for (let i = 0; i < len; i++) out += charset[crypto.randomInt(charset.length)];
  return out;
}

function pad(n, width) { return String(n).padStart(width, '0'); }

function formatDateTime(fmt, now) {
  return fmt.replace(DATETIME_RE, token => {
    switch (token) {
      case 'yyyy': return pad(now.getFullYear(), 4);
      case 'MM':   return pad(now.getMonth() + 1, 2);
      case 'dd':   return pad(now.getDate(), 2);
      case 'HH':
      case 'hh':   return pad(now.getHours(), 2);
      case 'mm':   return pad(now.getMinutes(), 2);
      case 'ss':   return pad(now.getSeconds(), 2);
      case 'SSS':  return pad(now.getMilliseconds(), 3);
      default:     return token;
    }
  });
}

function expand(text, now = new Date()) {
  if (typeof text !== 'string' || !text) return text == null ? '' : String(text);
  return text.replace(VAR_RE, (whole, name, arg) => {
    if (name === 'DATETIME') return formatDateTime(arg, now);
    const a = arg.trim();
    if (!/^\d+$/.test(a)) return whole;
    const len = Number(a);
    if (len < 1 || len > MAX_RANDOM_LEN) return whole;
    return randomChars(name === 'N' ? DIGITS : ALNUM, len);
  });
}

module.exports = { expand, formatDateTime };
