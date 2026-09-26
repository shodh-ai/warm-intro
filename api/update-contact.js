import { accessTokenFromSession } from './_lib/google.js';
import { getContacts, updateContactRow } from './_lib/data.js';
import { getGoogleSession, requireAppAuth } from './_lib/security.js';

export default async function handler(req, res) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getGoogleSession(req);
  if (!session?.sheetId) return res.status(200).json({ ok: true, demo: true });
  try {
    const { accessToken } = await accessTokenFromSession(req, res);
    const contacts = await getContacts(accessToken, session.sheetId);
    const current = contacts.find(c => c.rowNumber === Number(req.body?.rowNumber));
    if (!current) return res.status(404).json({ error: 'Contact row not found' });
    const updated = await updateContactRow(accessToken, session.sheetId, current.rowNumber, req.body?.patch || {}, current);
    res.status(200).json({ ok: true, contact: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
