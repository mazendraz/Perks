import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import {
  fillWalletMessage,
  walletMessageInput,
  type WalletAudience,
} from '../../../../packages/contracts/src/owner-plan.js';
import { api, ApiError, errorText } from '../api.js';
import { Select } from '../controls/Select.js';
import { day } from './billing-labels.js';
import { useWalletMessagePreview, WalletReachDetails } from './WalletReach.js';

interface State {
  used: number;
  limit: number | null;
  period: string;
  status: string;
  providers: { apple: boolean; google: boolean };
  merchantName: string;
  history: {
    id: string;
    audience: WalletAudience;
    inactive_days: number | null;
    body_ar: string;
    recipients: number;
    send_after: string;
    created_at: string;
    delivered: number;
    waiting: number;
    missed: number;
    returned: number;
  }[];
}
const audiences: Record<WalletAudience, [string, string]> = {
  all: ['كل العملاء اللي عندهم الكارت', 'Everyone with the card'],
  reward_ready: ['اللي هديتهم جاهزة ومستلموهاش', 'Rewards waiting to be collected'],
  near_reward: ['اللي فاضلهم ختم أو اتنين', 'One or two stamps away'],
  inactive: ['اللي بقالهم فترة مجوش', 'Not seen for a while'],
  new: ['الزباين الجداد', 'New customers'],
  one_time: ['اللي جم مرة واحدة بس', 'Came only once'],
  regular: ['الزباين المنتظمين', 'Regular customers'],
  at_risk: ['اللي اتأخروا عن عادتهم', 'Later than usual'],
  lost: ['اللي بعدوا', 'Gone quiet'],
  reactivated: ['اللي رجعوا بعد غياب', 'Came back after a long gap'],
  vip: ['زباين الـVIP', 'VIP customers'],
};
const MAX = 150;

/** The owner writes one short message; the Wallet cards of the chosen customers get it. */
export function WalletMessages({ merchantId, lang }: { merchantId: string; lang: Language }) {
  const ar = lang === 'ar';
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [audience, setAudience] = useState<WalletAudience>('all'),
    [days, setDays] = useState(30),
    [bodyAr, setBodyAr] = useState(''),
    [bodyEn, setBodyEn] = useState(''),
    [showEn, setShowEn] = useState(false),
    [confirmedReach, setConfirmedReach] = useState<number | null>(null),
    [sendKey, setSendKey] = useState(''),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState('');
  const base = '/merchants/' + merchantId + '/wallet-messages';
  const { preview, error: previewError, refresh } = useWalletMessagePreview(base, audience, days);
  const load = async () => {
    try {
      setState(await api<State>(base));
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
  }, [merchantId]);
  if (!state)
    return error ? (
      <p role="alert" className="notice error">
        {error}
      </p>
    ) : (
      <p role="status">{ar ? 'بنفتح الرسايل…' : 'Loading messages…'}</p>
    );
  const left = state.limit === null ? null : Math.max(0, state.limit - state.used);
  const noProvider = !state.providers.apple && !state.providers.google;
  const sample = fillWalletMessage(
    bodyAr || (ar ? 'رسالتك هتظهر هنا' : 'Your message shows here'),
    ar ? 'مريم' : 'Mariam',
    state.merchantName,
  );
  const body = {
    audience,
    ...(audience === 'inactive' ? { inactiveDays: days } : {}),
    bodyAr: bodyAr.trim(),
    ...(showEn && bodyEn.trim() ? { bodyEn: bodyEn.trim() } : {}),
  };
  const review = () => {
    if (!preview?.customers) return;
    setNotice('');
    const parsed = walletMessageInput.safeParse(body);
    if (!parsed.success) {
      setFormError(
        ar
          ? 'اكتب الرسالة في 150 حرف أو أقل. تقدر تستخدم {name} لاسم العميل و{business} لاسم المحل بس.'
          : 'Keep it to 150 characters. You can use {name} and {business} only.',
      );
      return;
    }
    setFormError('');
    setSendKey(crypto.randomUUID());
    setConfirmedReach(preview.customers);
  };
  const send = async () => {
    setBusy(true);
    try {
      const r = await api<{ recipients: number; sendAfter: string }>(base, {
        method: 'POST',
        key: sendKey,
        body,
      });
      setConfirmedReach(null);
      setBodyAr('');
      setBodyEn('');
      const later = Date.parse(r.sendAfter) > Date.now() + 60000;
      setNotice(
        ar
          ? `تمام! الرسالة هتوصل لـ ${r.recipients} عميل${later ? ' الساعة 10 الصبح، عشان منزعجش حد بالليل' : ' خلال دقايق'}.`
          : `Done! It reaches ${r.recipients} customers${later ? ' at 10 AM, so nobody is woken up' : ' within minutes'}.`,
      );
      await load();
      refresh();
    } catch (e) {
      setConfirmedReach(null);
      setFormError(errorText(e, lang));
      if (e instanceof ApiError && e.code === 'NO_RECIPIENTS') refresh();
      if (!(e instanceof ApiError) || e.status !== 0) setSendKey(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wallet-messages">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{ar ? 'رسايل Wallet' : 'WALLET MESSAGES'}</span>
          <h2>{ar ? 'ابعت رسالة على كارت العميل' : 'Send a message to your customers’ cards'}</h2>
        </div>
        <div className="message-allowance">
          <strong>
            <bdi>
              {state.limit === null
                ? state.used
                : ar
                  ? `${state.used} من ${state.limit}`
                  : `${state.used} of ${state.limit}`}
            </bdi>
          </strong>
          <small className="muted">{ar ? 'رسايل الشهر ده' : 'messages this month'}</small>
        </div>
      </div>
      <p className="muted">
        {ar
          ? 'الرسالة بتظهر كإشعار على موبايل العميل من كارت محلك في Apple Wallet أو Google Wallet. بتوصل بس للي وافق على الإشعارات، ومن الساعة 10 الصبح لـ 9 بالليل.'
          : 'It shows as a notification from your card in Apple or Google Wallet. Only customers who allowed notifications get it, between 10 AM and 9 PM.'}
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}
      {noProvider && (
        <p className="notice warning">
          {ar
            ? 'رسايل Wallet لسه مش شغالة عندك. كلّم فريق Perks.'
            : 'Wallet cards are not switched on for this server yet. Contact the Perks team.'}
        </p>
      )}

      <div className="message-composer">
        <div className="panel">
          <label>
            {ar ? 'مين يوصله؟' : 'Who gets it?'}
            <Select
              value={audience}
              onChange={(x) => setAudience(x.target.value as WalletAudience)}
            >
              {(Object.keys(audiences) as WalletAudience[]).map((a) => (
                <option key={a} value={a}>
                  {audiences[a][ar ? 0 : 1]}
                </option>
              ))}
            </Select>
          </label>
          {audience === 'inactive' && (
            <label>
              {ar ? 'بقاله كام يوم مجاش؟' : 'Not seen for how many days?'}
              <Select value={String(days)} onChange={(x) => setDays(Number(x.target.value))}>
                {[14, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {ar ? `${d} يوم أو أكتر` : `${d}+ days`}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {previewError ? (
            <div className="notice error" role="alert">
              <p>{errorText(previewError, lang)}</p>
              <button className="text-button" type="button" onClick={refresh}>
                {ar ? 'جرّب تاني' : 'Try again'}
              </button>
            </div>
          ) : (
            <p className="audience-count" role="status">
              {!preview
                ? ar
                  ? 'بنعد…'
                  : 'Counting…'
                : ar
                  ? `هتوصل لـ ${preview.customers} من ${preview.groupSize} عميل`
                  : `Reaches ${preview.customers} of ${preview.groupSize} customers`}
            </p>
          )}
          {preview && !noProvider && (
            <WalletReachDetails preview={preview} lang={lang} refresh={refresh} />
          )}
          <label>
            {ar ? 'الرسالة' : 'Message'}
            <textarea
              rows={3}
              maxLength={MAX}
              value={bodyAr}
              placeholder={
                ar
                  ? 'يا {name}، عندنا كرواسون جديد النهارده ☕'
                  : 'Hi {name}, fresh croissants today ☕'
              }
              onChange={(x) => setBodyAr(x.target.value)}
            />
          </label>
          <div className="field-foot">
            <small className="muted">
              {ar
                ? '{name} = اسم العميل · {business} = اسم محلك'
                : '{name} = customer · {business} = your shop'}
            </small>
            <small className={bodyAr.length > MAX - 15 ? 'warn' : 'muted'}>
              <bdi>
                {bodyAr.length}/{MAX}
              </bdi>
            </small>
          </div>
          {showEn ? (
            <label>
              {ar
                ? 'نسخة إنجليزي (للي موبايله إنجليزي)'
                : 'English version (phones set to English)'}
              <textarea
                rows={2}
                dir="ltr"
                maxLength={MAX}
                value={bodyEn}
                onChange={(x) => setBodyEn(x.target.value)}
              />
            </label>
          ) : (
            <button className="text-button" onClick={() => setShowEn(true)}>
              {ar ? '+ ضيف نسخة إنجليزي' : '+ Add an English version'}
            </button>
          )}
          {formError && (
            <p role="alert" className="notice error">
              {formError}
            </p>
          )}
          <button
            className="primary"
            disabled={busy || noProvider || !bodyAr.trim() || !preview?.customers || left === 0}
            onClick={review}
          >
            {left === 0
              ? ar
                ? 'خلصت رسايل الشهر'
                : 'No messages left this month'
              : ar
                ? 'راجع وابعت'
                : 'Review and send'}
          </button>
        </div>
        <aside className="lockscreen" aria-label={ar ? 'شكل الإشعار' : 'Notification preview'}>
          <div className="lockscreen-time">9:41</div>
          <div className="lockscreen-note">
            <div className="lockscreen-app">
              <span className="lockscreen-icon" aria-hidden="true" />
              <strong>{state.merchantName}</strong>
              <small>{ar ? 'دلوقتي' : 'now'}</small>
            </div>
            <p dir="auto">{sample}</p>
          </div>
        </aside>
      </div>

      <section className="panel">
        <h3>{ar ? 'اللي اتبعت قبل كده' : 'Sent before'}</h3>
        {state.history.length ? (
          <ul className="list-plain">
            {state.history.map((h) => (
              <li key={h.id} className="list-row">
                <div>
                  <strong dir="auto">{h.body_ar}</strong>
                  <small className="muted">
                    {day(h.created_at, lang)} · {audiences[h.audience][ar ? 0 : 1]}
                  </small>
                </div>
                <small className="message-stats">
                  {h.waiting > 0
                    ? ar
                      ? `بتتبعت · ${h.delivered} من ${h.recipients}`
                      : `Sending · ${h.delivered} of ${h.recipients}`
                    : ar
                      ? `وصلت لـ ${h.delivered} من ${h.recipients}`
                      : `Reached ${h.delivered} of ${h.recipients}`}
                  {h.delivered > 0 && (
                    <span className="message-returned">
                      {Date.now() - Date.parse(h.send_after || h.created_at) < 14 * 86_400_000
                        ? ar
                          ? ` · رجع منهم ${h.returned} لحد دلوقتي`
                          : ` · ${h.returned} came back so far`
                        : ar
                          ? ` · رجع منهم ${h.returned} خلال أسبوعين`
                          : ` · ${h.returned} came back within two weeks`}
                    </span>
                  )}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{ar ? 'لسه مبعتّش رسايل.' : 'No messages yet.'}</p>
        )}
      </section>

      {confirmedReach !== null && (
        <div className="modal-backdrop">
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="wm-confirm">
            <h2 id="wm-confirm">{ar ? 'نبعت الرسالة؟' : 'Send this message?'}</h2>
            <p dir="auto" className="quote">
              {sample}
            </p>
            <p>
              {ar
                ? `هتوصل لـ ${confirmedReach} عميل، وهتستخدم رسالة${left !== null ? ` (فاضلك ${left - 1} بعدها الشهر ده)` : ''}. مينفعش ترجع فيها بعد ما تتبعت.`
                : `It reaches ${confirmedReach} customers and uses one message${left !== null ? ` (${left - 1} left this month)` : ''}. It cannot be undone.`}
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                disabled={busy}
                onClick={() => setConfirmedReach(null)}
              >
                {ar ? 'رجوع' : 'Go back'}
              </button>
              <button className="primary" disabled={busy} onClick={send}>
                {busy ? (ar ? 'بنبعت…' : 'Sending…') : ar ? 'ابعت' : 'Send'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
