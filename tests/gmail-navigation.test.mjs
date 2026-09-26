import test from 'node:test';
import assert from 'node:assert/strict';
import { gmailDestination } from '../gmail-navigation.js';
test('desktop opens the connected Google account drafts', () => {
  const d = gmailDestination({userAgent:'Desktop',email:'arun@example.com'});
  assert.equal(d.mobile,false); assert.equal(d.appUrl,d.webUrl);
  assert.equal(new URL(d.webUrl).searchParams.get('authuser'),'arun@example.com');
});
test('Android targets Gmail with a browser fallback and never composes a duplicate', () => {
  const d=gmailDestination({userAgent:'Mozilla Android',email:'arun@example.com'});
  assert.ok(d.appUrl.startsWith('intent:')); assert.ok(d.appUrl.includes('package=com.google.android.gm;'));
  assert.ok(d.appUrl.includes(encodeURIComponent(d.webUrl))); assert.ok(!d.appUrl.includes('SENDTO'));
});
test('iPhone and desktop-mode iPad launch Gmail without creating a new message', () => {
  for(const device of [{userAgent:'iPhone'},{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5}]) {
    const d=gmailDestination(device); assert.equal(d.appUrl,'googlegmail://'); assert.equal(d.mobile,true);
  }
});
