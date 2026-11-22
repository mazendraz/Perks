import { useEffect, useState } from 'react';
import type { CustomerInsights } from '../../../../../packages/contracts/src/analytics.js';
import type { Language } from '../../../../../packages/contracts/src/index.js';
import { api, errorText } from '../../api.js';
import { intlLocale } from '../../locale.js';
import { Icon } from '../../../../../packages/ui/src/Icon.js';
import { copy, daysText, pick, say, stampsText } from './copy.js';
import { num } from './parts.js';

const t = {
  visits: { ar: 'زيارات', en: 'Visits' },
  rhythm: { ar: 'بييجي كل', en: 'Comes every' },
  last: { ar: 'آخر زيارة', en: 'Last visit' },
  toReward: { ar: 'فاضله على الهدية', en: 'To the reward' },
  rewards: { ar: 'هدايا خدها', en: 'Rewards claimed' },
  wallet: { ar: 'الكارت في الـWallet', en: 'Card in Wallet' },
  yes: { ar: 'أيوه', en: 'Yes' },
  no: { ar: 'لأ', en: 'No' },
  favorite: { ar: 'فرعه المفضّل: {b}', en: 'Usual branch: {b}' },
  joined: { ar: 'معاه الكارت من {d}', en: 'Card holder since {d}' },
  history: { ar: 'اللي حصل', en: 'History' },
  visit: { ar: 'زيارة · {n}', en: 'Visit · {n}' },
  receipt: { ar: 'ريسيت {r}', en: 'Receipt {r}' },
  earned: { ar: 'استحق هدية: {title}', en: 'Earned: {title}' },
  redeemed: { ar: 'صرف هدية: {title}', en: 'Claimed: {title}' },
  message: { ar: 'وصلته رسالة', en: 'Got a message' },
  reminder: { ar: 'وصله تذكير أوتوماتيك', en: 'Got an automatic reminder' },
  ago: { ar: 'من {n}', en: '{n} ago' },
  today: { ar: 'النهارده', en: 'today' },
};

/** One customer at a glance: rhythm, card, and what happened (visits with receipts, rewards, messages). */
export function CustomerSheet({
  merchantId,
  profileId,
  lang,
  onClose,
}: {
  merchantId: string;
  profileId: string;
  lang: Language;
  onClose: () => void;
}) {
  const [c, setC] = useState<CustomerInsights | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    api<CustomerInsights>('/merchants/' + merchantId + '/customers/' + profileId + '/insights')
      .then(setC)
      .catch((e) => setError(errorText(e, lang)));
  }, [merchantId, profileId]);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(lang), {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  return (
    <div className="modal-backdrop sheet-backdrop" onClick={onClose}>
      <div
        className="dialog an-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="an-customer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="an-sheet-head">
          <div className="an-customer-head">
            <span className="an-avatar big" aria-hidden="true">
              {c?.alias.trim().charAt(0) || '•'}
            </span>
            <div>
              <h2 id="an-customer-title">{c?.alias ?? '…'}</h2>
              {c && (
                <div className="an-customer-tags">
                  <span className="an-tag">{pick(copy.segments[c.lifecycle], lang)}</span>
                  {c.tags.map((tag) => (
                    <span key={tag} className="an-tag lime">
                      {pick(copy.segments[tag], lang)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            className="an-icon-button"
            data-dialog-close
            aria-label={pick(copy.close, lang)}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {c && (
          <>
            <dl className="an-facts">
              <div>
                <dt>{pick(t.visits, lang)}</dt>
                <dd className="an-num">{num(c.visits, lang)}</dd>
              </div>
              <div>
                <dt>{pick(t.rhythm, lang)}</dt>
                <dd>{daysText(c.personalGapDays ?? c.expectedGapDays, lang)}</dd>
              </div>
              <div>
                <dt>{pick(t.last, lang)}</dt>
                <dd>
                  {c.sinceDays === null
                    ? pick(copy.noVisit, lang)
                    : c.sinceDays === 0
                      ? pick(t.today, lang)
                      : say(t.ago, lang, { n: daysText(c.sinceDays, lang) })}
                </dd>
              </div>
              <div>
                <dt>{pick(t.toReward, lang)}</dt>
                <dd>{c.stampsToReward === null ? '—' : num(c.stampsToReward, lang)}</dd>
              </div>
              <div>
                <dt>{pick(t.rewards, lang)}</dt>
                <dd className="an-num">{num(c.rewardsRedeemed, lang)}</dd>
              </div>
              <div>
                <dt>{pick(t.wallet, lang)}</dt>
                <dd>{pick(c.walletSaved ? t.yes : t.no, lang)}</dd>
              </div>
            </dl>
            <p className="an-caption">
              {say(t.joined, lang, {
                d: new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: 'medium' }).format(
                  new Date(c.joinedAt),
                ),
              })}
              {c.favoriteBranch && ' · ' + say(t.favorite, lang, { b: c.favoriteBranch })}
            </p>
            <h3 className="an-subtitle">{pick(t.history, lang)}</h3>
            <ol className="an-timeline">
              {c.timeline.map((e, i) => (
                <li key={i} className={'an-event ' + e.kind}>
                  <span className="an-event-dot" aria-hidden="true" />
                  <div>
                    <strong>
                      {e.kind === 'visit'
                        ? say(t.visit, lang, { n: stampsText(e.stamps, lang) })
                        : e.kind === 'reward_earned'
                          ? say(t.earned, lang, { title: e.title })
                          : e.kind === 'reward_redeemed'
                            ? say(t.redeemed, lang, { title: e.title })
                            : pick(
                                e.kind === 'message' && e.source === 'owner'
                                  ? t.message
                                  : t.reminder,
                                lang,
                              )}
                    </strong>
                    <small>
                      {date(e.at)}
                      {e.kind === 'visit' && e.branch && ' · ' + e.branch}
                      {e.kind === 'visit' &&
                        e.receipts.map((r) => ' · ' + say(t.receipt, lang, { r }))}
                    </small>
                    {e.kind === 'message' && e.text && (
                      <p className="an-event-text" dir="auto">
                        {e.text}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
