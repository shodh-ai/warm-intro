import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon-192.png', ['icon-192.png', 'image/png']],
  ['/icon-512.png', ['icon-512.png', 'image/png']]
]);
const apiRoutes = new Set([
  'auth-status', 'auth-login', 'app-data', 'clean', 'transcribe', 'live-session',
  'draft', 'update-contact', 'sync-status', 'google/start', 'google/callback', 'google/setup-sheet'
]);

// Expose the same response helpers used by the Vercel handlers.
function responseHelpers(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
  res.send = value => res.end(value);
  res.redirect = location => { res.writeHead(302, { Location: location }); res.end(); };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 6_000_000) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) return {};
  const type = (req.headers['content-type'] || '').split(';')[0];
  if (type === 'application/sdp') return body;
  if (type !== 'application/json') throw Object.assign(new Error('Use JSON or SDP for API requests.'), { status: 415 });
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('Invalid JSON body.'), { status: 400 }); }
}

export function createDevServer() {
  return http.createServer(async (req, res) => {
    responseHelpers(res);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const base = `http://${req.headers.host}`;
      const url = new URL(req.url, base);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname) ||
          url.origin !== base ||
          (req.headers.origin && req.headers.origin !== base) ||
          req.headers['sec-fetch-site'] === 'cross-site') {
        return res.status(403).json({ error: 'Only same-origin localhost requests are allowed.' });
      }
      if (url.pathname.startsWith('/api/')) {
        const route = url.pathname.slice(5);
        if (!apiRoutes.has(route)) return res.status(404).json({ error: 'API route not found.' });
        req.query = Object.fromEntries(url.searchParams);
        req.body = await readBody(req);
        // Do not trust forwarded headers supplied to the local development server.
        req.headers['x-forwarded-proto'] = 'http';
        req.headers['x-forwarded-host'] = req.headers.host;
        const { default: handler } = await import(`./api/${route}.js`);
        return await handler(req, res);
      }
      if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).send('Method not allowed');
      const asset = publicFiles.get(url.pathname);
      if (!asset) return res.status(404).send('Not found');
      const [file, type] = asset;
      res.setHeader('Content-Type', type);
      if (req.method === 'HEAD') return res.end();
      res.end(await fs.promises.readFile(path.join(root, file)));
    } catch (error) {
      if (!res.headersSent) res.status(error.status || 500).json({ error: error.status ? error.message : 'Local API request failed.' });
      else res.end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const envPath = path.join(root, '.env.local');
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
  const port = Number(process.env.PORT || 4173);
  createDevServer().listen(port, '127.0.0.1', () => {
    console.log(`Warm Intro: http://localhost:${port}`);
    console.log(`OpenAI: ${process.env.OPENAI_API_KEY ? 'configured' : 'not configured — original-note fallback'}`);
  });
}
