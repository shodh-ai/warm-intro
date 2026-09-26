import { accessTokenFromSession, googleFetch, updateGoogleSession } from '../_lib/google.js';
import { DEFAULT_SETTINGS, HEADERS } from '../_lib/data.js';
import { requireAppAuth } from '../_lib/security.js';

export default async function handler(req, res) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { accessToken, session } = await accessTokenFromSession(req, res);
    if (!accessToken) return res.status(401).json({ error: 'Connect Google first' });

    const created = await googleFetch('https://sheets.googleapis.com/v4/spreadsheets', accessToken, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title: 'Shodh Warm Intro Tracker' }, sheets: [{ properties: { title: 'Contacts' } }, { properties: { title: 'Arun - Action Needed' } }, { properties: { title: 'Dashboard' } }, { properties: { title: 'Settings' } }] })
    });
    const id = created.spreadsheetId;
    const values = {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: 'Contacts!A1:N2', majorDimension: 'ROWS', values: [HEADERS, ['Test Contact','Replace with company','replace-with-your-email@example.com','Test the workflow','Use your own email for the first test','','','Need Arun Note','','','','','','Delete this row after testing']] },
        { range: 'Arun - Action Needed!A1:N2', majorDimension: 'ROWS', values: [HEADERS, ['=FILTER(Contacts!A2:N,(Contacts!A2:A<>\"\")*((Contacts!H2:H=\"Need Arun Note\")+(Contacts!H2:H=\"\")))']] },
        { range: 'Dashboard!A1:B10', majorDimension: 'ROWS', values: [
          ['Warm Intro Dashboard',''],['Metric','Count'],['Total','=COUNTA(Contacts!A2:A)'],['Need Arun Note','=COUNTIF(Contacts!H2:H,\"Need Arun Note\")'],['Draft Ready','=COUNTIF(Contacts!H2:H,\"Draft Ready\")'],['Sent','=COUNTIF(Contacts!H2:H,\"Sent\")'],['Replied','=COUNTIF(Contacts!H2:H,\"Replied\")'],['Meeting Booked','=COUNTIF(Contacts!H2:H,\"Meeting Booked\")'],['Skipped','=COUNTIF(Contacts!H2:H,\"Skipped\")'],['Follow-ups due','=COUNTIFS(Contacts!L2:L,\"<=\"&TODAY(),Contacts!L2:L,\"<>\",Contacts!H2:H,\"Sent\")']
        ] },
        { range: 'Settings!A1:B5', majorDimension: 'ROWS', values: [
          ['Key','Value'],
          ['email_subject', DEFAULT_SETTINGS.email_subject],
          ['fixed_template', DEFAULT_SETTINGS.fixed_template],
          ['signature', DEFAULT_SETTINGS.signature],
          ['followup_days', DEFAULT_SETTINGS.followup_days]
        ] }
      ]
    };
    await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, accessToken, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values)
    });
    await updateGoogleSession(req, res, { ...session, sheetId: id });
    res.status(200).json({ ok: true, sheetId: id, sheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
