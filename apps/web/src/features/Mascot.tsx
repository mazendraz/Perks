import { useEffect, useRef, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import './mascot.css';

/** Poses drawn by the Perks mascot engine: /mascot/<mood>.png is a 5-frame strip (idle, 3 mouths, blink). */
export type MascotMood = 'share' | 'add' | 'menu' | 'inapp' | 'done';

/**
 * Lines the mascot can say aloud. When a recording is ready, put it at /mascot/voice/<id>.mp3
 * and list its id here: the mascot then speaks it (Arabic only) and his mouth follows the audio.
 */
export type MascotLine =
  'ios-share' | 'ios-share-other' | 'ios-add' | 'inapp-ios' | 'inapp-android' | 'menu' | 'done';
export const MASCOT_VOICE: ReadonlySet<MascotLine> = new Set<MascotLine>([
  'ios-share',
  'ios-share-other',
  'ios-add',
  'inapp-ios',
  'inapp-android',
  'menu',
  'done',
]);

/** Plays a line once, outside a guide (e.g. the thumbs-up after installing). */
export function sayLine(line: MascotLine, lang: Language, onTalking?: (talking: boolean) => void) {
  if (lang !== 'ar' || !MASCOT_VOICE.has(line)) return;
  const sound = new Audio('/mascot/voice/' + line + '.mp3');
  sound.onplay = () => onTalking?.(true);
  sound.onended = sound.onerror = () => onTalking?.(false);
  sound.play().catch(() => onTalking?.(false));
}

const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Mascot({
  mood,
  line,
  lang,
  children,
}: {
  mood: MascotMood;
  line: MascotLine;
  lang: Language;
  children: React.ReactNode;
}) {
  const ar = lang === 'ar';
  const [talking, setTalking] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const bubble = useRef<HTMLParagraphElement>(null);
  const voiced = ar && MASCOT_VOICE.has(line);

  const speak = () => {
    audio.current?.pause();
    if (voiced) {
      const sound = new Audio('/mascot/voice/' + line + '.mp3');
      audio.current = sound;
      sound.onplay = () => setTalking(true);
      sound.onended = sound.onerror = sound.onpause = () => setTalking(false);
      sound.play().catch(() => setTalking(false));
      return;
    }
    if (reducedMotion()) return;
    // No recording: his mouth moves for about as long as the line takes to read.
    const length = bubble.current?.textContent?.length ?? 40;
    setTalking(true);
    const timer = setTimeout(() => setTalking(false), Math.min(3600, 900 + length * 38));
    return () => clearTimeout(timer);
  };

  useEffect(() => {
    const stop = speak();
    return () => {
      stop?.();
      audio.current?.pause();
      audio.current = null;
    };
  }, [line, mood]);

  return (
    <div className="mascot-say">
      <span
        className="mascot-sprite"
        data-talking={talking || undefined}
        style={{ backgroundImage: `url(/mascot/${mood}.png)` }}
        aria-hidden="true"
      />
      <div className="mascot-bubble" key={line}>
        <p ref={bubble} dir={ar ? 'rtl' : 'ltr'}>
          {children}
        </p>
        {voiced && (
          <button
            type="button"
            className="mascot-replay"
            aria-label={ar ? 'اسمعها تاني' : 'Play again'}
            onClick={() => speak()}
          >
            <Icon name="refresh" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
