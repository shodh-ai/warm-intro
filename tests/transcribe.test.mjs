import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/transcribe.js';

process.env.OPENAI_API_KEY = 'test-key';
delete process.env.APP_ACCESS_CODE;
afterEach(() => mock.restoreAll());
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
}
const request = () => ({ method: 'POST', headers: {}, body: { audioBase64: Buffer.from('test audio').toString('base64'), mimeType: 'audio/webm' } });

test('an empty successful upstream response becomes an explicit no-speech error', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ text: '' }));
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 422); assert.equal(res.body.code, 'NO_SPEECH');
});
test('English output reaches the frontend through one audio translation request', async () => {
  const calls = [];
  mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url);
    assert.equal(url, 'https://api.openai.com/v1/audio/translations');
    assert.equal(options.body.get('model'), 'whisper-1');
    assert.equal(options.body.get('response_format'), 'json');
    assert.equal(options.body.get('file').size, Buffer.byteLength('test audio'));
    return Response.json({ text: ' I would like you to meet the team next week. ' });
  });
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { text: 'I would like you to meet the team next week.', language: 'en' });
  assert.equal(calls.length, 1);
});
test('unexpected untranslated output is never returned as an English transcript', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ text: 'आपसे मिलकर खुशी हुई' }));
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 502); assert.equal(res.body.text, undefined);
  assert.match(res.body.error, /English transcript/);
});
test('upstream errors are actionable rather than empty successful notes', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'Quota exceeded', code: 'insufficient_quota' } }, { status: 429 }));
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 429); assert.match(res.body.error, /Quota/);
});
