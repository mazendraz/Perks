import { Select } from './controls/Select.js';
import { ControlLocale } from './controls/locale.js';
import { portalForPath, defaultPortal, portalInfo, type Portal } from './portals.js';
import { initialLanguage } from './locale.js';
import { Icon } from '../../../packages/ui/src/Icon.js';
import { Login, ResetPassword, PasswordSettings } from './features/Auth.js';
import { PlatformMfa } from './features/PlatformMfa.js';
import { useDialogAccessibility } from './dialog-accessibility.js';
import { Operations } from './features/Operations.js';
import { PlacementPage } from './features/Materials.js';
import { useCallback, useEffect, useState, lazy, Suspense, type ReactNode } from 'react';
import type { Session, Language } from '../../../packages/contracts/src/index.js';
import { api, ApiError, errorText, setCsrf } from './api.js';
import { navigate, useRoute } from './useRoute.js';
const PlatformPage = lazy(() =>
  import('./features/PlatformPage.js').then((m) => ({ default: m.PlatformPage })),
);
const CashierPage = lazy(() =>
  import('./features/CashierPage.js').then((m) => ({ default: m.CashierPage })),
);
const MerchantPage = lazy(() =>
  import('./features/MerchantPage.js').then((m) => ({ default: m.MerchantPage })),
);
const OwnerView = lazy(() =>
  import('./features/OwnerView.js').then((m) => ({ default: m.OwnerView })),
);
const PlatformTeam = lazy(() =>
  import('./features/PlatformTeam.js').then((m) => ({ default: m.PlatformTeam })),
);
import { CustomerPage, EnrollmentPage, InvitePage } from './features/CustomerPage.js';
export function App() {
  useDialogAccessibility();
  const route = useRoute(),
    [lang, setLang] = useState<Language>(initialLanguage);
  const portal = portalForPath(route);
  const [sessionPortal, setSessionPortal] = useState<Portal | undefined>(portal);
  const [joinLogin, setJoinLogin] = useState(false);
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    try {
      const s = await api<Session>('/session');
      setCsrf(s.csrfToken);
      setSession(s);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) setNotice(errorText(e, lang));
      setSession(null);
      setCsrf('');
    } finally {
      setSessionPortal(portal);
      setLoading(false);
    }
  }, [lang, portal]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const verify = () => {
      void refresh();
    };
    window.addEventListener('nuqta:mfa-required', verify);
    return () => window.removeEventListener('nuqta:mfa-required', verify);
  }, [refresh]);
  useEffect(() => {
    if (route.endsWith('/login') && route !== '/login') {
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
      /^\/(platform|merchant|cashier|customer)(\/|$)/.test(route) &&
      !route.endsWith('/login')
    )
      navigate('/login');
  }, [loading, sessionPortal, portal, session, route]);
  useEffect(() => {
    const expired = () => {
      setSession(null);
      setCsrf('');
      setNotice(
        lang === 'ar'
          ? 'الجلسة انتهت. سجّل دخولك تاني لمتابعة العملية بأمان.'
          : 'Your session expired. Sign in again to safely continue.',
      );
    };
    window.addEventListener('nuqta:session-expired', expired);
    return () => window.removeEventListener('nuqta:session-expired', expired);
  }, [lang]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const ar = lang === 'ar';
  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
      setSession(null);
      setCsrf('');
      navigate('/login');
    } catch (e) {
      setNotice(errorText(e, lang));
    }
  };
  if (loading || sessionPortal !== portal)
    return (
      <main className="loading-screen" role="status">
        {ar ? 'بنفتح نقطة…' : 'Opening Nuqta…'}
      </main>
    );
  return (
    <ControlLocale.Provider value={lang}>
      <a className="skip-link" href="#main">
        {ar ? 'روح للمحتوى' : 'Skip to content'}
      </a>
      <header className="topbar">
        <button
          className="wordmark"
          onClick={() => navigate(portal ? '/' + portal : '/')}
          aria-label="Nuqta home"
        >
          <span className="nuqta-symbol">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <path
                d="M10 27V13l20 14V13"
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="30" cy="8" r="3" fill="currentColor" />
            </svg>
          </span>
          {ar ? 'نقطة' : 'Nuqta'}
        </button>
        {portal && <span className="portal-badge">{portalInfo[portal][ar ? 'ar' : 'en']}</span>}
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
          {session && route !== '/' && route !== '/portals' && route !== '/login' && (
            <>
              <bdi className="signed-in">{session.user.email}</bdi>
              <button className="secondary small" onClick={() => void logout()}>
                {ar ? 'خروج' : 'Sign out'}
              </button>
            </>
          )}
        </div>
      </header>
      {notice && (
        <div className="notice error" role="alert">
          {notice}
          <button className="text-button" onClick={() => setNotice('')}>
            {ar ? 'إغلاق' : 'Close'}
          </button>
        </div>
      )}
      {route.startsWith('/reset-password/') ? (
        <ResetPassword token={route.split('/')[2] || ''} lang={lang} />
      ) : route.startsWith('/p/') ? (
        <PlacementPage code={route.split('/')[2] || ''} lang={lang} />
      ) : route.startsWith('/join/') && !joinLogin ? (
        <EnrollmentPage
          slug={route.split('/')[2] || ''}
          lang={lang}
          session={session}
          onNeedLogin={() => setJoinLogin(true)}
        />
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
          allowRegistration={route.startsWith('/join/') || route.startsWith('/invite/')}
          lang={lang}
          onSuccess={async (signedPortal) => {
            const next = await api<Session>('/session', { workspace: signedPortal || 'shared' });
            setCsrf(next.csrfToken);
            setSession(next);
            setSessionPortal(portal);
            setJoinLogin(false);
            setNotice('');
            if (!route.startsWith('/join/') && !route.startsWith('/invite/'))
              navigate('/' + defaultPortal(next));
          }}
        />
      ) : (
        <Workspace session={session} lang={lang} route={route} refresh={refresh} />
      )}
      <footer className="footer">
        {ar ? 'نقطة · كل علاقة بتبدأ بنقطة' : 'Nuqta · A small beginning, a lasting connection'}
      </footer>
    </ControlLocale.Provider>
  );
}
function Workspace({
  session,
  lang,
  route,
  refresh,
}: {
  session: Session;
  lang: Language;
  route: string;
  refresh: () => Promise<void>;
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
    { path: account, label: ar ? 'حسابي' : 'My account', icon: 'people' },
    ...(portal === 'platform' && session.user.role === 'platform_admin'
      ? [{ path: '/platform/team', label: ar ? 'فريق الإدارة' : 'Platform team', icon: 'people' }]
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
          <bdi>{session.user.email}</bdi>
        </p>
        <PasswordSettings lang={lang} refresh={refresh} />
      </>
    );
  else if (portal === 'platform' && platformAccess) {
    if (route === '/platform/team' && session.user.role === 'platform_admin')
      content = <PlatformTeam lang={lang} />;
    else if (route === '/platform/operations' || session.user.role === 'platform_support')
      content = (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">{ar ? 'إدارة نقطة' : 'NUQTA ADMINISTRATION'}</span>
              <h1>{ar ? 'التشغيل والدعم' : 'Operations and support'}</h1>
            </div>
          </div>
          <Operations lang={lang} admin={session.user.role === 'platform_admin'} />
        </>
      );
    else content = <PlatformPage lang={lang} userId={session.user.id} />;
  } else if (route === '/merchant' && grant)
    content = <MerchantPage key={grant.id} grant={grant} lang={lang} />;
  else if (route === '/cashier' && grant)
    content = <CashierPage key={grant.id} grant={grant} lang={lang} />;
  else if (route === '/customer' || (route.startsWith('/customer/') && route !== account))
    content = <CustomerPage lang={lang} membershipId={route.split('/')[2]} />;
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
              {portal === 'platform' ? 'N' : grant?.name.slice(0, 1) || 'N'}
            </span>
            <div>
              <strong>
                {portal === 'platform'
                  ? ar
                    ? 'إدارة نقطة'
                    : 'Nuqta administration'
                  : grant?.name || portalInfo[portal][ar ? 'ar' : 'en']}
              </strong>
              <small>{portal === 'platform' ? 'PLATFORM' : 'BUSINESS OWNER'}</small>
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
                aria-current={route === n.path ? 'page' : undefined}
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
          {content}
        </Suspense>
      </main>
    </div>
  );
}
