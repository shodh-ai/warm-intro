// Opening the app does not compose another message; the draft already exists.
export function gmailDestination({ userAgent = '', platform = '', maxTouchPoints = 0, email = '' } = {}) {
  const webUrl = email ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#drafts` : 'https://mail.google.com/mail/u/0/#drafts';
  if (/Android/i.test(userAgent)) return {
    mobile: true, webUrl,
    appUrl: `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.APP_EMAIL;package=com.google.android.gm;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`
  };
  if (/iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return { mobile: true, webUrl, appUrl: 'googlegmail://' };
  return { mobile: false, webUrl, appUrl: webUrl };
}
