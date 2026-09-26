import { cookie, decryptJson, encryptJson, parseCookies, publicBaseUrl } from '../_lib/security.js';

export default async function handler(req, res) {
  try {
    const cookies = parseCookies(req);
    const stateCookie = decryptJson(cookies.google_oauth_state);
    if (!stateCookie || stateCookie.state !== req.query?.state) return res.status(400).send('OAuth state mismatch. Please restart connection.');
    if (req.query?.error) return res.status(400).send(`Google authorization failed: ${req.query.error}`);

    const redirectUri = `${publicBaseUrl(req)}/api/google/callback`;
    const params = new URLSearchParams({
      code: req.query.code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.refresh_token) throw new Error(token.error_description || 'No refresh token returned. Reconnect with consent.');

    const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const user = await userRes.json();
    if (!userRes.ok || !user.email || user.email_verified !== true) throw new Error('Google could not verify this email address. Please reconnect.');
    const allowed = (process.env.ALLOWED_GOOGLE_EMAIL || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(String(user.email).toLowerCase())) return res.status(403).send('This Google account is not allowed for this app.');

    const previous = decryptJson(cookies.google_session);
    const sheetId = previous?.email === user.email ? previous.sheetId : '';
    const session = { refresh_token: token.refresh_token, email: user.email || '', sheetId: sheetId || process.env.GOOGLE_SHEET_ID || '' };
    const set = [
      cookie('google_session', encryptJson(session), { maxAge: 60 * 60 * 24 * 180 }),
      cookie('google_oauth_state', '', { maxAge: 1 })
    ];
    res.setHeader('Set-Cookie', set);
    res.redirect('/?connected=1');
  } catch (e) {
    res.status(500).send(`Google connection failed: ${e.message}`);
  }
}
