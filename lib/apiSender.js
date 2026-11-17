'use strict';
const http  = require('http');
const https = require('https');
const zlib  = require('zlib');
const { expand } = require('./apiTemplate');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MAX_RAW_BYTES  = 5 * 1024 * 1024;  // 最多保留的原始回應位元組
const MAX_BODY_CHARS = 1024 * 1024;      // 回傳給前端的 body 字元上限

// 「Key: Value」每行一組；空行與 # 開頭略過
function parseHeaderText(text) {
  const pairs = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const idx = t.indexOf(':');
    if (idx <= 0) throw new Error(`Header 格式錯誤（需為 Key: Value）：${t}`);
    pairs.push([t.slice(0, idx).trim(), t.slice(idx + 1).trim()]);
  });
  return pairs;
}

function decodeBody(buf, encoding) {
  if (!buf.length) return buf;
  const opts = { finishFlush: zlib.constants.Z_SYNC_FLUSH };
  try {
    switch (String(encoding || '').toLowerCase().trim()) {
      case 'gzip':
      case 'x-gzip':  return zlib.gunzipSync(buf, opts);
      case 'deflate': return zlib.inflateSync(buf, opts);
      case 'br':      return zlib.brotliDecompressSync(buf, { finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH });
      default:        return buf;
    }
  } catch {
    return buf; // 解壓失敗就顯示原始內容
  }
}

function rawHeaderPairs(raw) {
  const pairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([raw[i], raw[i + 1]]);
  return pairs;
}

// 展開變數並送出一次請求。永不 reject：錯誤以 result.error 回報。
function send(def) {
  return new Promise(resolve => {
    const startedAt = new Date();
    const result = {
      request: null, response: null, durationMs: 0,
      startedAt: startedAt.toISOString(), error: null,
    };
    const fail = message => { result.error = message; resolve(result); };

    let method, target, headerPairs, body;
    try {
      method = String(def.method || 'GET').toUpperCase();
      if (!METHODS.includes(method)) return fail(`不支援的 Method：${method}`);

      const urlText = expand(String(def.url || '').trim(), startedAt);
      body          = expand(def.body == null ? '' : String(def.body), startedAt);
      headerPairs   = parseHeaderText(expand(def.headers == null ? '' : String(def.headers), startedAt));
      result.request = { method, url: urlText, headers: headerPairs, body };

      if (!urlText) return fail('URL 為必填');
      try { target = new URL(urlText); }
      catch { return fail(`URL 格式錯誤：${urlText}`); }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return fail('僅支援 http / https');
      }
    } catch (err) {
      return fail(err.message);
    }

    const timeoutMs = Math.min(300, Math.max(1, Number(def.timeoutSec) || 30)) * 1000;
    const isHttps   = target.protocol === 'https:';
    const bodyBuf   = Buffer.from(body, 'utf8');

    let req;
    let timer = null;
    let settled = false;
    let t0 = process.hrtime.bigint();
    const elapsed = () => Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      result.durationMs = elapsed();
      if (error) result.error = error;
      resolve(result);
    };

    try {
      const options = { method, agent: false };
      if (isHttps) options.rejectUnauthorized = !def.insecureTLS;
      req = (isHttps ? https : http).request(target, options);

      headerPairs.forEach(([k, v]) => req.setHeader(k, v));
      if (bodyBuf.length && !req.hasHeader('content-length') && !req.hasHeader('transfer-encoding')) {
        req.setHeader('Content-Length', bodyBuf.length);
      }
      // 實際送出的 header（含自動補上的 Host、Content-Length）
      result.request.headers = req.getRawHeaderNames().map(name => {
        const v = req.getHeader(name);
        return [name, Array.isArray(v) ? v.join(', ') : String(v)];
      });
      result.request.url = target.href;
    } catch (err) {
      return fail(err.message);
    }

    req.on('response', res => {
      const chunks = [];
      let kept = 0;
      let total = 0;
      res.on('data', chunk => {
        total += chunk.length;
        if (kept < MAX_RAW_BYTES) {
          const part = chunk.length > MAX_RAW_BYTES - kept ? chunk.subarray(0, MAX_RAW_BYTES - kept) : chunk;
          chunks.push(part);
          kept += part.length;
        }
      });
      const done = () => {
        if (settled) return;
        const decoded = decodeBody(Buffer.concat(chunks), res.headers['content-encoding']);
        let text = decoded.toString('utf8');
        let truncated = total > kept;
        if (text.length > MAX_BODY_CHARS) { text = text.slice(0, MAX_BODY_CHARS); truncated = true; }
        result.response = {
          status: res.statusCode,
          statusText: res.statusMessage || '',
          headers: rawHeaderPairs(res.rawHeaders),
          body: text,
          truncated,
        };
        finish(null);
      };
      res.on('end', done);
      res.on('error', err => finish(`讀取回應失敗：${err.message}`));
      res.on('aborted', () => finish('回應中斷'));
    });

    req.on('error', err => {
      // 多位址連線失敗時為 AggregateError，本身 message 為空，改取第一個子錯誤
      const detail = err.message || (Array.isArray(err.errors) && err.errors[0] && err.errors[0].message) || '連線失敗';
      finish(err.code && !detail.includes(err.code) ? `${err.code}：${detail}` : detail);
    });

    timer = setTimeout(() => {
      finish(`逾時（超過 ${timeoutMs / 1000} 秒）`);
      req.destroy();
    }, timeoutMs);

    t0 = process.hrtime.bigint();
    req.end(bodyBuf.length ? bodyBuf : undefined);
  });
}

module.exports = { send, METHODS };
