// Wait for the recorder's final dataavailable event before assembling the file.
export function finishRecording(recorder, chunks, timeoutMs = 8000) {
  if (!recorder) return Promise.reject(new Error('The recorder is unavailable. Please record again.'));
  const blob = () => new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
  if (recorder.state === 'inactive') return Promise.resolve(blob());
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      recorder.removeEventListener('stop', stopped);
      recorder.removeEventListener('error', failed);
    };
    const stopped = () => { cleanup(); resolve(blob()); };
    const failed = event => { cleanup(); reject(new Error(event.error?.message || 'The browser could not finish the recording. Please try again.')); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('The recorder did not finish. Please try again or upload an audio file.')); }, timeoutMs);
    recorder.addEventListener('stop', stopped, { once: true });
    recorder.addEventListener('error', failed, { once: true });
    try { recorder.stop(); } catch (error) { cleanup(); reject(error); }
  });
}

export function audioLevel(samples) {
  if (!samples.length) return 0;
  let energy = 0;
  for (const value of samples) energy += ((value - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(energy / samples.length) * 5);
}
