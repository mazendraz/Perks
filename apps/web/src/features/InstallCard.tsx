import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { ActionLabel } from '../../../../packages/ui/src/Icon.js';
import {
  installPromptReady,
  isInstalled,
  promptInstall,
  subscribeInstall,
} from '../install-prompt.js';
export function InstallCard({ lang }: { lang: Language }) {
  const ar = lang === 'ar',
    ios =
      /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const [guide, setGuide] = useState(false),
    [ready, setReady] = useState(installPromptReady),
    [installed, setInstalled] = useState(isInstalled);
  useEffect(
    () =>
      subscribeInstall(() => {
        setReady(installPromptReady());
        setInstalled(isInstalled());
      }),
    [],
  );
  const close = () => setGuide(false);
  if (installed) return null;
  const save = async () => {
    if (ready) {
      try {
        if (await promptInstall()) {
          return;
        }
      } catch {
        /* Fall back to browser instructions. */
      }
    }
    setGuide(true);
  };
  return (
    <>
      <button className="secondary install-card-link" onClick={() => void save()}>
        <ActionLabel icon="download">
          {ar ? 'ضيف My Cards للشاشة الرئيسية' : 'Add My Cards to home screen'}
        </ActionLabel>
      </button>
      {guide && (
        <div className="modal-backdrop">
          <section
            className="dialog install-card-guide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-card-heading"
          >
            <div className="section-heading">
              <h2 id="install-card-heading">{ar ? 'ضيف My Cards' : 'Add My Cards'}</h2>
              <button className="secondary" data-dialog-close onClick={close}>
                {ar ? 'إغلاق' : 'Close'}
              </button>
            </div>
            {ios ? (
              <>
                <figure>
                  <svg
                    viewBox="0 0 260 94"
                    role="img"
                    aria-label={ar ? 'زر المشاركة في Safari' : 'Share button in Safari'}
                  >
                    <rect x="1" y="1" width="258" height="92" rx="16" fill="#f4f5ef" />
                    <rect x="18" y="18" width="224" height="22" rx="8" fill="#e4e8dc" />
                    <g
                      fill="none"
                      stroke="#204c41"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M130 76V46m-8 8 8-8 8 8M116 64v18h28V64" />
                      <path d="m40 58-8 8 8 8m176-16 8 8-8 8" />
                    </g>
                  </svg>
                  <figcaption>
                    <b>1.</b>{' '}
                    {ar
                      ? 'افتح «مشاركة» في Safari، من شريط الأدوات أو قائمة الصفحة.'
                      : 'Open Share in Safari, from the toolbar or page menu.'}
                  </figcaption>
                </figure>
                <figure>
                  <svg
                    viewBox="0 0 260 94"
                    role="img"
                    aria-label={ar ? 'إضافة للشاشة الرئيسية' : 'Add to Home Screen'}
                  >
                    <rect x="1" y="1" width="258" height="92" rx="16" fill="#f4f5ef" />
                    <rect
                      x="18"
                      y="20"
                      width="224"
                      height="56"
                      rx="12"
                      fill="#fff"
                      stroke="#dce2d3"
                    />
                    <g fill="none" stroke="#204c41" strokeWidth="2.4" strokeLinecap="round">
                      <rect x="34" y="35" width="25" height="25" rx="5" />
                      <path d="M46.5 40v15m-7.5-7.5h15M79 41h116m-116 14h90" />
                    </g>
                  </svg>
                  <figcaption>
                    <b>2.</b>{' '}
                    {ar
                      ? 'اختار «إضافة للشاشة الرئيسية»، وبعدها «إضافة».'
                      : 'Choose Add to Home Screen, then Add.'}
                  </figcaption>
                </figure>
              </>
            ) : (
              <p>
                {ar
                  ? 'من قائمة المتصفح، اختار «تثبيت التطبيق» أو «إضافة للشاشة الرئيسية». لو الخيار مش ظاهر، افتح كروتي من Chrome.'
                  : 'Open the browser menu and choose Install app or Add to Home screen. If it is unavailable, open My Cards in Chrome.'}
              </p>
            )}
            <button className="primary full" onClick={close}>
              {ar ? 'تمام' : 'Got it'}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
