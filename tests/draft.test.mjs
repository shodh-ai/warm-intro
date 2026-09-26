import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/draft.js';
import { encryptJson } from '../api/_lib/security.js';

delete process.env.APP_ACCESS_CODE;
afterEach(() => mock.restoreAll());

const approvedNote = 'I enjoyed our conversation.\nI think this team would be useful for your work.';
const fixedTemplate = 'Please meet the Shodh AI team.\n\nThey will share their research with you.';
const contactRow = ['Priya Mehta', 'Research Co.', 'priya@example.com', 'Research introduction', 'Arun knows Priya', 'Old transcript', 'Old saved note', 'Need Arun Note'];

function request(body = {}) {
  const session = encryptJson({ refresh_token: 'mock-refresh-token', sheetId: 'mock-sheet' });
  return { method: 'POST', headers: { cookie: `google_session=${session}` }, body: { rowNumber: 2, cleanedNote: approvedNote, transcript: approvedNote, ...body } };
}
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; }, setHeader() {} };
}
function googleMock({ gmailStatus = 200, gmailResult = { id: 'draft-123' }, sheetWriteStatus = 200, recipient, followupDays = '5', founderNote = '', cc = '', deck = '' } = {}) {
  const calls = [];
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, ...options });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'mock-access-token' });
    if (url.includes('/values/Contacts!A2%3AN') && options.method !== 'PUT') {
      const row = [...contactRow];
      if (recipient !== undefined) row[2] = recipient;
      return Response.json({ values: [row] });
    }
    if (url.includes('/values/Settings!')) return Response.json({ values: [
      ['email_subject', 'Meet the team, {{FirstName}} — {{Company}}'],
      ['founder_note', founderNote], ['cc_email', cc], ['deck_url', deck], ['fixed_template', fixedTemplate], ['signature', 'Best,\nArun Seth'], ['followup_days', followupDays]
    ] });
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts') return Response.json(gmailResult, { status: gmailStatus });
    if (options.method === 'PUT' && url.includes('/values/Contacts!')) return Response.json(sheetWriteStatus === 200 ? { updatedRows: 1 } : { error: { message: 'Sheet unavailable' } }, { status: sheetWriteStatus });
    throw new Error(`Unexpected mocked request: ${url}`);
  });
  return calls;
}
const gmailCalls = calls => calls.filter(call => call.url.startsWith('https://gmail.googleapis.com/'));
const sheetWrites = calls => calls.filter(call => call.method === 'PUT');

test('creates a Gmail draft using the approved note and Sheet template, then records its ID in Sheets', async () => {
  const calls = googleMock();
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.draftCreated, true);
  assert.equal(res.body.trackerUpdated, true);
  assert.equal(res.body.draftId, 'draft-123');
  assert.equal(res.body.subject, 'Meet the team, Priya — Research Co.');
  const expectedBody = `Hi Priya,\n\n${approvedNote}\n\n${fixedTemplate}\n\nBest,\nArun Seth`;
  assert.equal(res.body.body, expectedBody);
  const [gmail] = gmailCalls(calls);
  assert.equal(gmailCalls(calls).length, 1);
  assert.equal(gmail.url, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts');
  assert.equal(gmail.method, 'POST');
  const raw = Buffer.from(JSON.parse(gmail.body).message.raw, 'base64url').toString('utf8');
  assert.equal(raw.split('\r\n\r\n')[1], expectedBody);
  assert.match(raw, /^To: priya@example.com\r\n/);
  const [write] = sheetWrites(calls);
  assert.equal(sheetWrites(calls).length, 1);
  assert.ok(calls.indexOf(write) > calls.indexOf(gmail));
  const row = JSON.parse(write.body).values[0];
  assert.deepEqual(row.slice(5, 9), [approvedNote, approvedNote, 'Draft Ready', 'draft-123']);
  assert.ok(!calls.some(call => call.url.includes('/send')));
});

test('an empty approved note cannot silently fall back to an older Sheet note', async () => {
  const calls = googleMock();
  const res = response();
  await handler(request({ cleanedNote: '  ' }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /approve your note/);
  assert.equal(calls.length, 0);
});

test('a Gmail failure never updates the tracker or reports draft success', async () => {
  const calls = googleMock({ gmailStatus: 403, gmailResult: { error: { message: 'Gmail permission denied' } } });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /permission denied/);
  assert.equal(res.body.ok, undefined);
  assert.equal(res.body.draftCreated, undefined);
  assert.equal(sheetWrites(calls).length, 0);
});

test('a Gmail response without a draft ID is not treated as success', async () => {
  const calls = googleMock({ gmailResult: {} });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /did not confirm/);
  assert.equal(res.body.ok, undefined);
  assert.equal(sheetWrites(calls).length, 0);
});

test('a Sheet write failure explicitly reports the already-created Gmail draft', async () => {
  const calls = googleMock({ sheetWriteStatus: 503 });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'TRACKER_UPDATE_FAILED');
  assert.equal(res.body.ok, undefined);
  assert.equal(res.body.draftCreated, true);
  assert.equal(res.body.trackerUpdated, false);
  assert.equal(res.body.draftId, 'draft-123');
  assert.match(res.body.error, /Open Gmail/);
  assert.equal(gmailCalls(calls).length, 1);
});

test('an invalid follow-up setting cannot fail after the draft has been created', async () => {
  const calls = googleMock({ followupDays: 'later' });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  const row = JSON.parse(sheetWrites(calls)[0].body).values[0];
  const expected = new Date(new Date(row[9]).getTime() + 5 * 86400000).toISOString().slice(0, 10);
  assert.equal(row[11], expected);
});

test('malformed Sheet email addresses cannot inject extra message headers', async () => {
  const calls = googleMock({ recipient: 'priya@example.com\r\nBcc: someone@example.com' });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 400);
  assert.equal(gmailCalls(calls).length, 0);
  assert.equal(sheetWrites(calls).length, 0);
});


test('appends Arastu company note below Arun signature and includes configured CC and deck', async () => {
  const calls = googleMock({ founderNote: 'Our company note.\nWarm Regards,\nArastu', cc: 'founder@example.com', deck: 'https://example.com/deck' });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.body.indexOf(approvedNote) < res.body.body.indexOf(fixedTemplate));
  assert.ok(res.body.body.indexOf('Arun Seth') < res.body.body.indexOf('More about Shodh — from Arastu:'));
  assert.ok(res.body.body.endsWith('Company deck: https://example.com/deck'));
  const raw = Buffer.from(JSON.parse(gmailCalls(calls)[0].body).message.raw, 'base64url').toString('utf8');
  assert.match(raw, /\r\nCc: founder@example.com\r\n/);
});

test('rejects CC header injection before creating any draft', async () => {
  const calls = googleMock({ cc: 'founder@example.com\r\nBcc: other@example.com' });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 400);
  assert.equal(gmailCalls(calls).length, 0);
});


test('a blank contact email creates a recipient-free Gmail draft and updates the tracker', async () => {
  const calls = googleMock({ recipient: '   ' });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.draftCreated, true);
  const raw = Buffer.from(JSON.parse(gmailCalls(calls)[0].body).message.raw, 'base64url').toString('utf8');
  assert.doesNotMatch(raw, /^To:/m);
  assert.ok(raw.includes(approvedNote));
  assert.equal(JSON.parse(sheetWrites(calls)[0].body).values[0][7], 'Draft Ready');
  assert.ok(!calls.some(call => call.url.includes('/send')));
});
