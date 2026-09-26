import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import appData from '../api/app-data.js';
import draft from '../api/draft.js';
import updateContact from '../api/update-contact.js';
import { encryptJson } from '../api/_lib/security.js';
import { companiesFromRows } from '../api/_lib/companies.js';
delete process.env.APP_ACCESS_CODE;
delete process.env.GOOGLE_SHEET_ID;
afterEach(() => mock.restoreAll());
const req = (body = {}, query = {}) => ({ method: 'POST', query, body, headers: {cookie: `google_session=${encryptJson({refresh_token:'test',sheetId:'home',email:'arun@example.com'})}`} });
const res = () => ({statusCode:200,status(n){this.statusCode=n;return this;},json(b){this.body=b;},setHeader(){}});
function setup({registryError,settings = []} = {}) {
  const calls=[];
  mock.method(globalThis,'fetch',async (url, options={}) => {
    calls.push({url,...options});
    if(url.includes('oauth2.googleapis.com')) return Response.json({access_token:'test'});
    const decoded=decodeURIComponent(url);
    if(decoded.includes('Companies!')) return registryError ? Response.json({error:{message:registryError}},{status:403}) : Response.json({values:[['Other Company','other','Other introductions']]});
    if(decoded.includes('/other/values/Contacts!') && options.method!=='PUT') return Response.json({values:[['Person','Recipient Co','','Introduction','Context']]});
    if(decoded.includes('/other/values/Settings!')) return Response.json({values:settings});
    if(url.includes('gmail.googleapis.com')) return Response.json({id:'draft-test'});
    if(options.method==='PUT' && decoded.includes('/other/values/Contacts!')) return Response.json({updatedRows:1});
    throw new Error(`Wrong company or unexpected request: ${decoded}`);
  });
  return calls;
}
test('company page lists companies without fetching any contacts or creating drafts',async()=>{
  const calls=setup(), response=res(); await appData(req({}, {view:'companies'}),response);
  assert.equal(response.body.mode,'companies');
  assert.deepEqual(response.body.companies.map(c=>c.name),['Shodh AI','Other Company']);
  assert.equal(calls.length,2);
});
test('selected company loads its own contacts and has no Shodh default copy',async()=>{
  setup();const response=res();await appData(req({}, {companyId:'other'}),response);
  assert.equal(response.statusCode,200);assert.equal(response.body.company.name,'Other Company');
  assert.equal(response.body.google.sheetId,'other');assert.equal(response.body.contacts[0].name,'Person');
  assert.equal(response.body.settings.fixed_template,'');
  assert.match(response.body.settings.email_subject,/Other Company/);
});
test('draft uses selected company wording and updates only its tracker',async()=>{
  const calls=setup({settings:[['fixed_template','Exact other company wording'],['founder_note','Exact founder words']]}),response=res();
  await draft(req({companyId:'other',rowNumber:2,cleanedNote:'Exact personal words'}),response);
  assert.equal(response.statusCode,200);assert.match(response.body.body,/Exact other company wording/);
  assert.match(response.body.body,/Forwarded message/);assert.doesNotMatch(response.body.body,/Shodh|Arastu/);
  assert.ok(calls.some(c=>c.method==='PUT' && c.url.includes('/other/')));
  assert.ok(!calls.some(c=>c.url.includes('/home/values/Contacts')));
});
test('unknown company cannot read contacts or create a Gmail draft',async()=>{
  const calls=setup(),response=res();await draft(req({companyId:'unlisted',rowNumber:2,cleanedNote:'My words'}),response);
  assert.notEqual(response.statusCode,200);assert.match(response.body.error,/no longer available/);
  assert.equal(calls.length,2);
});
test('skipping a person updates the selected company only',async()=>{
  const calls=setup(),response=res();await updateContact(req({companyId:'other',rowNumber:2,patch:{status:'Skipped'}}),response);
  assert.equal(response.statusCode,200);assert.equal(response.body.contact.status,'Skipped');
  assert.equal(calls.filter(c=>c.method==='PUT').length,1);assert.ok(calls.find(c=>c.method==='PUT').url.includes('/other/'));
});
test('registry permission failure does not silently switch to Shodh',async()=>{
  setup({registryError:'Permission denied'});const response=res();await appData(req({}, {view:'companies'}),response);
  assert.equal(response.statusCode,500);assert.equal(response.body.companies,undefined);
});
test('registry accepts sheet URLs and keeps names as text, rejects invalid URLs',()=>{
  const fallback={id:'home',name:'Shodh AI'};
  assert.equal(companiesFromRows([['New','https://docs.google.com/spreadsheets/d/other/edit','Details']],fallback)[1].id,'other');
  assert.throws(()=>companiesFromRows([['New','https://example.com/sheet']],fallback),/Check the Sheet link/);
});
