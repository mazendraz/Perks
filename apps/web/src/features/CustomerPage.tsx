import { PhoneInput } from '../controls/PhoneInput.js';
import { CustomerContact } from './CustomerOutreach.js';
import { FieldErrors, fieldProps } from '../FieldErrors.js';
import { CustomerRequests } from './StampRequests.js';
import { useEffect, useState, useRef, type FormEvent, type CSSProperties } from 'react';
import type {
  Language,
  Session,
  SavedCard,
  Reward,
} from '../../../../packages/contracts/src/index.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
import { api, errorText, ApiError } from '../api.js';
import { navigate } from '../useRoute.js';
interface HolderChallenge {
  id: string;
  merchant_id: string;
  membership_id: string;
  reward_id: string;
  status: string;
  expires_at: string;
  title: string;
  terms: string;
  code: string;
}
export function EnrollmentPage({
  slug,
  lang,
  session,
  onNeedLogin,
}: {
  slug: string;
  lang: Language;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const ar = lang === 'ar';
  const [contactPhone, setContactPhone] = useState(''),
    [whatsapp, setWhatsapp] = useState(false);
  const [info, setInfo] = useState<{
      merchant: { id: string; name: string; terms: string; primary_color: string; status: string };
      branches: { id: string; name: string }[];
      programs: {
        id: string;
        name: string;
        versionId: string;
        threshold: number;
        rewardTitle: string;
        rewardTerms: string;
        termsHash: string;
      }[];
    } | null>(null),
    [program, setProgram] = useState(''),
    [alias, setAlias] = useState(''),
    [terms, setTerms] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    void api<NonNullable<typeof info>>('/public/merchants/' + encodeURIComponent(slug))
      .then((r) => {
        setInfo(r);
        setProgram(r.programs[0]?.id || '');
      })
      .catch((e) => setError(errorText(e, lang)));
  }, [slug]);
  const [validation, setValidation] = useState<ApiError | null>(null);
  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) {
      onNeedLogin();
      return;
    }
    if (!info) return;
    const chosen = info.programs.find((p) => p.id === program);
    if (!chosen) return;
    setBusy(true);
    setError('');
    try {
      const query = new URLSearchParams(location.search),
        branchId = query.get('b');
      const result = await api<{ membershipId: string }>('/me/memberships', {
        method: 'POST',
        key: crypto.randomUUID(),
        body: {
          merchantId: info.merchant.id,
          programId: chosen.id,
          programVersionId: chosen.versionId,
          alias,
          acceptedTerms: terms,
          acceptedTermsHash: chosen.termsHash,
          source: query.get('src') === 'nfc' ? 'nfc' : query.get('src') === 'qr' ? 'qr' : 'link',
          branchId: info.branches.some((b) => b.id === branchId) ? branchId : null,
          contactPhone: contactPhone || undefined,
          consents: { email: false, sms: false, whatsapp },
        },
      });
      navigate('/customer/' + result.membershipId);
    } catch (e) {
      setValidation(e instanceof ApiError ? e : null);
      setError(errorText(e, lang));
      if (e instanceof ApiError && ['TERMS_CHANGED', 'PROGRAM_VERSION_CHANGED'].includes(e.code)) {
        setTerms(false);
        try {
          const fresh = await api<NonNullable<typeof info>>(
            '/public/merchants/' + encodeURIComponent(slug),
          );
          setInfo(fresh);
          if (!fresh.programs.some((p) => p.id === program))
            setProgram(fresh.programs[0]?.id || '');
        } catch {
          /* Keep the failed consent visible; never accept a new version implicitly. */
        }
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <main
      id="main"
      className="join-page"
      style={{ '--brand': info?.merchant.primary_color || '#2b55cf' } as CSSProperties}
    >
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {info ? (
        <>
          <div className="join-brand">
            <span className="eyebrow">{ar ? 'كارتك قريب منك' : 'Your card, always close'}</span>
            <h1>{info.merchant.name}</h1>
            <p className="muted">
              {ar ? 'كل زيارة بتقرّبك لمكافأة.' : 'Every visit brings you closer to a reward.'}
            </p>
          </div>
          <form className="panel" onSubmit={(e) => void join(e)}>
            <FieldErrors error={validation} lang={lang} />
            {info.programs.length ? (
              info.programs.map((p) => (
                <label className="join-program" key={p.id}>
                  <span className="checkbox-label">
                    <input
                      type="radio"
                      name="program"
                      checked={program === p.id}
                      onChange={() => setProgram(p.id)}
                    />
                    <strong>{p.name}</strong>
                  </span>
                  <span>
                    {p.threshold} {ar ? 'أختام →' : 'stamps →'} {p.rewardTitle}
                  </span>
                  <small className="muted">{p.rewardTerms}</small>
                </label>
              ))
            ) : (
              <p>
                {ar ? 'مفيش برنامج متاح للتسجيل دلوقتي.' : 'No program is open for enrollment.'}
              </p>
            )}
            <details>
              <summary>{ar ? 'شروط البرنامج' : 'Program terms'}</summary>
              <p>{info.merchant.terms}</p>
            </details>
            {session ? (
              <>
                <label>
                  {ar ? 'الاسم اللي يظهر على كارتك' : 'Name on your card'}
                  <input
                    required
                    minLength={1}
                    maxLength={60}
                    {...fieldProps(validation, 'alias')}
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    autoComplete="nickname"
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    required
                    {...fieldProps(validation, 'acceptedTerms')}
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                  />
                  {ar
                    ? 'موافق على شروط البرنامج والمكافأة'
                    : 'I accept the program and reward terms'}
                </label>
                <label>
                  {ar ? 'رقم واتساب (اختياري)' : 'WhatsApp number (optional)'}
                  <PhoneInput
                    lang={lang}
                    aria-label={ar ? 'رقم واتساب (اختياري)' : 'WhatsApp number (optional)'}
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.checked)}
                  />
                  {ar
                    ? 'أوافق على رسائل المحل على واتساب (اختياري)'
                    : 'I agree to WhatsApp messages from this business (optional)'}
                </label>
                <p className="muted">
                  {ar
                    ? 'التسجيل مش موافقة على رسائل تسويقية. تقدر تختار القنوات من تفضيلاتك بعدين.'
                    : 'Enrollment does not opt you into marketing. You can choose channels in preferences later.'}
                </p>
              </>
            ) : (
              <p className="muted">
                {ar
                  ? 'هنتحقق من بريدك قبل إنشاء الكارت.'
                  : 'We verify your email before creating your card.'}
              </p>
            )}
            <button className="primary full" disabled={busy || !program}>
              {busy
                ? ar
                  ? 'بنجهّز كارتك…'
                  : 'Preparing your card…'
                : session
                  ? ar
                    ? 'اعمل الكارت'
                    : 'Create my card'
                  : ar
                    ? 'سجّل وانضم'
                    : 'Sign in and join'}
            </button>
          </form>
        </>
      ) : (
        !error && <p role="status">{ar ? 'بنفتح النشاط…' : 'Loading business…'}</p>
      )}
    </main>
  );
}
export function InvitePage({
  token,
  lang,
  refresh,
}: {
  token: string;
  lang: Language;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const ar = lang === 'ar';
  const accept = async () => {
    setBusy(true);
    try {
      const accepted = await api<{ merchantId: string }>(
        '/invitations/' + encodeURIComponent(token) + '/accept',
        {
          method: 'POST',
          body: {},
        },
      );
      await refresh();
      const next = await api<Session>('/session');
      navigate(
        next.grants.find((g) => g.merchant_id === accepted.merchantId)?.role === 'cashier'
          ? '/cashier'
          : '/merchant',
      );
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <h1>{ar ? 'دعوة لفريق العمل' : 'Team invitation'}</h1>
      <p>
        {ar
          ? 'اقبل الدعوة بالبريد اللي اتبعتت عليه. صلاحياتك وفروعك بتتحدد من مالك النشاط.'
          : 'Accept with the invited email. Your business owner assigns your role and branches.'}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy} aria-busy={busy} onClick={() => void accept()}>
        {ar ? 'قبول الدعوة' : 'Accept invitation'}
      </button>
    </section>
  );
}
export function CustomerPage({ lang, membershipId }: { lang: Language; membershipId?: string }) {
  const ar = lang === 'ar',
    [cards, setCards] = useState<SavedCard[]>([]),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false),
    [qr, setQr] = useState<{ token: string; qrDataUrl: string; expiresAt: string } | null>(null),
    [rewards, setRewards] = useState<Reward[]>([]),
    [activity, setActivity] = useState<
      { id: string; public_reference: string; type: string; quantity: number; at: string }[]
    >([]),
    [challenges, setChallenges] = useState<HolderChallenge[]>([]),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState<'card' | 'history' | 'preferences'>('card'),
    [preferences, setPreferences] = useState<{ channel: string; granted: boolean }[]>([]);
  const preferenceGeneration = useRef(0);
  const [loadingPreferences, setLoadingPreferences] = useState(false);
  const load = async () => {
    try {
      const list = await api<{ cards: SavedCard[] }>('/me/memberships');
      setCards(list.cards);
      const h = await api<{ challenges: HolderChallenge[] }>('/me/redemption-challenges');
      setChallenges(h.challenges);
      if (membershipId) {
        const [r, a] = await Promise.all([
          api<{ rewards: Reward[] }>('/me/memberships/' + membershipId + '/rewards'),
          api<{ activity: typeof activity }>('/me/memberships/' + membershipId + '/activity'),
        ]);
        setRewards(r.rewards);
        setActivity(a.activity);
      }
      setError('');
      setLoaded(true);
    } catch (e) {
      setError(errorText(e, lang));
      setLoaded(true);
    }
  };
  useEffect(() => {
    setQr(null);
    setTab('card');
    preferenceGeneration.current++;
    setPreferences([]);
    setLoadingPreferences(false);
    void load();
    const iv = setInterval(() => {
      if (!document.hidden) void load();
    }, 4000);
    return () => clearInterval(iv);
  }, [membershipId]);
  const card = cards.find((x) => x.id === membershipId);
  const showQr = async () => {
    if (!card) return;
    setBusy(true);
    try {
      setQr(
        await api('/me/memberships/' + card.id + '/presentation-tokens', {
          method: 'POST',
          key: crypto.randomUUID(),
          body: {},
        }),
      );
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const decide = async (ch: HolderChallenge, approve: boolean) => {
    setBusy(true);
    try {
      await api('/me/redemption-challenges/' + ch.id + '/decision', {
        method: 'POST',
        key: crypto.randomUUID(),
        body: { approve, code: ch.code },
      });
      await load();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const refreshPreferences = async () => {
    if (!card) return;
    const generation = ++preferenceGeneration.current;
    setLoadingPreferences(true);
    try {
      const r = await api<{ preferences: typeof preferences }>(
        '/me/merchants/' + card.merchant_id + '/preferences',
      );
      if (generation === preferenceGeneration.current) setPreferences(r.preferences);
    } catch (e) {
      if (generation === preferenceGeneration.current) setError(errorText(e, lang));
    } finally {
      if (generation === preferenceGeneration.current) setLoadingPreferences(false);
    }
  };
  const preferenceTab = async () => {
    setTab('preferences');
    await refreshPreferences();
  };
  const updatePreference = async (channel: string, granted: boolean) => {
    if (!card) return;
    setBusy(true);
    try {
      await api('/me/merchants/' + card.merchant_id + '/preferences', {
        method: 'PATCH',
        body: { channel, granted },
      });
      setPreferences((p) => p.map((x) => (x.channel === channel ? { ...x, granted } : x)));
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const holder = challenges.find((c) => c.status === 'awaiting_holder');
  return (
    <>
      {holder && (
        <section
          className="panel holder-confirm"
          role="region"
          aria-label={ar ? 'تأكيد استبدال مكافأة' : 'Confirm reward redemption'}
        >
          <span className="badge">{ar ? 'طلب استبدال' : 'Redemption request'}</span>
          <h2>{holder.title}</h2>
          <p>
            {ar
              ? 'لازم الرقم ده يطابق الرقم عند الكاشير. وافق بس لوإنت الليبتستبدل دلوقتي.'
              : 'The code must match the cashier screen. Confirm only if you are redeeming now.'}
          </p>
          <div className="match-code">{holder.code}</div>
          <p className="muted">{holder.terms}</p>
          <div className="form-actions">
            <button
              className="secondary"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void decide(holder, false)}
            >
              {ar ? 'لا،مش أنا' : 'No, not me'}
            </button>
            <button
              className="primary"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void decide(holder, true)}
            >
              {ar ? 'أيوه،أنا الليبستبدل' : 'Yes, I am redeeming'}
            </button>
          </div>
        </section>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {!membershipId ? (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {ar ? 'كل كارت له رصيده' : 'Each card has its own progress'}
              </span>
              <h1>{ar ? 'كروتي' : 'My cards'}</h1>
            </div>
          </div>
          <div className="cards-grid">
            {cards.map((c) => (
              <button
                className="card-open"
                key={c.id}
                onClick={() => navigate('/customer/' + c.id)}
              >
                <LoyaltyCard card={c} lang={lang} />
              </button>
            ))}
          </div>
          {loaded && !cards.length && (
            <div className="empty-state">
              <h2>{ar ? 'لسه مفيش كروت' : 'No cards yet'}</h2>
              <p>
                {ar
                  ? 'امسح كود تسجيل أي نشاط مشترك عشان تبدأ.'
                  : 'Scan a participating business enrollment QR to get started.'}
              </p>
              <button className="secondary" onClick={() => navigate('/customer/account')}>
                {ar ? 'رجوع لحسابي' : 'Back to my account'}
              </button>
            </div>
          )}
        </>
      ) : card ? (
        <div className="card-detail" style={{ '--brand': card.primary_color } as CSSProperties}>
          <button className="text-button" onClick={() => navigate('/customer')}>
            {ar ? 'رجوع لكروتي' : 'Back to my cards'}
          </button>
          <div className="membership-layout">
            <aside className="membership-aside">
              <LoyaltyCard card={card} lang={lang} />
              <div className="tabbar">
                <button className={tab === 'card' ? 'active' : ''} onClick={() => setTab('card')}>
                  {ar ? 'الكارت' : 'Card'}
                </button>
                <button
                  className={tab === 'history' ? 'active' : ''}
                  onClick={() => setTab('history')}
                >
                  {ar ? 'السجل' : 'History'}
                </button>
                <button
                  className={tab === 'preferences' ? 'active' : ''}
                  onClick={() => void preferenceTab()}
                >
                  {ar ? 'التفضيلات' : 'Preferences'}
                </button>
              </div>
            </aside>
            <div className="membership-content">
              {tab === 'card' && (
                <>
                  {!card.earning_active && (
                    <div className="notice">
                      {ar
                        ? 'جمع الأختام متوقف حاليًا. المكافآت المكتسبة بتفضل حسب صلاحيتها.'
                        : 'Earning is currently paused. Earned rewards keep their original validity.'}
                    </div>
                  )}
                  <div className="card-actions">
                    <button
                      className="primary"
                      disabled={busy}
                      aria-busy={busy}
                      onClick={() => void showQr()}
                    >
                      {ar ? 'اعرض الكود' : 'Show my code'}
                    </button>
                    <button className="secondary" onClick={() => setTab('history')}>
                      {ar ? 'آخر نشاط' : 'Recent activity'}
                    </button>
                  </div>
                  {qr && (
                    <section className="qr-panel">
                      <h2>{ar ? 'الكود الشخصي' : 'Personal QR'}</h2>
                      <img
                        src={qr.qrDataUrl}
                        alt={ar ? 'QR العضوية للكاشير' : 'Membership QR for the cashier'}
                      />
                      <code>{qr.token}</code>
                      <small className="muted">
                        {ar ? 'صالح لحد ' : 'Valid until '}
                        {new Date(qr.expiresAt).toLocaleTimeString(lang, {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </small>
                      <button
                        className="text-button"
                        onClick={() => void showQr()}
                        disabled={busy}
                        aria-busy={busy}
                      >
                        {ar ? 'جدّد الكود' : 'Refresh code'}
                      </button>
                    </section>
                  )}
                  <section className="panel">
                    <h2>{ar ? 'مكافآتك' : 'Your rewards'}</h2>
                    {rewards.length ? (
                      rewards.map((r) => (
                        <div className="reward-row" key={r.id}>
                          <div>
                            <strong>{r.title}</strong>
                            <small>{r.terms}</small>
                            <small>
                              {ar ? 'صالحة لحد ' : 'Valid until '}
                              {new Date(r.expires_at).toLocaleDateString(lang)}
                            </small>
                          </div>
                          <span className="badge">
                            {r.status === 'available'
                              ? ar
                                ? 'متاحة'
                                : 'Available'
                              : r.status === 'redeemed'
                                ? ar
                                  ? 'اتصرفت'
                                  : 'Redeemed'
                                : r.status === 'expired'
                                  ? ar
                                    ? 'انتهت'
                                    : 'Expired'
                                  : ar
                                    ? 'اتلغت'
                                    : 'Voided'}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="muted">
                        {ar
                          ? 'أول مكافأة هتظهر لما توصل للعتبة.'
                          : 'Your first reward appears when you reach the threshold.'}
                      </p>
                    )}
                  </section>
                  <CustomerRequests card={card} lang={lang} />
                  <section className="panel">
                    <h2>Wallet</h2>
                    <p className="muted">
                      {ar
                        ? 'الإضافة لـApple Wallet وGoogle Wallet مش متاحة للنشاط ده حاليًا. كارت الويب محدث ومحفوظ.'
                        : 'Apple Wallet and Google Wallet are not available for this business yet. Your web card stays current.'}
                    </p>
                  </section>
                </>
              )}
              {tab === 'history' && (
                <section className="panel">
                  <h2>{ar ? 'سجل النشاط' : 'Activity'}</h2>
                  {activity.length ? (
                    activity.map((a) => (
                      <div className="activity-row" key={a.id}>
                        <div>
                          <strong>
                            {a.type === 'award'
                              ? ar
                                ? 'أختام جديدة'
                                : 'Stamps awarded'
                              : a.type === 'redeem'
                                ? ar
                                  ? 'استبدال مكافأة'
                                  : 'Reward redeemed'
                                : ar
                                  ? 'تصحيح'
                                  : 'Correction'}
                          </strong>
                          <small>
                            <bdi>{a.public_reference}</bdi> ·{new Date(a.at).toLocaleString(lang)}
                          </small>
                        </div>
                        <strong>
                          {a.type === 'redeem' ? '★' : (a.quantity > 0 ? '+' : '') + a.quantity}
                        </strong>
                      </div>
                    ))
                  ) : (
                    <p className="muted">{ar ? 'لسه مفيش عمليات.' : 'No activity yet.'}</p>
                  )}
                </section>
              )}
              {tab === 'preferences' && (
                <section className="panel">
                  <h2>{ar ? 'تفضيلات الرسائل' : 'Message preferences'}</h2>
                  <p className="muted">
                    {ar
                      ? 'موافقتك اختيارية وممكن تسحبها فيأي وقت. تشغيل القناة مرتبط بجاهزيتها عند النشاط.'
                      : 'Consent is optional and can be withdrawn anytime. Delivery depends on channel availability.'}
                  </p>
                  <CustomerContact
                    key={card.merchant_id}
                    merchantId={card.merchant_id}
                    lang={lang}
                    onSaved={async (reset) => {
                      if (reset)
                        setPreferences((current) =>
                          current.map((preference) =>
                            preference.channel === 'whatsapp'
                              ? { ...preference, granted: false }
                              : preference,
                          ),
                        );
                      await refreshPreferences();
                    }}
                  />
                  {preferences.map((p) => (
                    <label className="checkbox-label" key={p.channel}>
                      <input
                        type="checkbox"
                        checked={p.granted}
                        disabled={busy || loadingPreferences}
                        aria-busy={busy}
                        onChange={(e) => void updatePreference(p.channel, e.target.checked)}
                      />
                      {(
                        {
                          email: ar ? 'البريد الإلكتروني' : 'Email',
                          sms: 'SMS',
                          whatsapp: 'WhatsApp',
                          push: ar ? 'إشعارات المتصفح' : 'Web Push',
                        } as Record<string, string>
                      )[p.channel] || p.channel}
                    </label>
                  ))}
                </section>
              )}
            </div>
          </div>
        </div>
      ) : (
        loaded && (
          <div className="empty-state">
            {ar ? 'الكارت مش متاح للحساب ده.' : 'This card is not available to your account.'}
          </div>
        )
      )}
    </>
  );
}
