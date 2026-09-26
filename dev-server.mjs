import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.webmanifest':'application/manifest+json' };
const server = http.createServer((req,res) => {
  if (req.url.startsWith('/api/')) { res.writeHead(404, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'API routes run on Vercel; local static preview is demo-only.'})); }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = path.join(root, file);
  if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, {'Content-Type':mime[path.extname(full)] || 'application/octet-stream'});
  fs.createReadStream(full).pipe(res);
});
server.listen(4173, '0.0.0.0', () => console.log('Preview: http://localhost:4173'));
