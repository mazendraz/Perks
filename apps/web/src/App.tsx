import { CustomerMessages } from './features/CustomerMessages.js';
import { InstallAppButton } from './features/InstallCard.js';
import { HeaderNotifications } from './features/PushToggle.js';
import { Select } from './controls/Select.js';
import { ControlLocale } from './controls/locale.js';
import {
  portalForPath,
  defaultPortal,
  portalInfo,
  applyPortalManifest,
  type Portal,
} from './portals.js';
import { initialLanguage } from './locale.js';
import { PwaStatus } from './pwa.js';
import { networkUnavailable } from './network.js';
import { Icon } from '../../../packages/ui/src/Icon.js';
import { Login, ResetPassword, PasswordSettings } from './features/Auth.js';
import { PlatformMfa } from './features/PlatformMfa.js';
import { LegalPage } from './features/Legal.js';
import { DeleteCustomerAccount, CustomerDeletionComplete } from './features/CustomerPrivacy.js';
import { CustomerPhoneSettings, WhatsAppRestorePage } from './features/CustomerWhatsApp.js';
import { useDialogAccessibility } from './dialog-accessibility.js';
import { Operations } from './features/Operations.js';
import { PhoneRelease } from './features/PhoneRelease.js';
import { PlacementPage } from './features/Materials.js';
import {
  CustomerCardUnavailable,
  CustomerDeviceHelp,
  CustomerRecoveryPage,
  RestoreCardsPage,
  WalletOpenPage,
} from './features/CustomerRecovery.js';
import { useCallback, useEffect, useRef, useState, lazy, Suspense, type ReactNode } from 'react';
import type { Session, Language } from '../../../packages/contracts/src/index.js';
import { api, ApiError, errorText, setCsrf } from './api.js';
import { navigate, useRoute } from './useRoute.js';
import { SuspendedNotice } from './features/SuspendedNotice.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { useSignOut } from './sign-out.js';
import { useStickyHeaderHeight } from './sticky-header.js';

// Where "/" leads someone without a staff session: their card when this device holds one
// (the customer session is restored from the device cookie), otherwise the sign-in page.
// Only a definite 401 means "no card here"; a failed or garbled reply opens the card page,
// which retries instead of sending a card holder to the staff sign-in.
async function customerHome() {
  try {
    await api<Session>('/session', { workspace: 'customer' }, false);
    return '/customer';
  } catch (e) {
    return e instanceof ApiError && e.status === 401 ? '/login' : '/customer';
  }
}
const PlatformPage = lazy(() =>
  import('./features/PlatformPage.js').then((m) => ({ default: m.PlatformPage })),
);
const CashierPage = lazy(() =>
  import('./features/CashierPage.js').then((m) => ({ default: m.CashierPage })),
);
const CashierScanRoute = lazy(() =>
  import('./features/ScanActions.js').then((m) => ({ default: m.CashierScanRoute })),
);
const SpamList = lazy(() =>
  import('./features/ScanActions.js').then((m) => ({ default: m.SpamList })),
);
const MerchantPage = lazy(() =>
  import('./features/MerchantPage.js').then((m) => ({ default: m.MerchantPage })),
);
const OwnerView = lazy(() =>
  import('./features/OwnerView.js').then((m) => ({ default: m.OwnerView })),
);
const Billing = lazy(() => import('./features/Billing.js').then((m) => ({ default: m.Billing })));
const PlatformTeam = lazy(() =>
  import('./features/PlatformTeam.js').then((m) => ({ default: m.PlatformTeam })),
);
import { CustomerPage, EnrollmentPage, InvitePage } from './features/CustomerPage.js';
import { MerchantOnboarding } from './features/MerchantOnboarding.js';
import { MerchantSignup } from './features/MerchantSignup.js';
import { OnboardingPayments } from './features/OnboardingPayments.js';
export function App() {
  useDialogAccessibility();
  useEffect(() => {
    document.documentElement.dataset.nuqtaReady = 'true';
    const fallback = document.getElementById('browser-fallback');
    if (fallback) fallback.hidden = true;
  }, []);
  const route = useRoute(),
    [lang, setLang] = useState<Language>(() => {
      const linked = new URLSearchParams(location.search).get('lang');
      return ['/privacy', '/terms'].includes(location.pathname) &&
        (linked === 'ar' || linked === 'en')
        ? linked
        : initialLanguage();
    });
  const portal = portalForPath(route);
  useEffect(
    () => applyPortalManifest(route.startsWith('/cashier') ? 'cashier' : portal),
    [route, portal],
  );
  const [sessionPortal, setSessionPortal] = useState<Portal | undefined>(portal);
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState('');
  // Customer portal: the session read failed without the server saying "signed out" (offline,
  // timeout, 5xx, a proxy error page). The device may well hold a card, so never show
  // "not on this device" for it; show a retry instead.
  const [unknownFailures, setUnknownFailures] = useState(0);
  // Which portal the current `session` was read for, so a kept session is never a stale
  // staff session shown on the customer page.
  const sessionFor = useRef<Portal | undefined>(undefined);
  const [accountDeleted, setAccountDeleted] = useState(false);
  useEffect(() => {
    const deleted = () => {
      setSession(null);
      setCsrf('');
      setNotice('');
      setAccountDeleted(true);
      navigate('/customer/deleted');
    };
    window.addEventListener('nuqta:customer-deleted', deleted);
    return () => window.removeEventListener('nuqta:customer-deleted', deleted);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const s = await api<Session>('/session');
      setCsrf(s.csrfToken);
      setSession(s);
      sessionFor.current = portal;
      setUnknownFailures(0);
    } catch (e) {
      const signedOut = e instanceof ApiError && e.status === 401;
      // Offline is already shown by the connection banner; do not stack a second message.
      const offline =
        e instanceof ApiError && (e.code === 'NETWORK_UNCERTAIN' || e.code === 'REQUEST_TIMEOUT');
      if (portal === 'customer' && !signedOut) {
        // Not an answer about the card: keep the card already on screen, or offer a retry.
        // The device cookie and CSRF token are left exactly as they are.
        if (sessionFor.current !== 'customer') setSession(null);
        setUnknownFailures((n) => n + 1);
        setSessionPortal(portal);
        setLoading(false);
        return;
      }
      if (!signedOut && !offline) setNotice(errorText(e, lang));
      setSession(null);
      sessionFor.current = undefined;
      setUnknownFailures(0);
      // A customer without a session may already have the anonymous bootstrap
      // CSRF token. A language refresh must not erase it before registration.
      if (portal !== 'customer') setCsrf('');
      // The home-screen app opens "/". A staff session was found above and is routed to its
      // portal; otherwise a card linked to this device opens the card, and anyone else signs in.
      if (signedOut && !portal && location.pathname === '/') {
        const home = await customerHome();
        if (location.pathname === '/') {
          history.replaceState({}, '', home);
          window.dispatchEvent(new PopStateEvent('popstate'));
          // A route into another portal re-runs this refresh for the new page, so keep the
          // loading screen. "/login" has the same (undefined) portal as "/", so nothing would
          // re-run: settle here instead of leaving the visitor on the loading screen.
          if (portalForPath(home) !== portal) return;
        }
      }
    }
    setSessionPortal(portal);
    setLoading(false);
  }, [lang, portal]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (portal !== 'customer' || session) return;
    // Another tab can link the browser while this one still shows the anonymous form.
    const resume = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, [portal, session, refresh]);
  useEffect(() => {
    const verify = () => {
      void refresh();
    };
    window.addEventListener('nuqta:mfa-required', verify);
    window.addEventListener('online', verify);
    window.addEventListener('nuqta:customer-session-restored', verify);
    return () => {
      window.removeEventListener('nuqta:mfa-required', verify);
      window.removeEventListener('online', verify);
      window.removeEventListener('nuqta:customer-session-restored', verify);
    };
  }, [refresh]);
  useEffect(() => {
    if (route === '/customer/login' && session && sessionPortal === portal) {
      navigate('/customer');
      return;
    }
    if (route.endsWith('/login') && route !== '/login' && route !== '/customer/login') {
      history.replaceState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else if ((route === '/' || route === '/portals') && session && sessionPortal === portal)
      navigate('/' + defaultPortal(session));
  }, [session, sessionPortal, portal, route]);
  useEffect(() => {
    if (
      !loading &&
      sessionPortal === portal &&
      !session &&
      !networkUnavailable() &&
      /^\/(platform|merchant|cashier)(\/|$)/.test(route) &&
      !route.endsWith('/login')
    )
      navigate('/login');
  }, [loading, sessionPortal, portal, session, route]);
  useEffect(() => {
    const expired = () => {
      setSession(null);
      sessionFor.current = undefined;
      setUnknownFailures(0);
      setCsrf('');
      setNotice(
        portal === 'customer'
          ? lang === 'ar'
            ? 'الكارت مش مربوط بالجهاز ده. افتحه من الـWallet، أو اطلب من الكاشير في أي محل Perks يرجعهولك.'
            : 'Your card is not linked to this device. Open it from your Wallet, or ask the cashier at any Perks shop to restore it.'
          : lang === 'ar'
            ? 'الجلسة انتهت. سجّل دخولك تاني لمتابعة العملية بأمان.'
            : 'Your session expired. Sign in again to safely continue.',
      );
    };
    window.addEventListener('nuqta:session-expired', expired);
    return () => window.removeEventListener('nuqta:session-expired', expired);
  }, [lang, portal]);
  // A card holder whose session read failed: try again a few times by itself (also on "online",
  // above), so a brief signal drop on a phone does not need a manual refresh.
  useEffect(() => {
    if (!unknownFailures || session || unknownFailures > 5) return;
    const timer = window.setTimeout(() => void refresh(), 2000 * 2 ** (unknownFailures - 1));
    return () => window.clearTimeout(timer);
  }, [unknownFailures, session, refresh]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const ar = lang === 'ar';
  // Staff sign-out keeps any customer card on this browser; see sign-out.tsx.
  const signOut = useSignOut(
    lang,
    () => {
      setSession(null);
      setCsrf('');
      navigate(portal === 'customer' ? '/customer/login' : '/login');
    },
    (e) => setNotice(errorText(e, lang)),
  );
  const [stampDock, setStampDock] = useState<HTMLDivElement | null>(null);
  const [header, setHeader] = useState<HTMLElement | null>(null);
  useStickyHeaderHeight(header);
  const cardPage =
    !!session &&
    portal === 'customer' &&
    (route === '/customer' ||
      (/^\/customer\/[^/]+$/.test(route) &&
        ![
          '/customer/account',
          '/customer/deleted',
          '/customer/open',
          '/customer/restore',
          '/customer/login',
        ].includes(route)));
  const logout = () => signOut.request();
  if (loading || sessionPortal !== portal)
    return (
      <main className="loading-screen" role="status">
        {ar ? 'بنفتح Perks…' : 'Opening Perks…'}
      </main>
    );
  return (
    <ControlLocale.Provider value={lang}>
      {!cardPage && <PwaStatus lang={lang} />}
      <a className="skip-link" href="#main">
        {ar ? 'روح للمحتوى' : 'Skip to content'}
      </a>
      <div className={cardPage ? 'customer-page-shell' : 'page-group'}>
        <header className="topbar" data-portal={portal} ref={setHeader}>
          <button
            className="wordmark"
            onClick={() => navigate(portal ? '/' + portal : '/')}
            aria-label={ar ? 'الرئيسية - Perks' : 'Perks home'}
          >
            <img className="perks-wordmark" src="/brand/perks-logo-wordmark.svg" alt="Perks" />
          </button>
          {portal && portal !== 'customer' && (
            <span className="portal-badge">{portalInfo[portal][ar ? 'ar' : 'en']}</span>
          )}
          <div className="top-actions">
            <button
              className="text-button"
              onClick={() => {
                const next = ar ? 'en' : 'ar';
                setLang(next);
                try {
                  localStorage.setItem('nuqta-language', next);
                } catch {
                  /* Keep this session choice when storage is unavailable. */
                }
              }}
            >
              {ar ? 'English' : 'العربية'}
            </button>
            {/* Customers have no password: signing out from the header could look like losing the
              card, so for them it lives in My account with a warning. */}
            {session &&
              portal !== 'customer' &&
              route !== '/' &&
              route !== '/portals' &&
              route !== '/login' && (
                <>
                  <bdi className="signed-in">{session.user.email || session.user.displayName}</bdi>
                  <button className="secondary small" onClick={() => void logout()}>
                    {ar ? 'خروج' : 'Sign out'}
                  </button>
                  {/* Last in the row: the far corner of the header (top-left in Arabic). */}
                  {portal === 'cashier' && <HeaderNotifications lang={lang} />}
                </>
              )}
          </div>
        </header>
        <div className={cardPage ? 'customer-page-scroll' : 'page-group'}>
          {cardPage && <PwaStatus lang={lang} />}
          {notice && (
            <div className="notice error" role="alert">
              {notice}
              <button className="text-button" onClick={() => setNotice('')}>
                {ar ? 'إغلاق' : 'Close'}
              </button>
            </div>
          )}
          {route === '/customer/deleted' && accountDeleted ? (
            <CustomerDeletionComplete lang={lang} />
          ) : route === '/customer/open' ? (
            <WalletOpenPage lang={lang} refresh={refresh} />
          ) : route === '/customer/restore' ? (
            <RestoreCardsPage lang={lang} />
          ) : route === '/customer/restore/whatsapp' ? (
            <WhatsAppRestorePage lang={lang} refresh={refresh} />
          ) : route === '/privacy' || route === '/terms' ? (
            <LegalPage kind={route === '/privacy' ? 'privacy' : 'terms'} lang={lang} />
          ) : route.startsWith('/reset-password/') ? (
            <ResetPassword token={route.split('/')[2] || ''} lang={lang} />
          ) : route.startsWith('/p/') ? (
            <PlacementPage code={route.split('/')[2] || ''} lang={lang} />
          ) : route.startsWith('/r/') ? (
            <CustomerRecoveryPage
              token={route.split('/')[2] || ''}
              lang={lang}
              session={session}
              refresh={refresh}
            />
          ) : portal === 'customer' && !session && route.startsWith('/customer') ? (
            // "Not on this device" only after the server said so (401). Anything else is a retry.
            unknownFailures ? (
              <CustomerCardUnavailable lang={lang} retry={refresh} />
            ) : (
              <CustomerDeviceHelp lang={lang} refresh={refresh} />
            )
          ) : route.startsWith('/join/') ? (
            <EnrollmentPage
              slug={route.split('/')[2] || ''}
              lang={lang}
              session={session}
              refresh={refresh}
            />
          ) : route === '/onboarding/signup' ? (
            <MerchantSignup lang={lang} />
          ) : route === '/onboarding' && session ? (
            <MerchantOnboarding key={session.user.id} lang={lang} />
          ) : !session || route === '/login' || route === '/' || route === '/portals' ? (
            <Login
              key={
                route.startsWith('/join/')
                  ? 'join-login'
                  : route.startsWith('/invite/')
                    ? 'invitation-login'
                    : 'login'
              }
              invited={route.startsWith('/invite/')}
              lang={lang}
              onSuccess={async (signedPortal) => {
                const next = await api<Session>('/session', {
                  workspace: signedPortal || 'shared',
                });
                setCsrf(next.csrfToken);
                setSession(next);
                sessionFor.current = portal;
                setSessionPortal(portal);
                setNotice('');
                if (
                  route !== '/onboarding' &&
                  !route.startsWith('/join/') &&
                  !route.startsWith('/invite/')
                )
                  navigate('/' + defaultPortal(next));
              }}
            />
          ) : (
            <Workspace
              session={session}
              lang={lang}
              route={route}
              refresh={refresh}
              onLogout={logout}
              stampDock={cardPage ? stampDock : null}
            />
          )}
          <footer className="footer" data-portal={portal}>
            {!cardPage &&
              (ar
                ? 'Perks · كارت الولاء بتاعك على موبايلك'
                : 'Perks · Loyalty cards in your wallet')}
            <nav className="legal-links" aria-label={ar ? 'الخصوصية والشروط' : 'Privacy and terms'}>
              <a href={'/privacy?lang=' + lang}>{ar ? 'الخصوصية' : 'Privacy'}</a>
              <a href={'/terms?lang=' + lang}>{ar ? 'الشروط' : 'Terms'}</a>
            </nav>
          </footer>
        </div>
        {cardPage && <div className="customer-stamp-dock" ref={setStampDock} />}
      </div>
    </ControlLocale.Provider>
  );
}
function Workspace({
  session,
  lang,
  route,
  refresh,
  onLogout,
  stampDock,
}: {
  session: Session;
  lang: Language;
  route: string;
  refresh: () => Promise<void>;
  onLogout: () => Promise<void>;
  stampDock: HTMLElement | null;
}) {
  const ar = lang === 'ar',
    portal = portalForPath(route) || defaultPortal(session);
  const [merchantId, setMerchantId] = useState('');
  const grants =
    portal === 'merchant'
      ? session.grants.filter((g) => g.role !== 'cashier')
      : portal === 'cashier'
        ? session.grants
        : [];
  const grant = grants.find((g) => g.merchant_id === merchantId) || grants[0];
  const home = '/' + portal,
    account = home + '/account';
  const platformAccess = ['platform_admin', 'platform_support'].includes(session.user.role);
  const nav = [
    {
      path: home,
      label:
        portal === 'platform'
          ? ar
            ? 'المحلات'
            : 'Businesses'
          : portal === 'merchant'
            ? ar
              ? 'لوحة المحل'
              : 'Business dashboard'
            : portal === 'cashier'
              ? ar
                ? 'الوردية'
                : 'Shift'
              : ar
                ? 'كروتي'
                : 'My cards',
      icon: portalInfo[portal].icon,
    },
    ...(portal === 'platform'
      ? [
          {
            path: '/platform/operations',
            label: ar ? 'التشغيل والدعم' : 'Operations and support',
            icon: 'chart',
          },
        ]
      : []),
    ...(portal === 'cashier' && grant
      ? [{ path: '/cashier/spam', label: ar ? 'سبام' : 'Spam', icon: 'shield' }]
      : []),
    { path: account, label: ar ? 'حسابي' : 'My account', icon: 'people' },
    ...(portal === 'platform' && session.user.role === 'platform_admin'
      ? [
          {
            path: '/platform/billing',
            label: ar ? 'الاشتراكات والباقات' : 'Billing and plans',
            icon: 'chart',
          },
          {
            path: '/platform/onboarding-payments',
            label: ar ? 'تحويلات InstaPay' : 'InstaPay transfers',
            icon: 'chart',
          },
          { path: '/platform/team', label: ar ? 'فريق الإدارة' : 'Platform team', icon: 'people' },
        ]
      : []),
  ];
  let content: ReactNode = (
    <div className="empty-state">
      <h1>
        {ar ? 'المساحة دي مش متاحة لحسابك' : 'This workspace is not available to your account'}
      </h1>
      <p>
        {ar
          ? 'راجع صلاحيتك مع مسؤول الحساب أو ادخل من بوابتك.'
          : 'Check your access with your account administrator or use your own portal.'}
      </p>
      <button className="secondary" onClick={() => navigate('/login')}>
        {ar ? 'تسجيل دخول بحساب آخر' : 'Sign in with another account'}
      </button>
    </div>
  );
  const needsMfa =
    platformAccess && session.user.mfaRequired !== false && !session.user.mfaVerified;
  if (portal === 'platform' && needsMfa) content = <PlatformMfa lang={lang} onVerified={refresh} />;
  else if (session.user.passwordChangeRequired)
    content = <PasswordSettings lang={lang} refresh={refresh} forced />;
  else if (route === account)
    content = (
      <>
        <div className="page-heading">
          <div>
            <span className="eyebrow">{portalInfo[portal][ar ? 'ar' : 'en']}</span>
            <h1>{ar ? 'حسابي' : 'My account'}</h1>
          </div>
        </div>
        <p className="muted">
          <bdi>{session.user.email || session.user.displayName}</bdi>
        </p>
        {portal === 'customer' ? (
          <>
            <p className="panel">
              {ar
                ? 'كارتك مربوط بالجهاز ده. لو غيّرت موبايلك، افتح كارتك من الـWallet أو اطلب من الكاشير يرجعهولك. مش محتاج باسورد.'
                : 'Your card is linked to this device. If you change phones, open your card from your Wallet or ask the cashier to restore it. You do not need a password.'}
            </p>
            <section className="panel">
              <h2>{ar ? 'الخروج من الجهاز ده' : 'Sign out on this device'}</h2>
              <p className="muted">
                {ar
                  ? 'كروتك مش هتضيع. عشان ترجعلها على الجهاز ده، افتحها من الـWallet أو اطلب من الكاشير يرجعهالك.'
                  : 'Your cards are kept. To see them on this device again, open them from your Wallet or ask the cashier to restore them.'}
              </p>
              <button className="danger-outline" onClick={() => void onLogout()}>
                {ar ? 'خروج' : 'Sign out'}
              </button>
            </section>
            <InstallAppButton lang={lang} portal="customer" />
            <CustomerMessages lang={lang} />
            <CustomerPhoneSettings lang={lang} />
            <DeleteCustomerAccount lang={lang} />
          </>
        ) : (
          <PasswordSettings lang={lang} refresh={refresh} />
        )}
      </>
    );
  else if (portal === 'platform' && platformAccess) {
    if (route === '/platform/team' && session.user.role === 'platform_admin')
      content = <PlatformTeam lang={lang} />;
    else if (route === '/platform/billing' && session.user.role === 'platform_admin')
      content = <Billing lang={lang} />;
    else if (route === '/platform/onboarding-payments' && session.user.role === 'platform_admin')
      content = <OnboardingPayments lang={lang} />;
    else if (route === '/platform/operations' || session.user.role === 'platform_support')
      content = (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">{ar ? 'إدارة Perks' : 'PERKS ADMINISTRATION'}</span>
              <h1>{ar ? 'التشغيل والدعم' : 'Operations and support'}</h1>
            </div>
          </div>
          <Operations lang={lang} admin={session.user.role === 'platform_admin'} />
          {session.user.role === 'platform_admin' && <PhoneRelease lang={lang} />}
        </>
      );
    else content = <PlatformPage lang={lang} userId={session.user.id} />;
  } else if (
    (route === '/merchant' || route.startsWith('/cashier')) &&
    route !== account &&
    grant?.status === 'suspended'
  )
    content = <SuspendedNotice grant={grant} lang={lang} />;
  else if (route === '/merchant' && grant)
    content = <MerchantPage key={grant.id} grant={grant} lang={lang} />;
  else if (route === '/cashier' && grant)
    content = <CashierPage key={grant.id} grant={grant} lang={lang} />;
  else if (route === '/cashier/spam' && grant)
    content = <SpamList key={grant.id} grant={grant} lang={lang} />;
  else if (/^\/cashier\/(requests|stamps|redeem)\/[0-9a-f-]{36}$/.test(route) && grant) {
    const [, , kind, id] = route.split('/');
    content = (
      <CashierScanRoute
        key={route}
        grants={grants}
        preferred={grant}
        lang={lang}
        kind={kind === 'requests' ? 'request' : kind === 'redeem' ? 'redeem' : 'stamp'}
        id={id!}
      />
    );
  } else if (route === '/customer' || (route.startsWith('/customer/') && route !== account))
    content = (
      <CustomerPage
        key={session.user.id}
        lang={lang}
        membershipId={route.split('/')[2]}
        stampDock={stampDock}
      />
    );
  else if (route.startsWith('/invite/'))
    content = <InvitePage token={route.split('/')[2] || ''} lang={lang} refresh={refresh} />;
  const previewMerchant = /^\/platform\/merchants\/([a-f0-9-]{36})\/owner-view$/.exec(route)?.[1];
  if (previewMerchant && session.user.role === 'platform_admin' && !needsMfa)
    return (
      <Suspense
        fallback={<p role="status">{ar ? 'بنفتح واجهة المالك…' : 'Loading owner view…'}</p>}
      >
        <OwnerView key={previewMerchant} merchantId={previewMerchant} lang={lang} />
      </Suspense>
    );
  const compact = portal === 'cashier' || portal === 'customer';
  return (
    <div
      className={'app-layout workspace-' + portal + (compact ? ' compact-workspace' : '')}
      data-portal={portal}
    >
      {!compact && (
        <aside className="sidebar">
          <div className="sidebar-identity">
            <span className="workspace-avatar">
              {portal === 'platform' ? (
                <img className="perks-avatar-mark" src="/brand/perks-app-icon.svg" alt="" />
              ) : grant?.logo_asset_id ? (
                <img
                  className="workspace-shop-logo"
                  alt=""
                  src={`/api/v1/merchants/${grant.merchant_id}/assets/${grant.logo_asset_id}?__portal=${portal}`}
                />
              ) : (
                grant?.name.slice(0, 1) || 'P'
              )}
            </span>
            <div>
              <strong>
                {portal === 'platform'
                  ? ar
                    ? 'إدارة Perks'
                    : 'Perks administration'
                  : grant?.name || portalInfo[portal][ar ? 'ar' : 'en']}
              </strong>
              <small>
                {portal === 'platform'
                  ? ar
                    ? 'المنصة'
                    : 'PLATFORM'
                  : ar
                    ? 'صاحب المحل'
                    : 'BUSINESS OWNER'}
              </small>
            </div>
          </div>
          <div className="sidebar-title">{ar ? 'مساحة العمل' : 'Workspace'}</div>
          {grants.length > 1 && (
            <label className="merchant-picker">
              {ar ? 'المحل' : 'Business'}
              <Select value={grant?.merchant_id} onChange={(e) => setMerchantId(e.target.value)}>
                {grants.map((g) => (
                  <option value={g.merchant_id} key={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <nav aria-label={ar ? 'التنقل الرئيسي' : 'Main navigation'}>
            {nav.map((n) => (
              <button
                key={n.path}
                aria-current={route === n.path ? 'page' : undefined}
                onClick={() => navigate(n.path)}
              >
                <Icon name={n.icon} />
                {n.label}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <Icon name={portalInfo[portal].icon} size={28} />
            <span>{portalInfo[portal][ar ? 'hintAr' : 'hintEn']}</span>
          </div>
        </aside>
      )}
      <main id="main" className="workspace-content">
        {compact && (
          <nav className="compact-nav" aria-label={ar ? 'التنقل الرئيسي' : 'Main navigation'}>
            {nav.map((n) => (
              <button
                key={n.path}
                aria-current={
                  route === n.path ||
                  (portal === 'customer' && n.path === home && route !== account)
                    ? 'page'
                    : undefined
                }
                onClick={() => navigate(n.path)}
              >
                <Icon name={n.icon} size={18} />
                {n.label}
              </button>
            ))}
          </nav>
        )}
        <Suspense
          fallback={<p role="status">{ar ? 'بنفتح مساحتك…' : 'Loading your workspace…'}</p>}
        >
          <ErrorBoundary resetKey={route}>{content}</ErrorBoundary>
        </Suspense>
      </main>
    </div>
  );
}
