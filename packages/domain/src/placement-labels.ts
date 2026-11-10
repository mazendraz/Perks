import type { Language } from '../../contracts/src/index.js';

export function enrollmentPlacementLabel(branchName: string, lang: Language) {
  return (lang === 'ar' ? 'تسجيل العملاء' : 'Enrollment') + ' • ' + branchName;
}

// Both reserved automatic formats remain localizable after a language switch.
// Custom names are business content and must never be rewritten or translated.
export function placementDisplayLabel(label: string, branchName: string, lang: Language) {
  return ['ar', 'en'].some(
    (locale) => label === enrollmentPlacementLabel(branchName, locale as Language),
  )
    ? enrollmentPlacementLabel(branchName, lang)
    : label;
}
