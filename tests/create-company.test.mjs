import test, {afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/google/setup-sheet.js';
import {encryptJson} from '../api/_lib/security.js';
import {companySpreadsheet} from '../api/_lib/create-company.js';
delete process.env.APP_ACCESS_CODE;delete process.env.GOOGLE_SHEET_ID;
afterEach(()=>mock.restoreAll());
const request=body=>({method:'POST',body,headers:{cookie:`google_session=${encryptJson({email:'arun@example.com',refresh_token:'test',sheetId:'home'})}`}});
const response=()=>({statusCode:200,status(n){this.statusCode=n;return this;},json(b){this.body=b;},setHeader(){throw new Error('Must not replace active Google session');}});
function setup({failAppend=false,existing=false}={}) {
 const calls=[];
 mock.method(globalThis,'fetch',async(url,options={})=>{
  calls.push({url,...options});
  if(url.includes('oauth2.googleapis.com')) return Response.json({access_token:'test'});
  if(url.includes('Companies!') && options.method!=='POST') return Response.json({values:existing?[['New Co','new-sheet']]:[]});
  if(url==='https://sheets.googleapis.com/v4/spreadsheets') return Response.json({spreadsheetId:'new-sheet'});
  if(url.includes(':append')) return failAppend?Response.json({error:{message:'Cannot write registry'}},{status:403}):Response.json({updates:{updatedRows:1}});
  throw new Error(`Unexpected request: ${url}`);
 });return calls;
}
test('new company creates a clean formatted template and links it without changing the existing tracker',async()=>{
 const calls=setup(),res=response();await handler(request({companyName:'New Co'}),res);
 assert.equal(res.statusCode,200);assert.equal(res.body.company.name,'New Co');
 const create=calls.find(c=>c.url.endsWith('/v4/spreadsheets'));
 const payload=JSON.parse(create.body);assert.deepEqual(payload.sheets.map(s=>s.properties.title),['Contacts','Arun - Action Needed','Dashboard','Settings']);
 assert.equal(payload.sheets[0].data[0].rowData.length,1);
 assert.doesNotMatch(create.body,/Shodh|Arastu|Test Contact/);
 assert.ok(create.body.includes('New Co'));
 const append=calls.find(c=>c.url.includes(':append'));assert.ok(append.url.includes('/home/'));assert.ok(append.url.includes('valueInputOption=RAW'));
 assert.deepEqual(JSON.parse(append.body).values,[['New Co','https://docs.google.com/spreadsheets/d/new-sheet/edit','']]);
});
test('retry after registry failure reuses the created Sheet',async()=>{
 let calls=setup({failAppend:true}),res=response();await handler(request({companyName:'New Co'}),res);
 assert.equal(res.statusCode,502);assert.equal(res.body.sheetCreated,true);const token=res.body.registrationToken;
 mock.restoreAll();calls=setup();res=response();await handler(request({companyName:'New Co',registrationToken:token}),res);
 assert.equal(res.statusCode,200);assert.ok(!calls.some(c=>c.url.endsWith('/v4/spreadsheets')));
});
test('existing company name does not create another Sheet',async()=>{
 const calls=setup({existing:true}),res=response();await handler(request({companyName:'new co'}),res);
 assert.equal(res.body.existing,true);assert.ok(!calls.some(c=>c.method==='POST'&&c.url.includes('sheets.googleapis.com')));
});
test('invalid company names and forged retry tokens never create a Sheet',async()=>{
 const calls=setup();for(const body of [{companyName:''},{companyName:'Bad\nName'},{companyName:'New Co',registrationToken:'forged'}]) {
 const res=response();await handler(request(body),res);assert.equal(res.statusCode,400);
 }assert.ok(!calls.some(c=>c.url.endsWith('/v4/spreadsheets')));
});
test('company names are plain text, never executable formulas',()=>{
 const payload=companySpreadsheet('=IMPORTXML("bad")');
 const rows=payload.sheets[3].data[0].rowData;
 assert.equal(rows[1].values[1].userEnteredValue.stringValue,'Introduction to =IMPORTXML("bad") — {{FirstName}}');
});
