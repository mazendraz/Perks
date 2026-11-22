import { useEffect, useRef, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import type { Portal } from '../portals.js';
import {
  dismissInstall,
  installPromptReady,
  isDismissed,
  isInstalled,
  promptInstall,
  subscribeInstall,
  waitForInstallPrompt,
} from '../install-prompt.js';
import { Mascot, sayLine } from './Mascot.js';
import './install-app.css';

const appName: Record<Portal, { ar: string; en: string }> = {
  customer: { ar: 'كروتي', en: 'My Cards' },
  cashier: { ar: 'الكاشير', en: 'Perks Cashier' },
  merchant: { ar: 'لوحة المحل', en: 'Perks Business' },
  platform: { ar: 'إدارة Perks', en: 'Perks Admin' },
};
const offer: Record<Portal, { ar: [string, string]; en: [string, string] }> = {
  customer: {
    ar: ['خلّي كروتك على الشاشة الرئيسية', 'تفتحها بضغطة، من غير ما تدوّر على اللينك'],
    en: ['Keep your cards on your home screen', 'Open them in one tap, no link hunting'],
  },
  cashier: {
    ar: [
      'خلّي الكاشير على الشاشة الرئيسية',
      'تفتح الوردية بضغطة واحدة، من غير ما تدوّر على اللينك',
    ],
    en: ['Keep the cashier on your home screen', 'Start your shift in one tap'],
  },
  merchant: {
    ar: ['خلّي لوحة المحل على الشاشة الرئيسية', 'تتابع محلك وعملاءك بضغطة واحدة'],
    en: ['Keep your business on your home screen', 'Check your shop and customers in one tap'],
  },
  platform: {
    ar: ['خلّي إدارة Perks على الشاشة الرئيسية', 'توصل للوحة الإدارة بضغطة واحدة'],
    en: ['Keep Perks Admin on your home screen', 'Reach the admin console in one tap'],
  },
};

function device(ua = navigator.userAgent, touch = navigator.maxTouchPoints) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
  const android = /Android/.test(ua);
  // Browsers inside other apps cannot add to the home screen at all.
  const inApp =
    /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|BytedanceWebview|Twitter/i.test(
      ua,
    ) ||
    (android && /; wv\)/.test(ua));
  return {
    ios,
    android,
    inApp,
    iphone: /iPhone|iPod/.test(ua),
    // Safari itself, not Chrome/Firefox/Edge on iOS (their Share button sits elsewhere).
    iosSafari: ios && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua),
  };
}

type Guide = 'ios' | 'inapp' | 'menu';
const DONE_MS = 3000;

/** "Add to home screen" for any portal: one tap where the browser allows it, the mascot elsewhere. */
export function InstallAppButton({ lang, portal }: { lang: Language; portal: Portal }) {
  const ar = lang === 'ar';
  const name = appName[portal][lang];
  const [title, benefit] = offer[portal][lang];
  const [, refresh] = useState(0);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'shown' | 'leaving' | null>(null);
  const [cheering, setCheering] = useState(false);
  useEffect(() => subscribeInstall(() => refresh((n) => n + 1)), []);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(
      () => setDone(done === 'shown' ? 'leaving' : null),
      done === 'shown' ? DONE_MS : 320,
    );
    return () => clearTimeout(timer);
  }, [done]);

  const hidden = isInstalled(portal) || isDismissed(portal);
  if (hidden && !done && !guide) return null;

  const add = async () => {
    const { ios, inApp } = device();
    if (inApp) return setGuide('inapp');
    if (ios) return setGuide('ios');
    setBusy(true);
    try {
      // The browser's install event can land a moment after the page opens.
      if (installPromptReady() || (await waitForInstallPrompt())) {
        const outcome = await promptInstall(portal);
        if (outcome === 'accepted') {
          setDone('shown');
          sayLine('done', lang, setCheering);
        }
        // Declined: the offer simply stays.
        if (outcome) return;
      }
      setGuide('menu');
    } catch {
      setGuide('menu');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {done ? (
        <div className="install-app-card install-card-link" data-done={done} role="status">
          <span
            className="install-app-done-mascot"
            data-talking={cheering || undefined}
            aria-hidden="true"
          />
          <p>
            <strong>{ar ? 'تمام! اتضاف' : 'Done! It is added'}</strong>
            <span>
              {ar
                ? `هتلاقي «${name}» على الشاشة الرئيسية.`
                : `You will find ${name} on your home screen.`}
            </span>
          </p>
        </div>
      ) : (
        !hidden && (
          <div className="install-app-card install-card-link">
            <img src="/icons/perks-192.png" alt="" width={48} height={48} />
            <p>
              <strong>{title}</strong>
              <span>{benefit}</span>
            </p>
            <button
              type="button"
              className="primary small"
              aria-label={ar ? `ضيف ${name} للشاشة الرئيسية` : `Add ${name} to home screen`}
              disabled={busy}
              onClick={() => void add()}
            >
              {busy ? (ar ? 'لحظة…' : 'One sec…') : ar ? 'ضيف' : 'Add'}
            </button>
            <button
              type="button"
              className="install-app-dismiss"
              aria-label={ar ? 'مش دلوقتي' : 'Not now'}
              title={ar ? 'هنفكّرك تاني بعد أسبوع' : 'We will remind you in a week'}
              onClick={() => dismissInstall(portal)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )
      )}
      {guide && (
        <InstallGuide kind={guide} lang={lang} name={name} onClose={() => setGuide(null)} />
      )}
    </>
  );
}

function InstallGuide({
  kind,
  lang,
  name,
  onClose,
}: {
  kind: Guide;
  lang: Language;
  name: string;
  onClose: () => void;
}) {
  const ar = lang === 'ar';
  const d = device();
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(0);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2400);
    } catch {
      /* Clipboard blocked: the link is still shown for a long-press copy. */
    }
  };
  const browser = d.ios ? 'Safari' : 'Chrome';
  const last = kind !== 'ios' || step === 1;

  return (
    <div className="modal-backdrop sheet-backdrop" onClick={onClose}>
      <section
        className="dialog limit-sheet install-card-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-guide-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="install-guide-head">
          <h2 id="install-guide-heading">{ar ? `ضيف ${name} للشاشة الرئيسية` : `Add ${name}`}</h2>
          <button
            type="button"
            className="install-app-dismiss"
            data-dialog-close
            aria-label={ar ? 'إغلاق' : 'Close'}
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {kind === 'ios' && step === 0 && (
          <>
            <Mascot mood="share" line={d.iosSafari ? 'ios-share' : 'ios-share-other'} lang={lang}>
              {d.iosSafari
                ? ar
                  ? 'دوس على زرار المشاركة تحت. لو مش باين، دوس على «•••» الأول.'
                  : 'Tap the Share button below. Not there? Tap “•••” first.'
                : ar
                  ? 'دوس على زرار المشاركة في المتصفح.'
                  : 'Tap the Share button in your browser.'}
            </Mascot>
            <ShareArt lang={lang} />
          </>
        )}
        {kind === 'ios' && step === 1 && (
          <>
            <Mascot mood="add" line="ios-add" lang={lang}>
              {ar
                ? 'انزل شوية واختار «إضافة إلى الشاشة الرئيسية»، وبعدين «إضافة». خلاص كده!'
                : 'Scroll down, pick “Add to Home Screen”, then “Add”. That’s it!'}
            </Mascot>
            <AddArt lang={lang} />
          </>
        )}
        {kind === 'inapp' && (
          <>
            <Mascot mood="inapp" line={d.ios ? 'inapp-ios' : 'inapp-android'} lang={lang}>
              {ar
                ? `إنت فاتح الصفحة من جوه تطبيق تاني، ومنه مينفعش تضيفها. انسخ اللينك وافتحه في ${browser}.`
                : `You opened this inside another app, which can't add it. Copy the link and open it in ${browser}.`}
            </Mascot>
            <div className="install-guide-link">
              <code dir="ltr">{location.host + location.pathname}</code>
              <button type="button" className="secondary small" onClick={() => void copy()}>
                <Icon name={copied ? 'check' : 'copy'} size={16} />
                {copied ? (ar ? 'اتنسخ' : 'Copied') : ar ? 'انسخ اللينك' : 'Copy link'}
              </button>
            </div>
          </>
        )}
        {kind === 'menu' && (
          <Mascot mood="menu" line="menu" lang={lang}>
            {ar
              ? 'افتح قايمة المتصفح «⋮» واختار «تثبيت التطبيق» أو «إضافة للشاشة الرئيسية».'
              : 'Open the browser menu “⋮” and choose “Install app” or “Add to Home screen”.'}
          </Mascot>
        )}

        {kind === 'ios' && (
          <div className="install-guide-dots" aria-hidden="true">
            <span data-on={step === 0} />
            <span data-on={step === 1} />
          </div>
        )}
        {last ? (
          <button type="button" className="primary full" onClick={onClose}>
            {ar ? 'تمام' : 'Got it'}
          </button>
        ) : (
          <button type="button" className="primary full" onClick={() => setStep(1)}>
            {ar ? 'التالي' : 'Next'}
          </button>
        )}
        {kind === 'ios' && step === 0 && d.iphone && d.iosSafari && (
          // Safari's toolbar sits just under the sheet: point at it.
          <span className="install-guide-pointer" aria-hidden="true" />
        )}
      </section>
    </div>
  );
}

function ShareArt({ lang }: { lang: Language }) {
  return (
    <svg
      className="install-guide-art"
      viewBox="0 0 260 74"
      role="img"
      aria-label={lang === 'ar' ? 'زرار المشاركة في Safari' : 'Share button in Safari'}
    >
      <rect x="1" y="1" width="258" height="72" rx="16" fill="#f4f5ef" />
      <circle cx="130" cy="37" r="22" fill="#cbff64" />
      <g
        fill="none"
        stroke="#181b38"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M130 46V24m-7 7 7-7 7 7M121 35h-3v15h24V35h-3" />
        <path d="m42 30-7 7 7 7m30-14 7 7-7 7" />
      </g>
      <g fill="#181b38">
        <circle cx="209" cy="37" r="2.2" />
        <circle cx="217" cy="37" r="2.2" />
        <circle cx="225" cy="37" r="2.2" />
      </g>
    </svg>
  );
}

function AddArt({ lang }: { lang: Language }) {
  const label = lang === 'ar' ? 'إضافة إلى الشاشة الرئيسية' : 'Add to Home Screen';
  // HTML rather than SVG text so Arabic shapes and flows correctly.
  return (
    <div className="install-guide-art install-guide-add" role="img" aria-label={label}>
      <span className="install-guide-add-row" aria-hidden="true">
        <span className="install-guide-add-icon">
          <Icon name="plus" size={18} />
        </span>
        {label}
      </span>
    </div>
  );
}
