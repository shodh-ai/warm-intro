import { createCompany, companySpreadsheet } from '../_lib/create-company.js';
import { accessTokenFromSession, googleFetch, updateGoogleSession } from '../_lib/google.js';
import { requireAppAuth } from '../_lib/security.js';

export default async function handler(req, res) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { accessToken, session } = await accessTokenFromSession(req, res);
    if (!accessToken) return res.status(401).json({ error: 'Connect Google first' });
    if (req.body?.companyName !== undefined) return await createCompany(req, res, accessToken, session);
    const template = companySpreadsheet('Shodh AI');
    template.sheets.push({properties:{title:'Companies',gridProperties:{rowCount:100,columnCount:3,frozenRowCount:1}}});
    const created = await googleFetch('https://sheets.googleapis.com/v4/spreadsheets', accessToken, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(template)
    });
    const id = created.spreadsheetId;
    if (!id) throw new Error('Google did not confirm the new tracker. Check Google Drive before trying again.');
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${id}/edit`;
    await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/Companies!A1:C2?valueInputOption=RAW`, accessToken, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({values:[['Company name','Tracker Sheet link','Description'],['Shodh AI',sheetUrl,'']]})
    });
    await updateGoogleSession(req, res, { ...session, sheetId:id });
    res.status(200).json({ok:true,sheetId:id,sheetUrl});
  } catch (e) { res.status(500).json({error:e.message}); }
}
