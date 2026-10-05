// Sirve el build como nginx: estáticos + fallback SPA, y proxya /api y /socket.io.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.argv[2];
const PORT = Number(process.argv[3] ?? 5180);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p.startsWith('/api/') || p.startsWith('/socket.io/')) {
    const up = http.request({ host: '127.0.0.1', port: 3001, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    req.pipe(up); up.on('error', () => res.end());
    return;
  }
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, p.startsWith('/portal') ? 'cloud-portal/index.html' : 'cloud/index.html');
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
srv.on('upgrade', (req, sock, head) => {
  const up = net.connect(3001, '127.0.0.1', () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    up.write(head); sock.pipe(up); up.pipe(sock);
  });
  up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
});
srv.listen(PORT, () => console.log('ok', PORT));
