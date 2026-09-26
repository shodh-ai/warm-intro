import { googleFetch } from './google.js';
import { getCompanies, registrySheetId, companyDefaults } from './companies.js';
import { HEADERS } from './data.js';
import { encryptJson, decryptJson } from './security.js';

const cell = value => ({ userEnteredValue: { stringValue: String(value) } });
const row = values => ({ values: values.map(cell) });
const formulaRow = formula => ({ values: [{ userEnteredValue: { formulaValue: formula } }] });
export function companySpreadsheet(name) {
  const settings = companyDefaults({ id: '__new__', name }, {sheetId:'__registry__'});
  const sheets = [
    { title:'Contacts', rows:[row(HEADERS)], columns:14 },
    { title:'Arun - Action Needed', rows:[row(HEADERS),formulaRow('=IFERROR(FILTER(Contacts!A2:N,(Contacts!A2:A<>"")*((Contacts!H2:H="Need Arun Note")+(Contacts!H2:H=""))),"")')], columns:14 },
    { title:'Dashboard', rows:[row(['Metric','Count']),...[
      ['Total','=COUNTA(Contacts!A2:A)'],['Need Arun Note','=COUNTIF(Contacts!H2:H,"Need Arun Note")'],['Draft Ready','=COUNTIF(Contacts!H2:H,"Draft Ready")'],['Sent','=COUNTIF(Contacts!H2:H,"Sent")'],['Replied','=COUNTIF(Contacts!H2:H,"Replied")'],['Meeting Booked','=COUNTIF(Contacts!H2:H,"Meeting Booked")'],['Skipped','=COUNTIF(Contacts!H2:H,"Skipped")'],['Follow-ups due','=COUNTIFS(Contacts!L2:L,"<="&TODAY(),Contacts!L2:L,"<>",Contacts!H2:H,"Sent")']
    ].map(([label,formula])=>({values:[cell(label),{userEnteredValue:{formulaValue:formula}}]}))], columns:2 },
    { title:'Settings', rows:[row(['Key','Value']),...Object.entries(settings).map(row)], columns:2 }
  ];
  return {properties:{title:`${name} — Warm Intro Tracker`},sheets:sheets.map((sheet,i)=>({
    properties:{sheetId:i,title:sheet.title,gridProperties:{rowCount:1000,columnCount:sheet.columns,frozenRowCount:1}},
    data:[{startRow:0,startColumn:0,rowData:sheet.rows.map((r,index)=>({values:r.values.map(c=>({...c,userEnteredFormat:{wrapStrategy:'WRAP',verticalAlignment:'TOP',textFormat:{fontSize:12,...(index===0?{bold:true,foregroundColor:{red:1,green:1,blue:1}}:{})},...(index===0?{backgroundColor:{red:.19,green:.36,blue:.26}}:{})}}))})),columnMetadata:Array.from({length:sheet.columns},(_,col)=>({pixelSize:sheet.title==='Settings'&&col===1?560:col===4?340:200}))}]
  }))};
}
export async function createCompany(req,res,accessToken,session) {
  const name = typeof req.body.companyName === 'string' ? req.body.companyName.trim() : '';
  if (!name || name.length>80 || /[\r\n\x00-\x1f]/.test(name)) return res.status(400).json({error:'Enter a company name (up to 80 characters).'});
  const registry = registrySheetId(session);
  if(!registry) return res.status(400).json({error:'Connect your main tracker first.'});
  const companies = await getCompanies(accessToken,session);
  const existing = companies.find(c=>c.name.toLowerCase()===name.toLowerCase());
  if(existing) return res.status(200).json({ok:true,company:existing,sheetUrl:`https://docs.google.com/spreadsheets/d/${existing.id}/edit`,existing:true});
  if(companies.length>=99) return res.status(400).json({error:'The company list is full.'});
  let id;
  if(req.body.registrationToken) {
    const pending=decryptJson(req.body.registrationToken);
    if(!pending || pending.email!==session.email || pending.registry!==registry || pending.name!==name || Date.now()-pending.createdAt>86400000) return res.status(400).json({error:'This registration link expired. Add the existing Sheet link in the Companies tab.'});
    id=pending.id;
  } else {
    const created=await googleFetch('https://sheets.googleapis.com/v4/spreadsheets',accessToken,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(companySpreadsheet(name))});
    id=created.spreadsheetId;
    if(!id) throw new Error('Google did not confirm the new Sheet. Check Google Drive before trying again.');
  }
  const sheetUrl=`https://docs.google.com/spreadsheets/d/${id}/edit`;
  try {
    await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(registry)}/values/Companies!A2%3AC:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,accessToken,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:[[name,sheetUrl,'']]})});
  } catch {
    return res.status(502).json({error:'The Sheet was created, but could not be linked. Retry linking below; this will reuse the same Sheet.',sheetCreated:true,sheetUrl,registrationToken:encryptJson({id,name,email:session.email,registry,createdAt:Date.now()})});
  }
  return res.status(200).json({ok:true,company:{id,name,description:''},sheetUrl});
}
