import { getCompanies, resolveCompany, registrySheetId, companyDefaults } from './_lib/companies.js';
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
    if (req.query?.view === 'companies') {
      const companies = await getCompanies(accessToken, session);
      return res.status(200).json({ mode: 'companies', companies, google, registryUrl: `https://docs.google.com/spreadsheets/d/${registrySheetId(session)}/edit` });
    }
    const company = await resolveCompany(accessToken, session, req.query?.companyId);
    google.sheetId = company.id;
    google.sheetUrl = `https://docs.google.com/spreadsheets/d/${company.id}/edit`;
    const [contacts, settings] = await Promise.all([getContacts(accessToken, company.id), getSettings(accessToken, company.id, companyDefaults(company, session))]);
    res.status(200).json({ mode: 'google', contacts, settings, sheetId: company.id, company, google });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
