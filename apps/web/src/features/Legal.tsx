import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import type { LegalNotice } from '../../../../packages/contracts/src/legal.js';
import { api, errorText } from '../api.js';
export function LegalPage({ kind, lang }: { kind: 'privacy' | 'terms'; lang: Language }) {
  const [notice, setNotice] = useState<LegalNotice | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setNotice(null);
    void api<LegalNotice>('/public/legal?lang=' + lang)
      .then((value) => {
        if (active) {
          setNotice(value);
          setError('');
        }
      })
      .catch((error) => {
        if (active) setError(errorText(error, lang));
      });
    return () => {
      active = false;
    };
  }, [lang]);
  const ar = lang === 'ar',
    doc = notice?.[kind];
  return (
    <main id="main" className="legal-page">
      <span className="eyebrow">{ar ? 'Perks · معلومات تهمك' : 'Perks · Your information'}</span>
      <h1>{doc?.title || (ar ? 'بنفتح الصفحة…' : 'Loading…')}</h1>
      <p className="notice" role="note">
        {ar
          ? 'مسودة للتجربة المحلية — مراجعة قانونية مطلوبة قبل الإطلاق.'
          : 'Local testing draft — legal review required before launch.'}
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {doc?.sections.map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          <p>{section.body}</p>
        </section>
      ))}
      <nav className="legal-links" aria-label={ar ? 'معلومات الاستخدام' : 'Usage information'}>
        <a href={'/privacy?lang=' + lang}>{ar ? 'الخصوصية' : 'Privacy'}</a>
        <a href={'/terms?lang=' + lang}>{ar ? 'شروط الاستخدام' : 'Terms of use'}</a>
      </nav>
    </main>
  );
}
