import { Select } from '../controls/Select.js';
import { ActionLabel, Icon } from '../../../../packages/ui/src/Icon.js';
import { FieldErrors, fieldProps } from '../FieldErrors.js';
import { CashierRequests } from './StampRequests.js';
import { PushToggle } from './PushToggle.js';
import { unlinkPushDevice } from '../push.js';
import { TeamCustomerRecovery } from './CustomerRecovery.js';
import { AutoStampFeed } from './AutoStampFeed.js';
import { CashierRedeemQueue } from './RedeemRequests.js';
import { useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import { CameraScanner } from './CameraScanner.js';
import type {
  AwardResult,
  Grant,
  Language,
  Reward,
} from '../../../../packages/contracts/src/index.js';
import type { AwardInput } from '../../../../packages/contracts/src/commands.js';
import { api, ApiError, errorText } from '../api.js';
import { intlLocale } from '../locale.js';
import { ShiftSummary } from './TodayStrip.js';
import { holdUpdates } from '../update-gate.js';
interface Member {
  id: string;
  alias: string;
  balance: number;
  threshold: number;
  rewardTitle: string;
  revision: number;
  maxPerTx: number;
  // The shop's stamps per visit; the starting quantity, and the only one when multiple stamps are off.
  defaultStamps: number;
  allowMultiple: boolean;
}
interface PendingAward {
  key: string;
  body: Omit<AwardInput, 'presentationContext'>;
}
interface Recent {
  id: string;
  public_reference: string;
  type: string;
  quantity: number;
  at: string;
  alias: string;
  branch_id: string;
}
/** "Today", "Yesterday" or a short date, so an old sale never looks like a new one. */
function dayLabel(at: string, lang: Language) {
  const d = new Date(at),
    today = new Date(),
    start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(),
    diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return lang === 'ar' ? 'النهارده' : 'Today';
  if (diff === 1) return lang === 'ar' ? 'امبارح' : 'Yesterday';
  return d.toLocaleDateString(intlLocale(lang), { day: 'numeric', month: 'short' });
}
export function CashierPage({ grant, lang }: { grant: Grant; lang: Language }) {
  const ar = lang === 'ar',
    storageKey = 'nuqta-pending-' + grant.id;
  const [branch, setBranch] = useState(grant.branches[0]?.id || ''),
    [step, setStep] = useState<
      'home' | 'scan' | 'member' | 'stamp' | 'review' | 'pending' | 'result'
    >('home'),
    [member, setMember] = useState<Member | null>(null),
    [rewards, setRewards] = useState<Reward[]>([]),
    [context, setContext] = useState(''),
    [manual, setManual] = useState(''),
    [receipt, setReceipt] = useState(''),
    [qty, setQty] = useState(1),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<PendingAward | null>(null),
    [result, setResult] = useState<AwardResult | null>(null),
    [recent, setRecent] = useState<Recent[]>([]),
    [correction, setCorrection] = useState<{ tx: Recent; reason: string } | null>(null),
    [notice, setNotice] = useState('');
  const [validation, setValidation] = useState<ApiError | null>(null);
  // Any step past home is a stamp in progress; a silent update must not reset it.
  useEffect(() => (step === 'home' ? undefined : holdUpdates()), [step]);
  const refreshRecent = async () => {
    try {
      const r = await api<{ transactions: Recent[] }>(
        '/merchants/' + grant.merchant_id + '/transactions',
      );
      setRecent(r.transactions.filter((t) => t.branch_id === branch));
    } catch (e) {
      setValidation(e instanceof ApiError ? e : null);
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void refreshRecent();
    try {
      const p = sessionStorage.getItem(storageKey);
      if (p) {
        const saved = JSON.parse(p) as PendingAward;
        setPending(saved);
        setBranch(saved.body.branchId);
        setStep('pending');
      }
    } catch {
      setError(
        ar
          ? 'تعذر قراءة مرجع العملية المعلقة. تواصل مع المدير قبل تسجيل عملية جديدة.'
          : 'Unable to recover the pending reference. Ask your manager before creating another transaction.',
      );
      setStep('pending');
    }
  }, [branch]);
  const finish = (r: AwardResult) => {
    setResult(r);
    setPending(null);
    sessionStorage.removeItem(storageKey);
    setStep('result');
    void refreshRecent();
  };
  const checkPending = async () => {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ status: string; result: AwardResult }>(
        '/operations/by-key?scope=' +
          encodeURIComponent('stamp.award:' + grant.merchant_id) +
          '&key=' +
          encodeURIComponent(pending.key),
      );
      if (r.status === 'committed') finish(r.result);
      else
        setNotice(
          ar
            ? 'لسه مفيش نتيجة مؤكدة. امسح نفس الكارت عشان نعيد نفس المحاولة بأمان.'
            : 'No confirmed result yet. Scan the same card to safely retry the same attempt.',
        );
    } catch (e) {
      setValidation(e instanceof ApiError ? e : null);
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const scan = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{
        membership: Member;
        rewards: Reward[];
        presentationContext: string;
      }>('/cashier/scans/resolve', {
        method: 'POST',
        body: { merchantId: grant.merchant_id, branchId: branch, token: value.trim() },
      });
      if (pending && r.membership.id !== pending.body.membershipId) {
        setError(
          ar
            ? 'امسح نفس عضوية العملية المعلقة الأول.'
            : 'Scan the pending transaction membership first.',
        );
        return;
      }
      setMember(r.membership);
      setRewards(r.rewards);
      setContext(r.presentationContext);
      if (pending) {
        setQty(pending.body.quantity);
        setReceipt(pending.body.purchaseReference.reference);
        setStep('review');
      } else setStep('member');
    } catch (e) {
      setValidation(e instanceof ApiError ? e : null);
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const review = (e: FormEvent) => {
    e.preventDefault();
    if (!member) return;
    setPending({
      key: crypto.randomUUID(),
      body: {
        branchId: branch,
        membershipId: member.id,
        quantity: qty,
        purchaseReference: {
          namespace: 'manual',
          reference: receipt,
          businessDate: new Intl.DateTimeFormat('en-CA', {
            timeZone: grant.timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date()),
        },
      },
    });
    setStep('review');
  };
  const commit = async () => {
    if (!pending) return;
    sessionStorage.setItem(storageKey, JSON.stringify(pending));
    setStep('pending');
    setBusy(true);
    setError('');
    setNotice('');
    try {
      finish(
        await api<AwardResult>('/merchants/' + grant.merchant_id + '/stamp-awards', {
          method: 'POST',
          key: pending.key,
          body: { ...pending.body, presentationContext: context },
        }),
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
        setStep('stamp');
      }
      setValidation(e instanceof ApiError ? e : null);
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const next = () => {
    setMember(null);
    setRewards([]);
    setContext('');
    setManual('');
    setReceipt('');
    setQty(1);
    setResult(null);
    setNotice('');
    setError('');
    setStep('scan');
  };
  const requestCorrection = async (e: FormEvent) => {
    e.preventDefault();
    if (!correction) return;
    setBusy(true);
    try {
      await api('/merchants/' + grant.merchant_id + '/corrections', {
        method: 'POST',
        key: crypto.randomUUID(),
        body: {
          transactionId: correction.tx.id,
          delta: -correction.tx.quantity,
          reason: correction.reason,
        },
      });
      setCorrection(null);
      setNotice(
        ar
          ? 'طلب التصحيح اتبعت. الرصيد مش هيتغير قبل مراجعة المدير.'
          : 'Correction requested. Balance changes only after manager review.',
      );
    } catch (e) {
      setValidation(e instanceof ApiError ? e : null);
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mobile-cashier" style={{ '--brand': grant.primary_color } as CSSProperties}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{grant.name}</span>
          <h1>{ar ? 'الكاشير' : 'Cashier'}</h1>
        </div>
        <button
          className="secondary small"
          onClick={() =>
            void unlinkPushDevice()
              .then(() => api('/auth/logout', { method: 'POST' }))
              .then(() => location.assign('/cashier/login'))
              .catch((e) => setError(errorText(e, lang)))
          }
        >
          {ar ? 'قفل الوردية' : 'Lock shift'}
        </button>
      </div>
      {grant.branches.length > 1 && (
        <label className="branch-picker">
          {ar ? 'الفرع' : 'Branch'}
          <Select
            value={branch}
            disabled={!!pending}
            onChange={(e) => {
              setBranch(e.target.value);
              setStep('home');
              setMember(null);
            }}
          >
            {grant.branches.map((b) => (
              <option value={b.id} key={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {step === 'home' && (
        <div className="action-stack">
          <CashierRedeemQueue
            grant={grant}
            branch={branch}
            lang={lang}
            onRedeemed={() => void refreshRecent()}
          />
          <CashierRequests
            grant={grant}
            branch={branch}
            lang={lang}
            onCommitted={() => void refreshRecent()}
          />
          <section className="cashier-station">
            <div className="station-icon">
              <Icon name="scan" size={37} />
            </div>
            <span className="eyebrow">{grant.branches.find((b) => b.id === branch)?.name}</span>
            <h2>{ar ? 'جاهز للزيارة اللي جاية؟' : 'Ready for your next guest?'}</h2>
            <p>
              {ar
                ? 'اقرأ كارت العميل، راجع الشراء، وخلي الزيارة تقرّبه لمكافأته.'
                : 'Read their card, confirm the purchase, and make this visit count.'}
            </p>
            <button className="primary cashier-scan" onClick={() => setStep('scan')}>
              <Icon name="scan" size={22} />
              {ar ? 'امسح كارت' : 'Scan card'}
              <span aria-hidden="true">{ar ? '←' : '→'}</span>
            </button>
          </section>
          <PushToggle lang={lang} />
          <AutoStampFeed
            grant={grant}
            branch={branch}
            lang={lang}
            onChanged={() => void refreshRecent()}
          />
          <section className="panel">
            <h2>{ar ? 'آخر العمليات' : 'Recent transactions'}</h2>
            <ShiftSummary merchantId={grant.merchant_id} lang={lang} />
            {recent.length ? (
              recent.slice(0, 8).map((t) => (
                <div className="activity-row" key={t.id}>
                  <div>
                    <strong>{t.alias}</strong>
                    <small>
                      {dayLabel(t.at, lang)} ·{' '}
                      {new Date(t.at).toLocaleTimeString(intlLocale(lang), {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </small>
                    {t.type === 'award' && (
                      <button
                        className="text-button"
                        onClick={() => setCorrection({ tx: t, reason: '' })}
                      >
                        <ActionLabel icon="refresh">
                          {ar ? 'طلب تصحيح' : 'Request correction'}
                        </ActionLabel>
                      </button>
                    )}
                  </div>
                  <strong>
                    {t.type === 'redeem' ? '★' : (t.quantity > 0 ? '+' : '') + t.quantity}
                  </strong>
                </div>
              ))
            ) : (
              <p className="muted">
                {ar ? 'لسه مفيش عمليات في الفرع ده.' : 'No transactions at this branch yet.'}
              </p>
            )}
          </section>
          <details className="panel cashier-tools">
            <summary>{ar ? 'أدوات تانية' : 'More tools'}</summary>
            <TeamCustomerRecovery
              key={grant.id + ':' + branch}
              grant={grant}
              branchId={branch}
              lang={lang}
            />
          </details>
        </div>
      )}
      {step === 'scan' && (
        <section className="panel">
          <h2>{ar ? 'امسح كود العضوية' : 'Scan the membership code'}</h2>
          <CameraScanner lang={lang} onRead={(value) => void scan(value)} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void scan(manual);
            }}
          >
            <label>
              <ActionLabel icon="keyboard">
                {ar
                  ? 'أو اكتب الـ 6 أرقام اللي على موبايل العميل'
                  : "Or type the 6 digits on the customer's phone"}
              </ActionLabel>
              <input
                dir="ltr"
                inputMode="numeric"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                required
                placeholder="482 913"
                autoComplete="off"
              />
            </label>
            <button className="secondary" disabled={busy} aria-busy={busy}>
              <ActionLabel icon="scan">{ar ? 'قراءة الكود' : 'Read code'}</ActionLabel>
            </button>
          </form>
        </section>
      )}
      {step === 'member' && member && (
        <>
          {rewards.some((r) => r.status === 'available') && (
            <section className="panel reward-ready" aria-live="polite">
              <div className="reward-ready-heading">
                <Icon name="gift" size={26} />
                <h2>
                  {member.alias} · {ar ? 'الكارت كمل' : 'Card full'}
                </h2>
              </div>
              <strong className="match-code">
                {member.threshold}/{member.threshold}
              </strong>
              <p className="muted">
                {ar
                  ? 'المكافأة جاهزة: ' +
                    rewards.find((r) => r.status === 'available')!.title +
                    '. العميل يدوس استبدل من موبايله، والطلب يظهر لك علشان تأكده.'
                  : 'Reward ready: ' +
                    rewards.find((r) => r.status === 'available')!.title +
                    '. The customer taps Redeem on their phone; the request shows up here to confirm.'}
              </p>
            </section>
          )}
          <section className="panel">
            <h2>{member.alias}</h2>
            <strong className="match-code">
              {member.balance}/{member.threshold}
            </strong>
            <p className="muted">
              {rewards.some((r) => r.status === 'available')
                ? ar
                  ? 'أختام محفوظة للكارت الجاي'
                  : 'Stamps saved for the next card'
                : member.rewardTitle}
            </p>
            <button
              className={
                rewards.some((r) => r.status === 'available') ? 'secondary full' : 'primary full'
              }
              onClick={() => {
                setQty(member.defaultStamps);
                setReceipt('');
                setStep('stamp');
              }}
            >
              <ActionLabel icon="stamp">{ar ? 'إضافة ختم' : 'Add stamps'}</ActionLabel>
            </button>
          </section>
          {!rewards.some((r) => r.status === 'available') && (
            <section className="panel">
              <h2>{ar ? 'المكافآت' : 'Rewards'}</h2>
              <p className="muted">{ar ? 'مفيش مكافأة متاحة.' : 'No reward is available.'}</p>
            </section>
          )}
          <button className="text-button" onClick={next}>
            {ar ? 'عميل تاني' : 'Another customer'}
          </button>
        </>
      )}
      {step === 'stamp' && member && (
        <form className="panel" onSubmit={review}>
          <FieldErrors error={validation} lang={lang} />
          <h2>
            {ar ? 'إضافة أختام' : 'Award stamps'} ·{member.alias}
          </h2>
          <label>
            {ar ? 'رقم الإيصال' : 'Receipt number'}
            <input
              required
              maxLength={120}
              dir="ltr"
              {...fieldProps(validation, 'purchaseReference.reference')}
              value={receipt}
              onChange={(e) => setReceipt(e.target.value)}
            />
          </label>
          <div className="stamp-quantity">
            <button
              type="button"
              className="secondary"
              disabled={!member.allowMultiple || qty <= 1}
              aria-label={ar ? 'تقليل الكمية' : 'Decrease quantity'}
              onClick={() => setQty((q) => Math.max(1, q - 1))}
            >
              −
            </button>
            <strong aria-live="polite">{qty}</strong>
            <button
              type="button"
              className="secondary"
              disabled={!member.allowMultiple || qty >= Math.min(grant.max_qty, member.maxPerTx)}
              aria-label={ar ? 'زيادة الكمية' : 'Increase quantity'}
              onClick={() =>
                setQty((q) => Math.min(Math.min(grant.max_qty, member.maxPerTx), q + 1))
              }
            >
              +
            </button>
          </div>
          <p className="muted">
            {ar
              ? 'عملية الشراء دي زيارة واحدة مهما كان عدد الأختام.'
              : 'This purchase counts as one visit regardless of stamp quantity.'}
          </p>
          <button className="primary">{ar ? 'راجع قبل التأكيد' : 'Review award'}</button>
        </form>
      )}
      {step === 'review' && pending && (
        <section className="panel">
          <h2>{ar ? 'راجع العملية' : 'Review transaction'}</h2>
          <dl className="review-list">
            <dt>{ar ? 'العميل' : 'Customer'}</dt>
            <dd>{member?.alias}</dd>
            <dt>{ar ? 'الإيصال' : 'Receipt'}</dt>
            <dd>
              <bdi>{pending.body.purchaseReference.reference}</bdi>
            </dd>
            <dt>{ar ? 'الكمية' : 'Quantity'}</dt>
            <dd>{pending.body.quantity}</dd>
            <dt>{ar ? 'الفرع' : 'Branch'}</dt>
            <dd>{grant.branches.find((b) => b.id === pending.body.branchId)?.name}</dd>
          </dl>
          <div className="form-actions">
            <button
              className="secondary"
              disabled={!!sessionStorage.getItem(storageKey)}
              onClick={() => {
                setPending(null);
                setStep('stamp');
              }}
            >
              {ar ? 'تعديل' : 'Edit'}
            </button>
            <button
              className="primary"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void commit()}
            >
              {ar ? 'تأكيد الأختام' : 'Confirm stamps'}
            </button>
          </div>
        </section>
      )}
      {step === 'pending' && (
        <section className="panel" aria-live="polite">
          <h2>
            {busy
              ? ar
                ? 'بنسجّل العملية…'
                : 'Recording transaction…'
              : ar
                ? 'بنتأكد من النتيجة'
                : 'Confirming the outcome'}
          </h2>
          <p>
            {ar
              ? 'النجاح هيظهر بعد تأكيد الحفظ. لو الرد ضاع، بنراجع نفس المحاولة من غير عملية جديدة.'
              : 'Success follows durable confirmation. A lost response is checked using the same attempt.'}
          </p>
          {!busy && (
            <div className="action-stack">
              <button className="primary" onClick={() => void checkPending()}>
                {ar ? 'تحقق من نفس العملية' : 'Check the same operation'}
              </button>
              <button className="secondary" onClick={() => setStep('scan')}>
                <ActionLabel icon="scan">
                  {ar ? 'امسح نفس الكارت وأعد المحاولة' : 'Scan the same card and retry'}
                </ActionLabel>
              </button>
            </div>
          )}
        </section>
      )}
      {step === 'result' && result && (
        <section className="panel receipt-result" role="status">
          <div className="result-icon">✓</div>
          <h2>
            +{result.quantity} {ar ? 'ختم' : 'stamps'}
          </h2>
          <p>
            {ar ? 'الرصيد المحفوظ' : 'Saved balance'}: {result.balanceAfter}
          </p>
          {result.rewardGrants.length > 0 && (
            <div className="notice success">
              {ar ? 'اتفتحت مكافأة: ' : 'Reward unlocked: '}
              {result.rewardGrants[0]!.title}
            </div>
          )}
          <bdi>{result.reference}</bdi>
          <p className="muted">{new Date(result.committedAt).toLocaleString(intlLocale(lang))}</p>
          <button className="primary full" onClick={next}>
            {ar ? 'العميل اللي بعده' : 'Next customer'}
          </button>
        </section>
      )}
      {correction && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="correction-heading"
            onSubmit={(e) => void requestCorrection(e)}
          >
            <h2 id="correction-heading">{ar ? 'طلب تصحيح' : 'Request correction'}</h2>
            <p>
              <bdi>{correction.tx.public_reference}</bdi> ·{correction.tx.alias}
            </p>
            <p className="muted">
              {ar
                ? 'الطلب هيُراجع لعكس العملية بالكامل. وجود عمليات لاحقة أو مكافأة مصروفة يحتاج مراجعة خاصة.'
                : 'This requests a full reversal. Later activity or a redeemed reward requires manual review.'}
            </p>
            <label>
              {ar ? 'السبب' : 'Reason'}
              <textarea
                autoFocus
                minLength={4}
                required
                value={correction.reason}
                onChange={(e) => setCorrection({ ...correction, reason: e.target.value })}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => setCorrection(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="primary" disabled={busy} aria-busy={busy}>
                {ar ? 'ابعت للمدير' : 'Send for review'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
