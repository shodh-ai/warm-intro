import crypto from 'crypto';
import { GOOGLE_SCOPES } from '../_lib/google.js';
import { cookie, encryptJson, publicBaseUrl, requireAppAuth } from '../_lib/security.js';

export default function handler(req, res) {
  if (!requireAppAuth(req, res)) return;
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).send('Google OAuth is not configured on this deployment.');
  }
  const state = crypto.randomBytes(24).toString('base64url');
  res.setHeader('Set-Cookie', cookie('google_oauth_state', encryptJson({ state, at: Date.now() }), { maxAge: 600 }));
  const redirectUri = `${publicBaseUrl(req)}/api/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
