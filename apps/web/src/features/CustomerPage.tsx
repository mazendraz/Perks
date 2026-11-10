import { PhoneInput } from '../controls/PhoneInput.js';
import type { LegalNotice } from '../../../../packages/contracts/src/legal.js';
import { Select } from '../controls/Select.js';
import { CustomerContact } from './CustomerOutreach.js';
import { FieldErrors, fieldProps } from '../FieldErrors.js';
import { CustomerRequests } from './StampRequests.js';
import { useLiveRefresh } from '../live-events.js';
import { CustomerCode } from './CustomerCode.js';
import { InstallCard } from './InstallCard.js';
import { useCardExperience } from '../useCardExperience.js';
import {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  type FormEvent,
  type CSSProperties,
} from 'react';
import type {
  Language,
  Session,
  SavedCard,
  Reward,
} from '../../../../packages/contracts/src/index.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
import { api, errorText, ApiError, setCsrf } from '../api.js';
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
  refresh,
}: {
  slug: string;
  lang: Language;
  session: Session | null;
  refresh: () => Promise<void>;
}) {
  const ar = lang === 'ar',
    deviceBound = !!session?.user.deviceBound;
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
    [alias, setAlias] = useState(session?.user.displayName || ''),
    [phone, setPhone] = useState(''),
    [terms, setTerms] = useState(false),
    [legal, setLegal] = useState<LegalNotice | null>(null),
    [busy, setBusy] = useState(false),
    [prepared, setPrepared] = useState(deviceBound),
    [error, setError] = useState(''),
    [validation, setValidation] = useState<ApiError | null>(null);
  useEffect(() => {
    let active = true;
    setTerms(false);
    setLegal(null);
    void api<LegalNotice>('/public/legal?lang=' + lang)
      .then((value) => {
        if (active) setLegal(value);
      })
      .catch((error) => {
        if (active) setError(errorText(error, lang));
      });
    return () => {
      active = false;
    };
  }, [lang]);
  useEffect(() => {
    let alive = true;
    void api<NonNullable<typeof info>>('/public/merchants/' + encodeURIComponent(slug))
      .then((value) => {
        if (!alive) return;
        setInfo(value);
        setProgram(value.programs[0]?.id || '');
      })
      .catch((error) => {
        if (alive) setError(errorText(error, lang).split(' · ')[0]!);
      });
    if (!deviceBound)
      void api<{ csrfToken: string }>('/customer/bootstrap')
        .then((value) => {
          if (!alive) return;
          if (!session) setCsrf(value.csrfToken);
          setPrepared(true);
        })
        .catch((error) => {
          if (alive) setError(errorText(error, lang));
        });
    return () => {
      alive = false;
    };
  }, [slug, session?.user.id, deviceBound]);
  const openCard = async (result: { membershipId: string; alreadyMember?: boolean }) => {
    await refresh();
    const context = new URLSearchParams(location.search);
    if (!result.alreadyMember) context.set('new', '1');
    navigate(
      '/customer/' + result.membershipId + (context.toString() ? '?' + context.toString() : ''),
    );
  };
  const join = async (event: FormEvent) => {
    event.preventDefault();
    if (!info || !prepared || !legal || legal.locale !== lang) return;
    const chosen = info.programs.find((p) => p.id === program);
    if (!chosen) return;
    setBusy(true);
    setError('');
    setValidation(null);
    const query = new URLSearchParams(location.search),
      requestedBranch = query.get('b'),
      branchId =
        info.branches.find((b) => b.id === requestedBranch)?.id ||
        (!requestedBranch ? info.branches[0]?.id : undefined);
    if (!branchId) {
      setError(
        ar
          ? 'الفرع مش متاح دلوقتي. اعمل سكان للكود الحالي.'
          : 'This branch is unavailable. Scan its current code.',
      );
      setBusy(false);
      return;
    }
    try {
      const common = {
        merchantId: info.merchant.id,
        programId: chosen.id,
        programVersionId: chosen.versionId,
        branchId,
        acceptedTerms: terms,
        acceptedTermsHash: chosen.termsHash,
        acceptedPrivacyVersion: legal.acceptance.version,
        acceptedPrivacyHash: legal.acceptance.hash,
        acceptedPrivacyLocale: legal.locale,
        source: query.get('src') === 'nfc' ? 'nfc' : query.get('src') === 'qr' ? 'qr' : 'link',
      };
      if (deviceBound) {
        const result = await api<{ membershipId: string; alreadyMember: boolean }>(
          '/me/memberships',
          {
            method: 'POST',
            key: crypto.randomUUID(),
            body: {
              ...common,
              alias: session?.user.displayName || alias || (ar ? 'عميل' : 'Customer'),
            },
          },
        );
        await openCard(result);
      } else {
        const result = await api<{
          membershipId: string;
          alreadyMember: boolean;
          csrfToken: string;
        }>('/customer/register', {
          method: 'POST',
          body: {
            ...common,
            displayName: alias,
            phone,
            placementCode: query.get('code') || undefined,
          },
        });
        setCsrf(result.csrfToken);
        await openCard(result);
      }
    } catch (error) {
      // The device cookie exists before registration, so a lost committed reply
      // can recover the card without storing a bearer token or re-entering a number.
      if (error instanceof ApiError && error.status === 0) {
        try {
          const restored = await api<Session>('/session', { workspace: 'customer' });
          setCsrf(restored.csrfToken);
          const cards = await api<{ cards: SavedCard[] }>('/me/memberships', {
            workspace: 'customer',
          });
          const card = cards.cards.find(
            (card) => card.merchant_id === info.merchant.id && card.program_id === chosen.id,
          );
          if (card) {
            await openCard({ membershipId: card.id });
            return;
          }
        } catch {
          /* Keep the form and original network error for a deliberate retry. */
        }
      }
      setValidation(error instanceof ApiError ? error : null);
      setError(errorText(error, lang).split(' · ')[0]!);
      if (
        error instanceof ApiError &&
        ['TERMS_CHANGED', 'PROGRAM_VERSION_CHANGED', 'PRIVACY_CHANGED'].includes(error.code)
      ) {
        setTerms(false);
        try {
          const value = await api<NonNullable<typeof info>>(
            '/public/merchants/' + encodeURIComponent(slug),
          );
          setInfo(value);
          setProgram(value.programs[0]?.id || '');
          setLegal(await api<LegalNotice>('/public/legal?lang=' + lang));
        } catch {
          /* Consent remains unchecked. */
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
      {info ? (
        <>
          <div className="join-brand">
            <span className="eyebrow">{ar ? 'كارتك قريب منك' : 'Your card, always close'}</span>
            <h1>{info.merchant.name}</h1>
            <p className="muted">
              {ar ? 'كل زيارة بتقرّبك لمكافأة.' : 'Every visit brings you closer to a reward.'}
            </p>
          </div>
          <form className="panel customer-first-visit" onSubmit={(event) => void join(event)}>
            <FieldErrors error={validation} lang={lang} />
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {info.programs.length > 1 && (
              <label>
                {ar ? 'اختار كارتك' : 'Choose your card'}
                <Select
                  value={program}
                  onChange={(event) => {
                    setProgram(event.target.value);
                    setTerms(false);
                  }}
                >
                  {info.programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {info.programs.find((p) => p.id === program) && (
              <div className="join-program">
                <strong>{info.programs.find((p) => p.id === program)!.rewardTitle}</strong>
                <span>
                  {info.programs.find((p) => p.id === program)!.threshold}{' '}
                  {ar ? 'أختام للمكافأة' : 'stamps to your reward'}
                </span>
              </div>
            )}
            {!deviceBound && (
              <>
                <label>
                  {ar ? 'اسمك' : 'Your name'}
                  <input
                    required
                    autoComplete="name"
                    maxLength={60}
                    {...fieldProps(validation, 'displayName')}
                    value={alias}
                    onChange={(event) => setAlias(event.target.value)}
                  />
                </label>
                <label>
                  {ar ? 'رقم موبايلك' : 'Mobile number'}
                  <PhoneInput
                    lang={lang}
                    aria-label={ar ? 'رقم موبايلك' : 'Mobile number'}
                    required
                    {...fieldProps(validation, 'phone')}
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>
              </>
            )}
            <details>
              <summary>{ar ? 'الشروط والخصوصية' : 'Terms and privacy'}</summary>
              <p>{info.merchant.terms}</p>
              <p>{info.programs.find((p) => p.id === program)?.rewardTerms}</p>
              <p>
                {ar
                  ? 'بنحفظ اسمك ورقمك للكارت واسترجاعه بطلبك،وبنربطه بالجهاز ده. التسجيل مش موافقة على التسويق.'
                  : 'Your name and number are used for your card and recovery you request. The card is linked to this device. Registration does not opt you into marketing.'}
              </p>
              <p className="muted">
                {ar
                  ? 'مسودة محلية، والمراجعة القانونية مطلوبة قبل الإطلاق.'
                  : 'Local draft. Legal review is required before launch.'}
              </p>
              <nav
                className="legal-links"
                aria-label={ar ? 'اقرأ الشروط والخصوصية' : 'Read terms and privacy'}
              >
                <a href={'/privacy?lang=' + lang} target="_blank" rel="noopener noreferrer">
                  {ar ? 'الخصوصية كاملة' : 'Full privacy notice'}
                </a>
                <a href={'/terms?lang=' + lang} target="_blank" rel="noopener noreferrer">
                  {ar ? 'شروط الاستخدام' : 'Terms of use'}
                </a>
              </nav>
            </details>
            <label className="checkbox-label">
              <input
                required
                type="checkbox"
                {...fieldProps(validation, 'acceptedTerms')}
                checked={terms}
                onChange={(event) => setTerms(event.target.checked)}
              />
              {ar
                ? 'موافق على شروط البرنامج والمكافأة والخصوصية'
                : 'I accept the program, reward and privacy terms'}
            </label>
            <button
              className="primary full"
              disabled={busy || !prepared || !program || !legal || legal.locale !== lang}
            >
              {busy
                ? ar
                  ? 'بنجهّز كارتك…'
                  : 'Preparing your card…'
                : ar
                  ? 'افتح الكارت'
                  : 'Open my card'}
            </button>
            <p className="muted">
              {ar
                ? 'كارتك هيفضل على الجهاز ده. لو غيّرت الموبايل،اطلب من الكاشير يرجعهولك على واتساب.'
                : 'Your card stays on this device. If you change phones, ask the cashier to restore it on WhatsApp.'}
            </p>
          </form>
        </>
      ) : error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : (
        <p role="status">{ar ? 'بنفتح النشاط…' : 'Loading business…'}</p>
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
  const [waiting, setWaiting] = useState(false);
  const preferenceGeneration = useRef(0);
  const qrEpoch = useRef(0);
  const loadGeneration = useRef(0);
  const [loadingPreferences, setLoadingPreferences] = useState(false);
  const load = async () => {
    const generation = ++loadGeneration.current;
    try {
      const list = await api<{ cards: SavedCard[] }>('/me/memberships');
      const h = await api<{ challenges: HolderChallenge[] }>('/me/redemption-challenges');
      let details: { rewards: Reward[]; activity: typeof activity } | undefined;
      if (membershipId) {
        const [r, a] = await Promise.all([
          api<{ rewards: Reward[] }>('/me/memberships/' + membershipId + '/rewards'),
          api<{ activity: typeof activity }>('/me/memberships/' + membershipId + '/activity'),
        ]);
        details = { rewards: r.rewards, activity: a.activity };
      }
      if (generation !== loadGeneration.current) return;
      setCards(list.cards);
      setChallenges(h.challenges);
      if (details) {
        setRewards(details.rewards);
        setActivity(details.activity);
      }
      setError('');
      setLoaded(true);
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setError(errorText(e, lang));
      setLoaded(true);
    }
  };
  useLiveRefresh('/me/events', load);
  useEffect(() => {
    setQr(null);
    qrEpoch.current++;
    setWaiting(false);
    setTab('card');
    preferenceGeneration.current++;
    setPreferences([]);
    setLoadingPreferences(false);
    void load();
    return () => {
      loadGeneration.current++;
    };
  }, [membershipId]);
  const card = cards.find((x) => x.id === membershipId);
  useCardExperience(card?.id);
  const showQr = async () => {
    if (!card) return;
    const epoch = ++qrEpoch.current;
    setBusy(true);
    try {
      const code = await api<{ token: string; qrDataUrl: string; expiresAt: string }>(
        '/me/memberships/' + card.id + '/presentation-tokens',
        {
          method: 'POST',
          key: crypto.randomUUID(),
          body: {},
        },
      );
      if (epoch === qrEpoch.current) setQr(code);
      setError('');
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const lastRevision = useRef<{ id: string; revision: number } | null>(null);
  useLayoutEffect(() => {
    if (!card) return;
    const previous = lastRevision.current;
    if (previous?.id === card.id && card.revision > previous.revision) {
      qrEpoch.current++;
      setQr(null);
    }
    lastRevision.current = { id: card.id, revision: card.revision };
  }, [card?.id, card?.revision]);
  useEffect(() => {
    if (waiting && card && new URLSearchParams(location.search).has('code')) void showQr();
  }, [waiting, card?.id]);
  useEffect(() => {
    if (challenges.some((ch) => ch.status === 'awaiting_holder')) {
      qrEpoch.current++;
      setQr(null);
    }
  }, [challenges]);
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
      {error && !qr && (
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
              <LoyaltyCard
                card={card}
                lang={lang}
                waiting={waiting}
                reveal={new URLSearchParams(location.search).get('new') === '1'}
              />
              <InstallCard card={card} lang={lang} qrOpen={!!qr} />
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
                    <CustomerCode
                      qr={qr}
                      lang={lang}
                      busy={busy}
                      error={error}
                      onRefresh={showQr}
                      onClose={() => {
                        qrEpoch.current++;
                        setQr(null);
                      }}
                    />
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
                  <CustomerRequests card={card} lang={lang} onPending={setWaiting} />
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
