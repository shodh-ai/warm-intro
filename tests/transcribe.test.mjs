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
test('valid transcription reaches the frontend intact', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ text: ' A personal introduction. ' }));
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.text, 'A personal introduction.');
});
test('upstream errors are actionable rather than empty successful notes', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'Quota exceeded', code: 'insufficient_quota' } }, { status: 429 }));
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 429); assert.match(res.body.error, /Quota/);
});
