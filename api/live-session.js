import { requireAppAuth } from './_lib/security.js';

export default async function handler(req, res) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY is not configured' });
  try {
    const sdp = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    if (!sdp.includes('v=0')) return res.status(400).json({ error: 'Invalid SDP offer' });
    const sessionConfig = JSON.stringify({
      type: 'transcription',
      audio: {
        input: {
          transcription: {
            model: process.env.LIVE_TRANSCRIBE_MODEL || 'gpt-live-transcribe',
            prompt: 'Warm professional introductions for Shodh AI. Important vocabulary: Shodh AI, Physical Intelligence, LUCAN, investor, R&D, pilot, deeptech.',
            keywords: ['Shodh AI','Physical Intelligence','LUCAN','R&D','deeptech'],
            languages: ['en'],
            delay: 'low'
          },
          turn_detection: null
        }
      }
    });
    const fd = new FormData();
    fd.set('sdp', sdp);
    fd.set('session', sessionConfig);
    const r = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'OpenAI-Safety-Identifier': 'arun-intro-single-user' },
      body: fd
    });
    const answer = await r.text();
    if (!r.ok) return res.status(r.status).send(answer);
    res.setHeader('Content-Type', 'application/sdp');
    res.status(200).send(answer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
