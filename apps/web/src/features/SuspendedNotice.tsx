import type { Grant, Language } from '../../../../packages/contracts/src/index.js';

// Perks support line shown to a business whose account the platform has suspended.
export const SUPPORT_PHONE = '01006111380';
const whatsapp = 'https://wa.me/2' + SUPPORT_PHONE;

/** Replaces the owner dashboard and the cashier screen while the business is suspended. */
export function SuspendedNotice({ grant, lang }: { grant: Grant; lang: Language }) {
  const ar = lang === 'ar';
  return (
    <section className="panel suspended-notice" role="alert">
      <span className="eyebrow">{ar ? 'الحساب متوقف' : 'ACCOUNT PAUSED'}</span>
      <h1>{ar ? `حساب ${grant.name} متوقف دلوقتي` : `${grant.name} is paused`}</h1>
      <p>
        {ar
          ? 'إدارة Perks وقفت الحساب ده، فمش هتقدر تدّي أختام أو مكافآت أو تعدّل حاجة لحد ما يرجع يشتغل. كروت العملاء محفوظة وأختامهم مش هتضيع.'
          : 'Perks has paused this account. Stamps, rewards and changes are off until it is back on. Customer cards and their stamps are kept safe.'}
      </p>
      <p>
        <strong>{ar ? 'كلمنا علشان نرجّعه:' : 'Contact us to turn it back on:'}</strong>{' '}
        <bdi dir="ltr">{SUPPORT_PHONE}</bdi>
      </p>
      <div className="suspended-actions">
        <a className="primary" href={whatsapp} target="_blank" rel="noreferrer">
          {ar ? 'كلمنا على واتساب' : 'Message us on WhatsApp'}
        </a>
        <a className="secondary" href={'tel:' + SUPPORT_PHONE}>
          {ar ? 'اتصل بينا' : 'Call us'}
        </a>
      </div>
    </section>
  );
}
