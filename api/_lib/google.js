import { getGoogleSession, setGoogleSession } from './security.js';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
].join(' ');

export async function accessTokenFromSession(req, res) {
  const session = getGoogleSession(req);
  if (!session?.refresh_token) return { session: null, accessToken: null };

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    refresh_token: session.refresh_token,
    grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error_description || data.error || 'Google token refresh failed');
  return { session, accessToken: data.access_token };
}

export async function googleFetch(url, accessToken, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  const r = await fetch(url, { ...options, headers });
  let data;
  const type = r.headers.get('content-type') || '';
  data = type.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) {
    const msg = typeof data === 'string' ? data : data?.error?.message || JSON.stringify(data);
    throw new Error(msg || `Google API ${r.status}`);
  }
  return data;
}

export async function updateGoogleSession(req, res, patch) {
  const current = getGoogleSession(req) || {};
  const next = { ...current, ...patch };
  setGoogleSession(res, next);
  return next;
}

export function extractSheetId(input) {
  if (!input) return null;
  const m = String(input).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : String(input).trim();
}

export async function readRange(accessToken, sheetId, range) {
  const u = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const data = await googleFetch(u, accessToken);
  return data.values || [];
}

export async function writeRange(accessToken, sheetId, range, values) {
  const u = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  return googleFetch(u, accessToken, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values })
  });
}
