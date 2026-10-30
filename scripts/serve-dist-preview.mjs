#!/usr/bin/env node
/**
 * 生产构建静态预览服务 + /api/v1 代理
 *
 * 用途：把 `npm run build` 的产物用真实生产形态（压缩、分包）跑起来，
 * 让 console 扫描能覆盖「只在生产构建复现」的问题（例如 setup 期 TDZ）。
 * vite preview 不带 /api 代理，页面会因接口全挂而刷出一堆假错误，
 * 所以这里自建一个最小静态服务 + 原生代理。
 *
 * 用法：node scripts/serve-dist-preview.mjs [--port 4174] [--api 8080] [--dist dist]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`)
  return idx > -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

const PORT = Number(arg('port', 4174))
const API_PORT = Number(arg('api', 8080))
const DIST = path.resolve(ROOT, arg('dist', 'dist'))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`[serve-dist-preview] 找不到 ${DIST}/index.html，请先执行 npm run build`)
  process.exit(1)
}

const server = http.createServer((req, res) => {
  const url = req.url || '/'

  // API 与 WebSocket 转发到后端
  if (url.startsWith('/api/') || url.startsWith('/ws/')) {
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: API_PORT,
        path: url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${API_PORT}`,
          // 后端会校验 Origin，本地预览统一指向后端自身避免被 403
          origin: `http://127.0.0.1:${API_PORT}`
        }
      },
      upRes => {
        res.writeHead(upRes.statusCode || 502, upRes.headers)
        upRes.pipe(res)
      }
    )
    upstream.on('error', err => {
      console.error('[serve-dist-preview] 后端代理失败:', err.message)
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: false, message: `后端不可达: ${err.message}` }))
    })
    req.pipe(upstream)
    return
  }

  let pathname = url.split('?')[0]
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    /* 保留原始路径 */
  }
  let file = path.join(DIST, pathname)
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html') // SPA history fallback
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type })
  fs.createReadStream(file).pipe(res)
})

server.listen(PORT, () => {
  console.log(`[serve-dist-preview] 静态产物: ${DIST}`)
  console.log(`[serve-dist-preview] 访问地址: http://127.0.0.1:${PORT}`)
  console.log(
    `[serve-dist-preview] API 代理: http://127.0.0.1:${PORT}/api/v1 -> 127.0.0.1:${API_PORT}`
  )
})
