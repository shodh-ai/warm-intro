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

export const SIMPLE_HEADERS = ['Name','Email address','Context','Template','Attachment (Drive link)','Company','Intro Reason','Arun Note','Cleaned Note','Status','Draft ID','Draft Created','Date Sent','Follow-up Date','Reply','Notes'];
export function rowsToContacts(rows, headers = HEADERS) {
  const simple = headers[3] === 'Template';
  const keys = simple
    ? ['name','email','context','template','attachmentUrl','company','introReason','arunNote','cleanedNote','status','draftId','draftCreated','dateSent','followupDate','reply','notes']
    : ['name','company','email','introReason','context','arunNote','cleanedNote','status','draftId','draftCreated','dateSent','followupDate','reply','notes'];
  return rows.map((r,i) => {
    const c = {rowNumber:i+2, layout:simple?'simple':'legacy'};
    keys.forEach((key,index) => { c[key] = r[index] || ''; });
    c.status ||= 'Need Arun Note';
    return c;
  }).filter(c=>c.name || c.email);
}
export async function getContacts(accessToken, sheetId) {
  const [headers = [], ...rows] = await readRange(accessToken, sheetId, 'Contacts');
  return rowsToContacts(rows, headers);
}

export async function getSettings(accessToken, sheetId, defaults = DEFAULT_SETTINGS) {
  const rows = await readRange(accessToken, sheetId, 'Settings!A2:B20');
  const out = { ...defaults };
  for (const row of rows) if (row[0]) out[String(row[0])] = row[1] ?? '';
  return out;
}

export async function updateContactRow(accessToken, sheetId, rowNumber, patch, current) {
  const c = { ...current, ...patch };
  const values = [[c.arunNote || '', c.cleanedNote || '', c.status || '', c.draftId || '', c.draftCreated || '', c.dateSent || '', c.followupDate || '', c.reply || '', c.notes || '']];
  const range = c.layout === 'simple' ? `Contacts!H${rowNumber}:P${rowNumber}` : `Contacts!F${rowNumber}:N${rowNumber}`;
  // Only update tracking cells; never overwrite the person's editable input columns.
  await writeRange(accessToken, sheetId, range, values, 'RAW');
  return c;
}
