'use strict';
// API 设计台 —— 本地服务
// 功能：1) 提供静态页面 public/  2) 持久化 IDL 项目 /api/project
// 仅绑定 127.0.0.1。IDL 的编译（OpenAPI / protobuf）在浏览器端完成，服务端只做保存。

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const HOST = '127.0.0.1';
const PORT = process.env.PORT ? Number(process.env.PORT) : 8010;
const PROJECT_FILE = path.join(ROOT, 'project.json');

function readProject() {
  if (!fs.existsSync(PROJECT_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(PROJECT_FILE, 'utf8')); }
  catch (e) { console.error('[project] 读取 project.json 失败：', e.message); return null; }
}
function writeProject(data) {
  fs.writeFileSync(PROJECT_FILE, JSON.stringify(data, null, 2), 'utf8');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 20 * 1024 * 1024) { req.destroy(); reject(new Error('body 过大')); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function start() {
  console.log('API 设计台（IDL -> OpenAPI / protobuf）');
  console.log('  打开     : http://' + HOST + ':' + PORT);

  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url, 'http://' + HOST + ':' + PORT);
      const pathname = urlObj.pathname;

      if (pathname === '/api/project' && req.method === 'GET') {
        return sendJSON(res, 200, { ok: true, project: readProject() });
      }
      if (pathname === '/api/project' && req.method === 'POST') {
        let p = {};
        try { p = JSON.parse((await readBody(req)) || '{}'); }
        catch (e) { return sendJSON(res, 400, { error: 'bad_request', message: '请求体不是有效 JSON' }); }
        writeProject(p.project);
        return sendJSON(res, 200, { ok: true });
      }
      if (pathname === '/api/health') {
        return sendJSON(res, 200, { ok: true });
      }
      // 提供 js-yaml 浏览器版给前端做 YAML 源码解析/序列化
      if (pathname === '/vendor/js-yaml.min.js') {
        const yp = path.join(ROOT, 'node_modules', 'js-yaml', 'dist', 'js-yaml.min.js');
        if (fs.existsSync(yp)) {
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
          return fs.createReadStream(yp).pipe(res);
        }
      }

      let filePath = pathname === '/' ? '/index.html' : pathname;
      filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
      const full = path.join(PUBLIC, filePath);
      if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('not found');
      }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(full).pipe(res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('server error: ' + e.message);
    }
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error('端口 ' + PORT + ' 已被占用，请用 PORT=8011 npm start 换端口');
      process.exit(1);
    }
    throw e;
  });
  server.listen(PORT, HOST);
}

start();
