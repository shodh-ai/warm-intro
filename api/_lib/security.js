import crypto from 'crypto';

function key() {
  const secret = process.env.APP_SECRET || 'dev-only-secret-change-me';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

export function decryptJson(token) {
  if (!token) return null;
  try {
    const buf = Buffer.from(token, 'base64url');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookie(name, value, opts = {}) {
  const pieces = [`${name}=${encodeURIComponent(value)}`];
  pieces.push(`Path=${opts.path || '/'}`);
  pieces.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.httpOnly !== false) pieces.push('HttpOnly');
  if (opts.secure !== false) pieces.push('Secure');
  if (opts.maxAge) pieces.push(`Max-Age=${opts.maxAge}`);
  return pieces.join('; ');
}

export function appAuthToken() {
  return crypto.createHmac('sha256', key()).update('arun-intro-app').digest('base64url');
}

export function isAppAuthed(req) {
  if (!process.env.APP_ACCESS_CODE) return true;
  const cookies = parseCookies(req);
  const a = Buffer.from(cookies.app_auth || '');
  const b = Buffer.from(appAuthToken());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function requireAppAuth(req, res) {
  if (isAppAuthed(req)) return true;
  res.status(401).json({ error: 'LOCKED', message: 'Enter the app access code.' });
  return false;
}

export function getGoogleSession(req) {
  const cookies = parseCookies(req);
  return decryptJson(cookies.google_session);
}

export function setGoogleSession(res, session) {
  res.setHeader('Set-Cookie', cookie('google_session', encryptJson(session), { maxAge: 60 * 60 * 24 * 180 }));
}

export function publicBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
