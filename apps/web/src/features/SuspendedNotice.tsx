import { useEffect, useState } from 'react';
import type { Grant, Language } from '../../../../packages/contracts/src/index.js';
import { api } from '../api.js';

// Perks support line shown to a business whose account the platform has suspended.
export const SUPPORT_PHONE = '01006111380';
const whatsapp = 'https://wa.me/2' + SUPPORT_PHONE;

type OnboardingDraft = {
  publication?: { merchantId: string } | null;
  rejection_reason?: string | null;
};

/**
 * The reason a self-service shop was paused, when it was paused because its InstaPay transfer was
 * rejected: the owner can fix that themselves instead of calling support.
 */
function useRejectedTransfer(grant: Grant) {
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => {
    if (grant.role !== 'owner') return;
    let active = true;
    void api<{ draft: OnboardingDraft | null }>(
      '/merchant-onboarding/draft?merchantId=' + encodeURIComponent(grant.merchant_id),
      {},
      false,
    )
      .then(({ draft }) => {
        if (
          active &&
          draft?.rejection_reason &&
          draft.publication?.merchantId === grant.merchant_id
        )
          setReason(draft.rejection_reason);
      })
      .catch(() => {
        /* Not a self-service shop, or offline: the general notice still applies. */
      });
    return () => {
      active = false;
    };
  }, [grant.role, grant.merchant_id]);
  return reason;
}

/** Replaces the owner dashboard and the cashier screen while the business is suspended. */
export function SuspendedNotice({ grant, lang }: { grant: Grant; lang: Language }) {
  const ar = lang === 'ar';
  const rejected = useRejectedTransfer(grant);
  if (rejected)
    return (
      <section className="panel suspended-notice" role="alert">
        <span className="eyebrow">{ar ? 'الحساب متوقف مؤقتًا' : 'ACCOUNT PAUSED'}</span>
        <h1>
          {ar ? 'مقدرناش نأكد تحويل اشتراك ' : 'We could not confirm the transfer for '}
          <bdi>{grant.name}</bdi>
        </h1>
        <p>
          <strong>{ar ? 'السبب: ' : 'Reason: '}</strong>
          {rejected}
        </p>
        <p>
          {ar
            ? 'المحل متوقف لحد ما بيانات التحويل تتصحّح. كروت العملاء وأختامهم محفوظة ومش هتضيع.'
            : 'The shop is paused until the transfer details are corrected. Customer cards and stamps are kept safe.'}
        </p>
        <div className="suspended-actions">
          <a className="primary" href="/onboarding">
            {ar ? 'صحّح بيانات التحويل' : 'Correct transfer details'}
          </a>
          <a className="secondary" href={whatsapp} target="_blank" rel="noreferrer">
            {ar ? 'كلمنا على واتساب' : 'Message us on WhatsApp'}
          </a>
        </div>
      </section>
    );
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
