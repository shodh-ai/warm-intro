import test from 'node:test';
import assert from 'node:assert/strict';
import { finishRecording, audioLevel } from '../audio-recording.js';

class Recorder extends EventTarget {
  state = 'recording';
  mimeType = 'audio/webm';
}
test('includes the final audio chunk emitted during stop', async () => {
  const chunks = [new Blob(['first'])];
  const recorder = new Recorder();
  recorder.stop = () => queueMicrotask(() => {
    chunks.push(new Blob(['last']));
    recorder.state = 'inactive';
    recorder.dispatchEvent(new Event('stop'));
  });
  assert.equal(await (await finishRecording(recorder, chunks)).text(), 'firstlast');
});
test('an already stopped recorder resolves without waiting for another stop event', async () => {
  const recorder = new Recorder(); recorder.state = 'inactive';
  assert.equal((await finishRecording(recorder, [new Blob(['recorded'])])).size, 8);
});
test('a recorder that never emits stop has a bounded failure', async () => {
  const recorder = new Recorder(); recorder.stop = () => {};
  await assert.rejects(finishRecording(recorder, [], 10), /did not finish/);
});
test('recorder errors are reported instead of leaving the composer busy', async () => {
  const recorder = new Recorder(); recorder.stop = () => recorder.dispatchEvent(new Event('error'));
  await assert.rejects(finishRecording(recorder, []), /could not finish/);
});
test('microphone level distinguishes silence from a captured signal', () => {
  assert.equal(audioLevel(new Uint8Array(512).fill(128)), 0);
  assert.ok(audioLevel(new Uint8Array([100, 156, 100, 156])) > 0.1);
});
