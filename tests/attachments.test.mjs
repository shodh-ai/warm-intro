import test,{mock,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {getDriveAttachment,emailMime,driveFileReference,MAX_ATTACHMENT_BYTES} from '../api/_lib/attachments.js';
import {SIMPLE_HEADERS,rowsToContacts,updateContactRow} from '../api/_lib/data.js';
import draft from '../api/draft.js';
import {encryptJson} from '../api/_lib/security.js';
delete process.env.APP_ACCESS_CODE;delete process.env.GOOGLE_SHEET_ID;
afterEach(()=>mock.restoreAll());
test('Drive file URLs cannot direct authenticated requests to another host or a folder',()=>{
 assert.equal(driveFileReference('https://drive.google.com/file/d/deck/view').id,'deck');
 assert.equal(driveFileReference('https://docs.google.com/presentation/d/slides/edit').id,'slides');
 for(const url of ['https://evil.com/file/d/deck','http://drive.google.com/file/d/deck','https://drive.google.com/drive/folders/folder']) assert.throws(()=>driveFileReference(url));
});
test('downloads actual PDF bytes and creates a MIME attachment with safe filename headers',async()=>{
 const bytes=Buffer.from('%PDF-1.7\nDeck contents');
 mock.method(globalThis,'fetch',async url=>url.includes('alt=media')?new Response(bytes):Response.json({name:'Pitch "deck".pdf',mimeType:'application/pdf',size:bytes.length}));
 const attachment=await getDriveAttachment('token','https://drive.google.com/file/d/deck/view');
 assert.deepEqual(attachment.bytes,bytes);
 const raw=emailMime(['Subject: Test'],'Exact words\nSecond line',attachment);
 assert.match(raw,/multipart\/mixed/);assert.match(raw,/Content-Disposition: attachment/);
 assert.ok(raw.includes(bytes.toString('base64')));assert.ok(raw.includes(Buffer.from('Exact words\nSecond line').toString('base64')));
});
test('exports Google Slides as PDF',async()=>{
 const calls=[];mock.method(globalThis,'fetch',async url=>{calls.push(url);return url.includes('/export?')?new Response('%PDF-slides'):Response.json({name:'Deck',mimeType:'application/vnd.google-apps.presentation'});});
 const attachment=await getDriveAttachment('token','https://docs.google.com/presentation/d/slides/edit');
 assert.equal(attachment.name,'Deck.pdf');assert.ok(calls[1].includes('mimeType=application%2Fpdf'));
});
test('denied access and oversized files stop before creating a draft',async()=>{
 for(const metadata of [null,{name:'big.pdf',size:MAX_ATTACHMENT_BYTES+1,mimeType:'application/pdf'}]) {
  mock.restoreAll();mock.method(globalThis,'fetch',async()=>metadata?Response.json(metadata):Response.json({error:{}},{status:403}));
  await assert.rejects(getDriveAttachment('token','https://drive.google.com/file/d/deck/view'),/Reconnect|10 MB/);
 }
});
test('new layout retains per-row template and attachment; writes only hidden tracking columns',async()=>{
 const [contact]=rowsToContacts([['Person','','Context','Exact template','https://drive.google.com/file/d/deck/view']],SIMPLE_HEADERS);
 assert.equal(contact.template,'Exact template');assert.equal(contact.attachmentUrl,'https://drive.google.com/file/d/deck/view');
 let saved;mock.method(globalThis,'fetch',async(url,options)=>{saved={url,body:JSON.parse(options.body)};return Response.json({});});
 await updateContactRow('token','sheet',2,{status:'Draft Ready'},contact);
 assert.ok(decodeURIComponent(saved.url).includes('Contacts!H2:P2'));assert.ok(saved.url.includes('valueInputOption=RAW'));assert.equal(saved.body.values[0][2],'Draft Ready');
});
for(const denied of [false,true]) test(`row template precedes forward; attachment ${denied?'failure prevents Gmail creation':'is included in Gmail draft'}`,async()=>{
 const calls=[];mock.method(globalThis,'fetch',async(url,options={})=>{
  calls.push({url,...options});
  if(url.includes('oauth2'))return Response.json({access_token:'token'});
  if(url.includes('/values/Contacts?'))return Response.json({values:[SIMPLE_HEADERS,['Person','','Context','Exact row template','https://drive.google.com/file/d/deck/view']]});
  if(url.includes('/values/Settings!'))return Response.json({values:[['fixed_template','Wrong global template'],['founder_note','Original forwarded words']]});
  if(url.includes('drive/v3'))return denied?Response.json({error:{}},{status:403}):url.includes('alt=media')?new Response('%PDF-test'):Response.json({name:'deck.pdf',mimeType:'application/pdf'});
  if(url.includes('gmail.googleapis'))return Response.json({id:'draft'});
  if(options.method==='PUT')return Response.json({updatedRows:1});
  throw new Error(url);
 });
 const res={statusCode:200,status(n){this.statusCode=n;return this;},json(b){this.body=b;}};
 await draft({method:'POST',headers:{cookie:`google_session=${encryptJson({sheetId:'home',refresh_token:'test'})}`},body:{rowNumber:2,cleanedNote:'Exact Arun words'}},res);
 const gmail=calls.find(c=>c.url.includes('gmail.googleapis'));
 if(denied){assert.equal(res.statusCode,400);assert.equal(gmail,undefined);assert.ok(!calls.some(c=>c.method==='PUT'));}
 else{assert.equal(res.statusCode,200);assert.ok(res.body.body.indexOf('Exact row template')<res.body.body.indexOf('Forwarded message'));assert.doesNotMatch(res.body.body,/Wrong global template/);assert.equal(res.body.attachment.name,'deck.pdf');assert.match(Buffer.from(JSON.parse(gmail.body).message.raw,'base64url').toString(),/multipart\/mixed/);}
});
