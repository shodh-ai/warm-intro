import { resolveCompany, companyDefaults } from './_lib/companies.js';
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
  const rowNumber = Number(req.body?.rowNumber);
  const cleanedNote = typeof req.body?.cleanedNote === 'string' ? req.body.cleanedNote.trim() : '';
  if (!Number.isInteger(rowNumber) || rowNumber < 2) return res.status(400).json({ error: 'Choose a contact before creating a draft.' });
  if (!cleanedNote) return res.status(400).json({ error: 'Review and approve your note before creating a draft.' });
  try {
    const { accessToken } = await accessTokenFromSession(req, res);
    const company = await resolveCompany(accessToken, session, req.body?.companyId);
    const [contacts, settings] = await Promise.all([getContacts(accessToken, company.id), getSettings(accessToken, company.id, companyDefaults(company, session))]);
    const current = contacts.find(c => c.rowNumber === rowNumber);
    if (!current) return res.status(404).json({ error: 'Contact not found' });
    const sheetEmail = String(current.email || '').trim();
    const recipient = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(sheetEmail) && !sheetEmail.includes('replace-with-your-email') ? sheetEmail : '';

    const cc = String(settings.cc_email || '').trim();
    if (cc && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(cc)) return res.status(400).json({ error: 'Add one valid CC email in the tracker Settings, or leave it blank.' });
    const deck = String(settings.deck_url || '').trim();
    if (deck && !/^https:\/\/[^\s]+$/i.test(deck)) return res.status(400).json({ error: 'Use an HTTPS deck link in the tracker Settings, or leave it blank.' });
    const subject = subjectFor(settings.email_subject, current);
    const body = [`Hi ${firstName(current.name)},`, cleanedNote, settings.fixed_template, settings.signature, settings.founder_note ? `${settings.founder_heading || (companyDefaults(company, session) ? `More about ${company.name}:` : 'More about Shodh — from Arastu:')}\n\n${settings.founder_note}` : '', deck ? `Company deck: ${deck}` : ''].filter(part => String(part || '').trim()).join('\n\n').trim();
    const raw = [
      ...(recipient ? [`To: ${recipient}`] : []),
      ...(cc ? [`Cc: ${cc}`] : []),
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
    if (typeof draft?.id !== 'string' || !draft.id.trim()) return res.status(502).json({ error: 'Gmail did not confirm the draft. Check Gmail drafts before trying again.' });
    const now = new Date();
    const configuredDays = Number(settings.followup_days);
    const days = Number.isFinite(configuredDays) && configuredDays >= 1 && configuredDays <= 3650 ? configuredDays : 5;
    const follow = new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
    const result = { draftCreated: true, draftId: draft.id, subject, body, cc, recipient, gmailUrl: 'https://mail.google.com/mail/u/0/#drafts' };
    let updated;
    try {
      updated = await updateContactRow(accessToken, company.id, current.rowNumber, {
        arunNote: typeof req.body?.transcript === 'string' ? req.body.transcript : cleanedNote,
        cleanedNote, status: 'Draft Ready', draftId: draft.id, draftCreated: now.toISOString(), followupDate: follow
      }, current);
    } catch {
      return res.status(502).json({ ...result, trackerUpdated: false, code: 'TRACKER_UPDATE_FAILED', error: 'The Gmail draft was created, but the tracker could not be updated. Open Gmail to review it before trying again.' });
    }
    res.status(200).json({ ok: true, ...result, trackerUpdated: true, contact: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
