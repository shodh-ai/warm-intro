import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createDevServer } from '../dev-server.mjs';

let server, base;
before(async () => {
  server = createDevServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

test('serves the frontend but never private files or backend source', async () => {
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Warm Intro/);
  for (const route of ['/.env.local', '/.env.example', '/.git/config', '/api/_lib/security.js', '/dev-server.mjs', '/package.json', '/%2eenv.local']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 404, route);
    assert.doesNotMatch(await response.text(), /OPENAI_API_KEY|sk-proj-/);
  }
});

test('executes the actual API handler locally', async () => {
  const response = await fetch(base + '/api/auth-status');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(typeof data.authenticated, 'boolean');
  assert.equal(typeof data.protected, 'boolean');
});

test('rejects requests from another website or host', async () => {
  for (const headers of [{ origin: 'https://unrelated.example' }, { host: 'unrelated.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    const status = await new Promise((resolve, reject) => {
      http.get(base + '/api/auth-status', { headers }, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(status, 403, JSON.stringify(headers));
  }
});

test('rejects malformed JSON before invoking API handlers', async () => {
  const response = await fetch(base + '/api/clean', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(response.status, 400);
});

test('rejects cross-origin form content types', async () => {
  const response = await fetch(base + '/api/clean', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hello' });
  assert.equal(response.status, 415);
});
