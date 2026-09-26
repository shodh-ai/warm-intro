import { readRange, writeRange } from './google.js';

export const HEADERS = [
  'Name','Company','Email','Intro Reason','Context for Arun','Arun Note','Cleaned Note','Status','Draft ID','Draft Created','Date Sent','Follow-up Date','Reply','Notes'
];

export const DEFAULT_SETTINGS = {
  email_subject: 'Introduction — Shodh AI × {{FirstName}}',
  fixed_template: `I wanted to introduce you to the team at Shodh AI. They are building Physical Intelligence models for science and industry, with a focus on helping R&D teams reason across molecules, processes and manufacturing conditions.\n\nI thought it could be useful for you to connect with them and hear what they are building directly.`,
  signature: 'Best,\nArun',
  founder_note: '',
  cc_email: '',
  deck_url: '',
  followup_days: '5'
};

export const DEMO_CONTACTS = [
  { rowNumber: 2, name: 'George Robson', company: 'Sequoia Capital', email: 'george@example.com', introReason: 'Fundraising / Physical Intelligence', context: 'Warm investor introduction. You know George personally and want him to meet the Shodh team.', arunNote: '', cleanedNote: '', status: 'Need Arun Note' },
  { rowNumber: 3, name: 'Priya Mehta', company: 'Industrial R&D Co.', email: 'priya@example.com', introReason: 'Potential design partner', context: 'She leads R&D partnerships and is relevant for a pilot conversation.', arunNote: '', cleanedNote: '', status: 'Need Arun Note' },
  { rowNumber: 4, name: 'David Chen', company: 'Deeptech Fund', email: 'david@example.com', introReason: 'Fundraising', context: 'You met David through a mutual friend last year.', arunNote: '', cleanedNote: '', status: 'Need Arun Note' }
];

export function rowsToContacts(rows) {
  return rows.map((r, i) => ({
    rowNumber: i + 2,
    name: r[0] || '', company: r[1] || '', email: r[2] || '', introReason: r[3] || '', context: r[4] || '',
    arunNote: r[5] || '', cleanedNote: r[6] || '', status: r[7] || 'Need Arun Note', draftId: r[8] || '', draftCreated: r[9] || '', dateSent: r[10] || '', followupDate: r[11] || '', reply: r[12] || '', notes: r[13] || ''
  })).filter(c => c.name || c.email);
}

export async function getContacts(accessToken, sheetId) {
  const rows = await readRange(accessToken, sheetId, 'Contacts!A2:N');
  return rowsToContacts(rows);
}

export async function getSettings(accessToken, sheetId, defaults = DEFAULT_SETTINGS) {
  const rows = await readRange(accessToken, sheetId, 'Settings!A2:B20');
  const out = { ...defaults };
  for (const row of rows) if (row[0]) out[String(row[0])] = row[1] ?? '';
  return out;
}

export async function updateContactRow(accessToken, sheetId, rowNumber, patch, current) {
  const c = { ...current, ...patch };
  const values = [[
    c.name || '', c.company || '', c.email || '', c.introReason || '', c.context || '', c.arunNote || '', c.cleanedNote || '', c.status || '',
    c.draftId || '', c.draftCreated || '', c.dateSent || '', c.followupDate || '', c.reply || '', c.notes || ''
  ]];
  await writeRange(accessToken, sheetId, `Contacts!A${rowNumber}:N${rowNumber}`, values);
  return c;
}
