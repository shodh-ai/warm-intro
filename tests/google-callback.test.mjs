import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/google/callback.js';
import { encryptJson } from '../api/_lib/security.js';
afterEach(() => mock.restoreAll());
async function callback(email, verified = true) {
  process.env.ALLOWED_GOOGLE_EMAIL = 'ellwil@shodh.ai, arastu@shodh.ai, seth.arun@gmail.com';
  mock.method(globalThis, 'fetch', async url => Response.json(url.includes('/token') ? { access_token: 'test', refresh_token: 'test' } : { email, email_verified: verified }));
  const req = { headers: { host: 'example.com', cookie: `google_oauth_state=${encryptJson({state:'test'})}` }, query: { state: 'test', code: 'test' } };
  const res = { code: 200, status(code) {this.code=code;return this;}, send(text) {this.text=text;}, setHeader() {}, redirect(url) {this.url=url;} };
  await handler(req,res); return res;
}
test('allows all three configured Google accounts', async () => {
  assert.equal((await callback('ellwil@shodh.ai')).url, '/?connected=1');
  mock.restoreAll();
  assert.equal((await callback('arastu@shodh.ai')).url, '/?connected=1');
  mock.restoreAll();
  assert.equal((await callback('seth.arun@gmail.com')).url, '/?connected=1');
});
test('rejects an unlisted account', async () => { assert.equal((await callback('other@example.com')).code, 403); });
test('rejects an unverified Google email', async () => { assert.equal((await callback('arastu@shodh.ai', false)).code, 500); });
