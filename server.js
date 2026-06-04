'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const router = require('./lib/router');
const logger = require('./lib/logger');

const PORT = process.argv[2] || process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  const filePath = path.resolve(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath.slice(1));

  // Prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    return res.end('Not Found');
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  logger.info(`${req.method} ${req.url}`);

  if (req.url.startsWith('/api/')) {
    try {
      await router.handle(req, res);
    } catch (err) {
      logger.error('Unhandled error', { message: err.message, stack: err.stack });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '伺服器內部錯誤' }));
    }
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  console.log(`TodoList 站台啟動於 http://localhost:${PORT}`);
});
