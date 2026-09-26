import { requireAppAuth } from './_lib/security.js';

export default async function handler(req, res) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY is not configured' });
  try {
    const { audioBase64, mimeType = 'audio/webm', fileName = 'intro.webm', contact = {} } = req.body || {};
    if (!audioBase64) return res.status(400).json({ error: 'Missing audio' });
    const bytes = Buffer.from(audioBase64, 'base64');
    if (bytes.length > 4_000_000) return res.status(413).json({ error: 'Recording is too large. Keep the intro under about 90 seconds.' });

    const fd = new FormData();
    fd.set('file', new Blob([bytes], { type: mimeType }), fileName);
    fd.set('model', process.env.TRANSCRIBE_MODEL || 'gpt-transcribe');
    const hints = [contact.name, contact.company, 'Shodh AI', 'Physical Intelligence', 'LUCAN'].filter(Boolean).join(', ');
    if (hints) fd.set('prompt', `Warm professional introduction. Important names and terms: ${hints}. Preserve the speaker's wording.`);

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: fd
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || 'Transcription failed');
    res.status(200).json({ text: data.text || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
