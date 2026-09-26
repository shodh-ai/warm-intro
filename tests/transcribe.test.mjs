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
  mock.method(globalThis, 'fetch', async url => Response.json(url.endsWith('/responses') ? { output: [{ content: [{ type: 'output_text', text: ' A personal introduction. ' }] }] } : { text: ' A personal introduction. ' }));
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.text, 'A personal introduction.');
});
for (const dictation of ['मैं चाहता हूँ कि आप अगले हफ्ते टीम से मिलें।', 'Main chahta hoon ki aap next week team se milein.']) {
  test(`translates Hindi or Hinglish before returning a transcript: ${dictation}`, async () => {
    const english = 'I would like you to meet the team next week.';
    const calls = [];
    mock.method(globalThis, 'fetch', async (url, options) => {
      calls.push(url);
      if (url.endsWith('/transcriptions')) return Response.json({ text: dictation });
      const body = JSON.parse(options.body);
      assert.equal(body.input, dictation);
      assert.match(body.instructions, /English only/);
      return Response.json({ output_text: english });
    });
    const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { text: english, language: 'en' });
    assert.equal(calls.length, 2);
  });
}
test('translation failure never returns the untranslated Hindi as a fallback', async () => {
  mock.method(globalThis, 'fetch', async url => url.endsWith('/transcriptions') ? Response.json({ text: 'आपसे मिलकर खुशी हुई' }) : Response.json({ error: {} }, { status: 503 }));
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 503); assert.equal(res.body.text, undefined);
  assert.match(res.body.error, /English transcript/);
});
test('empty English output keeps the recording retryable', async () => {
  mock.method(globalThis, 'fetch', async url => Response.json(url.endsWith('/transcriptions') ? { text: 'Hello.' } : { output: [] }));
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 502); assert.equal(res.body.text, undefined);
});
test('upstream errors are actionable rather than empty successful notes', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'Quota exceeded', code: 'insufficient_quota' } }, { status: 429 }));
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 429); assert.match(res.body.error, /Quota/);
});
