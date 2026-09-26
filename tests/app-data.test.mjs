import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/app-data.js';
import { encryptJson } from '../api/_lib/security.js';
delete process.env.APP_ACCESS_CODE;
afterEach(() => mock.restoreAll());
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, setHeader() {} });
test('a new browser gets a Google connection requirement, never sample contacts', async () => {
  const res = response();
  await handler({ headers: {} }, res);
  assert.equal(res.body.mode, 'setup');
  assert.deepEqual(res.body.contacts, []);
  assert.equal(res.body.google.connected, false);
});
test('a connected account without a tracker gets setup rather than a demo list', async () => {
  const res = response();
  await handler({ headers: { cookie: `google_session=${encryptJson({ refresh_token: 'token', email: 'test@example.com' })}` } }, res);
  assert.equal(res.body.mode, 'setup');
  assert.deepEqual(res.body.contacts, []);
  assert.equal(res.body.google.connected, true);
});
test('a failed Google refresh never returns demo contacts', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ error: 'invalid_grant' }, { status: 400 }));
  const res = response();
  await handler({ headers: { cookie: `google_session=${encryptJson({ refresh_token: 'expired', sheetId: 'sheet' })}` } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.contacts, undefined);
});
