import { requireAppAuth } from './_lib/security.js';

function outputText(data) {
  if (typeof data.output_text === 'string') return data.output_text.trim();
  for (const item of data.output || []) {
    for (const c of item.content || []) if (c.type === 'output_text' && c.text) return c.text.trim();
  }
  return '';
}

export default async function handler(req, res) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const transcript = String(req.body?.transcript || '').trim();
  const contact = req.body?.contact || {};
  if (!transcript) return res.status(400).json({ error: 'Nothing to clean' });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({ text: transcript.replace(/\s+/g, ' ').trim(), fallback: true });
  }
  try {
    const prompt = `You lightly edit Arun Seth's dictated warm-introduction note. Write only in English; translate any Hindi or Hinglish while keeping proper names in Roman script. Preserve his personal voice and every factual claim. Remove filler, repetitions and speech disfluencies; fix grammar; make it warm and natural. Do not add facts, praise, claims, credentials or motives that he did not say. Keep it to 2-3 short sentences and return ONLY the cleaned note, no greeting, sign-off, quotes or explanation.\n\nRecipient: ${contact.name || ''}\nCompany: ${contact.company || ''}\nReason: ${contact.introReason || ''}\nContext: ${contact.context || ''}\n\nDictation:\n${transcript}`;
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.CLEANUP_MODEL || 'gpt-5.6-luna', input: prompt })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || 'Cleanup failed');
    const text = outputText(data);
    if (!text) throw new Error('Cleanup model returned no text');
    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
