import { accessTokenFromSession, googleFetch } from './_lib/google.js';
import { getContacts, getSettings, updateContactRow } from './_lib/data.js';
import { getGoogleSession, requireAppAuth } from './_lib/security.js';

function encodeHeader(s) {
  return `=?UTF-8?B?${Buffer.from(String(s), 'utf8').toString('base64')}?=`;
}
function base64url(s) { return Buffer.from(s, 'utf8').toString('base64url'); }
function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || 'there'; }
function subjectFor(template, contact) {
  return String(template || '').replaceAll('{{FirstName}}', firstName(contact.name)).replaceAll('{{Name}}', contact.name || '').replaceAll('{{Company}}', contact.company || '');
}

export default async function handler(req, res) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = getGoogleSession(req);
  if (!session?.refresh_token || !session?.sheetId) return res.status(401).json({ error: 'Connect Google and create the tracker first' });
  try {
    const { accessToken } = await accessTokenFromSession(req, res);
    const [contacts, settings] = await Promise.all([getContacts(accessToken, session.sheetId), getSettings(accessToken, session.sheetId)]);
    const current = contacts.find(c => c.rowNumber === Number(req.body?.rowNumber));
    if (!current) return res.status(404).json({ error: 'Contact not found' });
    const cleanedNote = String(req.body?.cleanedNote || current.cleanedNote || '').trim();
    if (!cleanedNote) return res.status(400).json({ error: 'Cleaned note is empty' });
    if (!current.email || current.email.includes('replace-with-your-email')) return res.status(400).json({ error: 'Replace the test email in the tracker before creating a real Gmail draft.' });

    const subject = subjectFor(settings.email_subject, current);
    const body = `Hi ${firstName(current.name)},\n\n${cleanedNote}\n\n${settings.fixed_template}\n\n${settings.signature}`.trim();
    const raw = [
      `To: ${current.email}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body
    ].join('\r\n');

    const draft = await googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', accessToken, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { raw: base64url(raw) } })
    });
    const now = new Date();
    const days = Math.max(1, Number(settings.followup_days || 5));
    const follow = new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
    const updated = await updateContactRow(accessToken, session.sheetId, current.rowNumber, {
      arunNote: req.body?.transcript || current.arunNote || '', cleanedNote, status: 'Draft Ready', draftId: draft.id || '', draftCreated: now.toISOString(), followupDate: follow
    }, current);
    res.status(200).json({ ok: true, draftId: draft.id, subject, body, contact: updated, gmailUrl: 'https://mail.google.com/mail/u/0/#drafts' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
