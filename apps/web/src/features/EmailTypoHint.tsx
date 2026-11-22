import type { Language } from '../../../../packages/contracts/src/index.js';

// Common providers and the mistyped domains people actually write for them.
const known: Record<string, string> = {
  'gamil.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'yaho.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'iclod.com': 'icloud.com',
  'icloud.co': 'icloud.com',
};

/** Returns the corrected address when the domain looks like a typo of a common provider. */
export function emailTypoSuggestion(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  const fixed = known[domain];
  return fixed ? email.slice(0, at + 1) + fixed : null;
}

/** A one-line "did you mean" under an email field. Renders nothing when the address looks fine. */
export function EmailTypoHint({
  email,
  lang,
  onUse,
}: {
  email: string;
  lang: Language;
  onUse: (fixed: string) => void;
}) {
  const fixed = emailTypoSuggestion(email);
  if (!fixed) return null;
  return (
    <small className="email-typo" role="status">
      {lang === 'ar' ? 'تقصد ' : 'Did you mean '}
      <button type="button" className="link-button" onClick={() => onUse(fixed)}>
        <bdi>{fixed}</bdi>
      </button>
      {lang === 'ar' ? '؟' : '?'}
    </small>
  );
}
