import { readRange } from './google.js';

export function registrySheetId(session) {
  return process.env.GOOGLE_SHEET_ID || session?.sheetId || '';
}
export function defaultCompany(session) {
  return { id: registrySheetId(session), name: 'Shodh AI', description: 'Introductions for Shodh AI' };
}
export function companiesFromRows(rows, fallback) {
  const companies = new Map([[fallback.id, fallback]]);
  for (const [name, link, description] of rows) {
    if (!String(name || '').trim() || !String(link || '').trim()) continue;
    const value = String(link).trim();
    const id = value.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)(?:\/|$)/)?.[1] || (/^[\w-]+$/.test(value) ? value : '');
    if (!id) throw new Error(`Check the Sheet link for ${name} in the Companies tab.`);
    companies.set(id, { id, name: String(name).trim(), description: String(description || '').trim() });
  }
  return [...companies.values()];
}
export async function getCompanies(accessToken, session) {
  const fallback = defaultCompany(session);
  if (!fallback.id) return [];
  let rows;
  try { rows = await readRange(accessToken, fallback.id, 'Companies!A2:C100'); }
  catch (error) {
    // Existing trackers remain usable until their Companies tab has been added.
    if (/Unable to parse range/i.test(error.message)) return [fallback];
    throw error;
  }
  return companiesFromRows(rows, fallback);
}
export async function resolveCompany(accessToken, session, requestedId) {
  const fallback = defaultCompany(session);
  // Keep already-open, single-company clients compatible with this release.
  if (!requestedId) return fallback;
  const companies = await getCompanies(accessToken, session);
  const company = companies.find(item => item.id === requestedId);
  if (!company) throw new Error('This company is no longer available. Choose a company again.');
  return company;
}
export function companyDefaults(company, session) {
  return company.id === registrySheetId(session) ? undefined : {
    email_subject: `Introduction to ${company.name} — {{FirstName}}`,
    fixed_template: '', founder_note: '', founder_heading: `More about ${company.name}:`,
    signature: 'Cheers Arun', cc_email: '', deck_url: '', followup_days: '5'
  };
}
