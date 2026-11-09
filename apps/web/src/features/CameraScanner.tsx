import { useEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';
import type { Language } from '../../../../packages/contracts/src/index.js';
export function CameraScanner({
  lang,
  onRead,
}: {
  lang: Language;
  onRead: (value: string) => void;
}) {
  const latest = useRef({ lang, onRead });
  latest.current = { lang, onRead };
  const video = useRef<HTMLVideoElement>(null),
    [active, setActive] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!active || !video.current) return;
    const element = video.current;
    let controls: IScannerControls | undefined,
      stream: MediaStream | undefined,
      cancelled = false;
    const stop = () => {
      cancelled = true;
      try {
        controls?.stop();
      } finally {
        stream?.getTracks().forEach((track) => track.stop());
        element.pause();
        element.srcObject = null;
      }
    };
    const hidden = () => {
      if (document.hidden) {
        stop();
        setActive(false);
      }
    };
    document.addEventListener('visibilitychange', hidden);
    void (async () => {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      if (cancelled) return;
      const reader = new BrowserQRCodeReader();
      if (document.hidden) {
        setActive(false);
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      });
      // Permission may resolve after the user hides the page; release it before decoding.
      if (cancelled || document.hidden) {
        stop();
        return;
      }
      return reader.decodeFromStream(stream, element, (result) => {
        if (result && !cancelled) {
          stop();
          setActive(false);
          latest.current.onRead(result.getText());
        }
      });
    })()
      .then((c) => {
        controls = c;
        if (cancelled) c?.stop();
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            latest.current.lang === 'ar'
              ? 'الكاميرا مش متاحة. اسمح بالوصول أو اكتب الكود يدويًا.'
              : 'Camera unavailable. Allow access or enter the code manually.',
          );
          stop();
          setActive(false);
        }
      });
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      stop();
    };
  }, [active]);
  return (
    <div>
      {active && <video ref={video} className="video-scanner" muted playsInline />}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <button
        className="primary full"
        type="button"
        onClick={() => {
          setError('');
          setActive(!active);
        }}
      >
        {active
          ? lang === 'ar'
            ? 'اقفل الكاميرا'
            : 'Close camera'
          : lang === 'ar'
            ? 'افتح الكاميرا'
            : 'Open camera'}
      </button>
    </div>
  );
}
