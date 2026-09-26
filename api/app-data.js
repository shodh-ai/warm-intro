import { accessTokenFromSession } from './_lib/google.js';
import { DEFAULT_SETTINGS, getContacts, getSettings } from './_lib/data.js';
import { getGoogleSession, requireAppAuth } from './_lib/security.js';

export default async function handler(req, res) {
  if (!requireAppAuth(req, res)) return;
  const session = getGoogleSession(req);
  const google = {
    connected: Boolean(session?.refresh_token),
    email: session?.email || '',
    sheetId: session?.sheetId || '',
    sheetUrl: session?.sheetId ? `https://docs.google.com/spreadsheets/d/${session.sheetId}/edit` : ''
  };
  if (!session?.refresh_token || !session?.sheetId) {
    return res.status(200).json({ mode: 'setup', contacts: [], settings: DEFAULT_SETTINGS, google });
  }
  try {
    const { accessToken } = await accessTokenFromSession(req, res);
    const [contacts, settings] = await Promise.all([getContacts(accessToken, session.sheetId), getSettings(accessToken, session.sheetId)]);
    res.status(200).json({ mode: 'google', contacts, settings, sheetId: session.sheetId, google });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
