export function resolveLanguage(saved: string | null, primary: string): 'ar' | 'en' {
  if (saved === 'ar' || saved === 'en') return saved;
  return primary.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}
export function initialLanguage(): 'ar' | 'en' {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('nuqta-language');
  } catch {
    /* Device language still works without storage. */
  }
  return resolveLanguage(saved, navigator.languages?.[0] || navigator.language || 'en');
}
/**
 * The locale for dates and numbers. Arabic uses Western digits (0-9), as phones in Egypt do,
 * so numbers never mix two digit styles and render in every font.
 */
export function intlLocale(lang: string): string {
  return lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en';
}
