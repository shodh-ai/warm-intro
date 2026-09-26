import { accessTokenFromSession, googleFetch } from './_lib/google.js';
import { getContacts, getSettings, updateContactRow } from './_lib/data.js';
import { getGoogleSession, requireAppAuth } from './_lib/security.js';

function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || 'there'; }
function subjectFor(template, c) {
  return String(template || '').replaceAll('{{FirstName}}', firstName(c.name)).replaceAll('{{Name}}', c.name || '').replaceAll('{{Company}}', c.company || '');
}
function gmailDate(iso) {
  const d = iso ? new Date(iso) : new Date(Date.now() - 30 * 86400000);
  const y = d.getUTCFullYear(); const m = String(d.getUTCMonth()+1).padStart(2,'0'); const day = String(d.getUTCDate()).padStart(2,'0');
  return `${y}/${m}/${day}`;
}

export default async function handler(req, res) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getGoogleSession(req);
  if (!session?.refresh_token || !session?.sheetId) return res.status(200).json({ ok: true, updated: 0 });
  try {
    const { accessToken } = await accessTokenFromSession(req, res);
    const [contacts, settings] = await Promise.all([getContacts(accessToken, session.sheetId), getSettings(accessToken, session.sheetId)]);
    let updated = 0;
    for (const c of contacts.filter(x => x.status === 'Draft Ready' && x.email && x.draftCreated).slice(0, 20)) {
      const subject = subjectFor(settings.email_subject, c).replace(/"/g, '');
      const q = `in:sent to:${c.email} subject:"${subject}" after:${gmailDate(c.draftCreated)}`;
      const list = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=${encodeURIComponent(q)}`, accessToken);
      if (list.messages?.length) {
        const today = new Date().toISOString().slice(0,10);
        await updateContactRow(accessToken, session.sheetId, c.rowNumber, { status: 'Sent', dateSent: today }, c);
        updated++;
      }
    }
    res.status(200).json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
