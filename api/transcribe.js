import { requireAppAuth } from './_lib/security.js';

export default async function handler(req, res) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY is not configured' });
  try {
    const { audioBase64, mimeType = 'audio/webm', fileName = 'intro.webm', contact = {} } = req.body || {};
    if (!audioBase64) return res.status(400).json({ error: 'Missing audio' });
    const bytes = Buffer.from(audioBase64, 'base64');
    if (!bytes.length) return res.status(400).json({ error: 'No audio was captured. Check microphone access and try again.' });
    if (bytes.length > 3_000_000) return res.status(413).json({ error: 'Recording is too large. Keep the intro under about 90 seconds.' });

    const fd = new FormData();
    fd.set('file', new Blob([bytes], { type: mimeType }), fileName);
    // The translations endpoint returns English directly in a single request.
    fd.set('model', 'whisper-1');
    fd.set('response_format', 'json');
    const hints = [contact.name, contact.company].filter(Boolean).join(', ');
    if (hints) fd.set('prompt', `Warm professional introduction. Important names and terms: ${hints}. English translation. Preserve the speaker's meaning and names.`);

    const signal = AbortSignal.timeout(40000);
    const startedAt = Date.now();
    console.info('[transcribe] request', { bytes: bytes.length, mimeType });
    const r = await fetch('https://api.openai.com/v1/audio/translations', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: fd, signal
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('[transcribe] upstream error', { status: r.status, code: data?.error?.code || 'unknown' });
      return res.status(r.status).json({ error: data?.error?.message || 'Transcription failed' });
    }
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) {
      console.warn('[transcribe] no speech', { bytes: bytes.length });
      return res.status(422).json({ code: 'NO_SPEECH', error: 'No speech was detected. Play the recording to check the audio, check your microphone, and try again.' });
    }
    if (/[\u0900-\u097f]/u.test(text)) {
      return res.status(502).json({ error: 'The English transcript was incomplete. Your recording is saved; please retry.' });
    }
    console.info('[transcribe] complete', { characters: text.length, durationMs: Date.now() - startedAt });
    res.status(200).json({ text, language: 'en' });
  } catch (e) {
    console.error('[transcribe] failed', { name: e.name });
    res.status(e.name === 'TimeoutError' ? 504 : 500).json({ error: e.name === 'TimeoutError' ? 'Transcription timed out. Your recording is saved below; please retry.' : e.message });
  }
}
