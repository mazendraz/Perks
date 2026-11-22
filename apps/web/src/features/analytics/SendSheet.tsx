import { useEffect, useState } from 'react';
import {
  fillWalletMessage,
  walletMessageInput,
  type WalletAudience,
} from '../../../../../packages/contracts/src/owner-plan.js';
import { segmentMessages } from '../../../../../packages/contracts/src/analytics-messages.js';
import type { Language } from '../../../../../packages/contracts/src/index.js';
import { api, ApiError, errorText } from '../../api.js';
import { Icon } from '../../../../../packages/ui/src/Icon.js';
import { pick, say } from './copy.js';
import { num } from './parts.js';
import { useWalletMessagePreview, WalletBlockedHelp, WalletReachDetails } from '../WalletReach.js';

const MAX = 150;
const t = {
  title: { ar: 'ابعت رسالة على الـWallet', en: 'Send a Wallet message' },
  to: { ar: 'هتوصل لـ', en: 'Goes to' },
  reach: {
    ar: 'زبون ممكن توصلهم رسالة الـWallet',
    en: 'customers can receive this Wallet message',
  },
  reachOf: { ar: '(من {total} في الشريحة)', en: '(of {total} in this group)' },
  counting: { ar: 'بنعدّ…', en: 'Counting…' },
  message: { ar: 'الرسالة', en: 'Message' },
  hint: {
    ar: '{name} = اسم الزبون · {business} = اسم المحل',
    en: '{name} = customer name · {business} = your shop',
  },
  preview: { ar: 'كده هتبان على موبايل الزبون', en: 'How it shows on the customer’s phone' },
  left: { ar: 'فاضلك {n} رسالة الشهر ده', en: '{n} messages left this month' },
  noneLeft: { ar: 'الرسايل خلصت الشهر ده', en: 'No messages left this month' },
  send: { ar: 'ابعت', en: 'Send' },
  sending: { ar: 'بنبعت…', en: 'Sending…' },
  tooLong: {
    ar: 'اكتب الرسالة في 150 حرف أو أقل. تقدر تستخدم {name} و{business} بس.',
    en: 'Keep it to 150 characters. You can use {name} and {business} only.',
  },
  sent: {
    ar: 'تمام! الرسالة هتوصل لـ{n} زبون {when}.',
    en: 'Done! It reaches {n} customers {when}.',
  },
  soon: { ar: 'خلال دقايق', en: 'within minutes' },
  morning: { ar: 'الساعة 10 الصبح عشان منزعجش حد بالليل', en: 'at 10 AM so nobody is woken up' },
  close: { ar: 'إغلاق', en: 'Close' },
  noWallet: {
    ar: 'رسايل الـWallet مش متاحة دلوقتي. كلّم فريق Perks.',
    en: 'Wallet messages are not available right now. Contact the Perks team.',
  },
};
interface State {
  used: number;
  limit: number | null;
  providers: { apple: boolean; google: boolean };
  merchantName: string;
}

/** Review a ready message for one group of customers, edit it if you like, and send. */
export function SendSheet({
  merchantId,
  audience,
  label,
  lang,
  onClose,
  onSent,
}: {
  merchantId: string;
  audience: WalletAudience;
  label: string;
  lang: Language;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const base = '/merchants/' + merchantId + '/wallet-messages';
  const template = segmentMessages[audience];
  const { preview, error: previewError, refresh } = useWalletMessagePreview(base, audience);
  const [state, setState] = useState<State | null>(null),
    [body, setBody] = useState(template?.ar ?? ''),
    [key, setKey] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    api<State>(base)
      .then(setState)
      .catch((e) => setError(errorText(e, lang)));
  }, [merchantId]);
  const left = state && state.limit !== null ? Math.max(0, state.limit - state.used) : null;
  const noProvider = state && !state.providers.apple && !state.providers.google;
  const input = {
    audience,
    ...(audience === 'inactive' ? { inactiveDays: 30 } : {}),
    bodyAr: body.trim(),
    // The English twin only while the owner keeps the ready text; edited text goes as written.
    ...(template && body.trim() === template.ar ? { bodyEn: template.en } : {}),
  };
  const valid = walletMessageInput.safeParse(input).success;
  const canSend = !!state && !noProvider && valid && !!preview?.customers && left !== 0 && !busy;
  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ recipients: number; sendAfter: string }>(base, {
        method: 'POST',
        key,
        body: input,
      });
      const later = Date.parse(r.sendAfter) > Date.now() + 60000;
      onSent(
        say(t.sent, lang, {
          n: num(r.recipients, lang),
          when: pick(later ? t.morning : t.soon, lang),
        }),
      );
    } catch (e) {
      setError(errorText(e, lang));
      if (e instanceof ApiError && e.code === 'NO_RECIPIENTS') refresh();
      if (!(e instanceof ApiError) || e.status !== 0) setKey(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop sheet-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="dialog an-sheet an-send"
        role="dialog"
        aria-modal="true"
        aria-labelledby="an-send-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="an-sheet-head">
          <div>
            <h2 id="an-send-title">{pick(t.title, lang)}</h2>
            <p className="an-caption">
              {pick(t.to, lang)} <strong>{label}</strong>
            </p>
          </div>
          <button
            className="an-icon-button"
            data-dialog-close
            aria-label={pick(t.close, lang)}
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        {previewError ? (
          <div className="an-callout warn" role="alert">
            <p>{errorText(previewError, lang)}</p>
            <button className="text-button" type="button" onClick={refresh}>
              {lang === 'ar' ? 'جرّب تاني' : 'Try again'}
            </button>
          </div>
        ) : (
          <p className="an-reach" role="status">
            {!preview ? (
              pick(t.counting, lang)
            ) : (
              <>
                <strong className="an-num">{num(preview.customers, lang)}</strong>{' '}
                {pick(t.reach, lang)}{' '}
                {preview.groupSize > preview.customers && (
                  <span className="an-muted">
                    {say(t.reachOf, lang, { total: num(preview.groupSize, lang) })}
                  </span>
                )}
              </>
            )}
          </p>
        )}
        {preview && !noProvider && (preview.customers === 0 || left === 0) ? (
          <WalletBlockedHelp preview={preview} lang={lang} noneLeft={left === 0} />
        ) : (
          preview &&
          !noProvider && (
            <WalletReachDetails
              preview={preview}
              lang={lang}
              refresh={refresh}
              className="an-callout warn"
            />
          )
        )}
        {noProvider && <p className="an-callout warn">{pick(t.noWallet, lang)}</p>}
        <label className="an-message">
          <span>{pick(t.message, lang)}</span>
          <textarea
            value={body}
            maxLength={MAX + 20}
            rows={3}
            dir="auto"
            onChange={(e) => setBody(e.target.value)}
          />
          <span className="an-message-meta">
            <small className="an-muted">{pick(t.hint, lang)}</small>
            <small className={body.trim().length > MAX ? 'an-over' : 'an-muted'}>
              <bdi dir="ltr">
                {body.trim().length}/{MAX}
              </bdi>
            </small>
          </span>
        </label>
        {!valid && body.trim().length > 0 && (
          <p className="an-callout warn">{pick(t.tooLong, lang)}</p>
        )}
        <div className="an-phone" aria-label={pick(t.preview, lang)}>
          <span className="an-phone-label">{pick(t.preview, lang)}</span>
          <div className="an-notification">
            <span className="an-notification-icon" aria-hidden="true">
              <Icon name="cards" size={18} />
            </span>
            <div>
              <strong>{state?.merchantName ?? ''}</strong>
              <p dir="auto">
                {fillWalletMessage(
                  body.trim() || '…',
                  lang === 'ar' ? 'مريم' : 'Mariam',
                  state?.merchantName ?? '',
                )}
              </p>
            </div>
          </div>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <footer className="an-send-foot">
          <small className={left === 0 ? 'an-over' : 'an-muted'}>
            {left === null
              ? ''
              : left === 0
                ? pick(t.noneLeft, lang)
                : say(t.left, lang, { n: left })}
          </small>
          <button className="primary" disabled={!canSend} onClick={() => void send()}>
            {pick(busy ? t.sending : t.send, lang)}
          </button>
        </footer>
      </div>
    </div>
  );
}
