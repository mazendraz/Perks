import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import type { LegalNotice } from '../../../../packages/contracts/src/legal.js';
import { api, errorText } from '../api.js';
export function LegalPage({ kind, lang }: { kind: 'privacy' | 'terms'; lang: Language }) {
  const [notice, setNotice] = useState<LegalNotice | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setNotice(null);
    setError('');
    void api<LegalNotice>('/public/legal?lang=' + lang)
      .then((value) => {
        if (active) setNotice(value);
      })
      .catch((error) => {
        if (active) setError(errorText(error, lang));
      });
    return () => {
      active = false;
    };
  }, [lang, attempt]);
  const ar = lang === 'ar',
    doc = notice?.[kind],
    failed = !doc && Boolean(error);
  return (
    <main id="main" className="legal-page">
      <span className="eyebrow">{ar ? 'Perks · معلومات تهمك' : 'Perks · Your information'}</span>
      <h1>
        {doc?.title ||
          (failed
            ? ar
              ? 'الصفحة مش متاحة دلوقتي'
              : 'This page is unavailable right now'
            : ar
              ? 'بنفتح الصفحة…'
              : 'Loading…')}
      </h1>
      {notice?.reviewRequired !== false && (
        <p className="notice" role="note">
          {ar
            ? 'مسودة للتجربة المحلية — مراجعة قانونية مطلوبة قبل الإطلاق.'
            : 'Local testing draft — legal review required before launch.'}
        </p>
      )}
      {failed && (
        <>
          <p role="alert" className="error-text">
            {error}
          </p>
          <button
            type="button"
            className="secondary small"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {ar ? 'حاول تاني' : 'Try again'}
          </button>
        </>
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
