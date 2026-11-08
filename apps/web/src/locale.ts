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
