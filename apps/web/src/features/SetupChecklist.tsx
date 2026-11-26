import type { Language } from '../../../../packages/contracts/src/index.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';

type Step = 'logo' | 'program' | 'cashier' | 'stamp';

/** First-week checklist for a new shop. Disappears once every step is done. */
export function SetupChecklist({
  lang,
  done,
  go,
}: {
  lang: Language;
  done: Record<Step, boolean>;
  go: (tab: string) => void;
}) {
  const ar = lang === 'ar';
  const steps: { id: Step; label: string; tab: string; action: string }[] = [
    {
      id: 'logo',
      label: ar ? 'ارفع لوجو المحل' : 'Upload your logo',
      tab: 'brand',
      action: ar ? 'الهوية' : 'Branding',
    },
    {
      id: 'program',
      label: ar ? 'شغّل برنامج أختام' : 'Turn on a stamp program',
      tab: 'programs',
      action: ar ? 'البرامج' : 'Programs',
    },
    {
      id: 'cashier',
      label: ar ? 'ضيف كاشير' : 'Add a cashier',
      tab: 'team',
      action: ar ? 'الفريق' : 'Team',
    },
    {
      id: 'stamp',
      label: ar ? 'اطبع الـQR وادّي أول ختم' : 'Print the QR and give the first stamp',
      tab: 'materials',
      action: ar ? 'QR وNFC' : 'QR and NFC',
    },
  ];
  const count = steps.filter((s) => done[s.id]).length;
  if (count === steps.length) return null;
  return (
    <section className="panel setup-checklist">
      <div className="section-heading">
        <h2>{ar ? 'جهّز محلك' : 'Get your shop ready'}</h2>
        <span className="muted">
          {count}/{steps.length}
        </span>
      </div>
      <progress max={steps.length} value={count} aria-hidden="true" />
      <ol>
        {[...steps.filter((s) => !done[s.id]), ...steps.filter((s) => done[s.id])].map((s) => (
          <li key={s.id} className={done[s.id] ? 'done' : ''}>
            <Icon name={done[s.id] ? 'check' : 'spark'} size={18} />
            <span>{s.label}</span>
            {!done[s.id] && (
              <button className="text-button" onClick={() => go(s.tab)}>
                {s.action}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
