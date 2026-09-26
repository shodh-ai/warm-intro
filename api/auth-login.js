import crypto from 'crypto';
import { appAuthToken, cookie } from './_lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const expected = process.env.APP_ACCESS_CODE;
  if (!expected) return res.status(200).json({ ok: true, protection: false });
  const supplied = String(req.body?.code || '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Wrong access code' });
  res.setHeader('Set-Cookie', cookie('app_auth', appAuthToken(), { maxAge: 60 * 60 * 24 * 30 }));
  return res.status(200).json({ ok: true, protection: true });
}
