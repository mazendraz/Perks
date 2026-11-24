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

/**
 * One shared player. iOS Safari only lets audio play straight from a tap, and the guide opens
 * one render later, so the tap that opens it calls primeLine() and the guide reuses this player.
 * Once it has played from a tap, iOS lets it play the next lines on its own.
 */
let player: HTMLAudioElement | null = null;
const voiceUrl = (line: MascotLine) => '/mascot/voice/' + line + '.mp3';
const playerOn = (line: MascotLine) =>
  !!player && !player.paused && !player.ended && player.src.endsWith(voiceUrl(line));

/** Call synchronously inside the tap that opens a guide, so its first line can be heard on iOS. */
export function primeLine(line: MascotLine, lang: Language) {
  if (lang !== 'ar' || !MASCOT_VOICE.has(line)) return;
  player ??= new Audio();
  player.src = voiceUrl(line);
  player.play().catch(() => {});
}

/** Plays a line once, outside a guide (e.g. the thumbs-up after installing). */
export function sayLine(line: MascotLine, lang: Language, onTalking?: (talking: boolean) => void) {
  if (lang !== 'ar' || !MASCOT_VOICE.has(line)) return;
  const sound = new Audio(voiceUrl(line));
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
  const bubble = useRef<HTMLParagraphElement>(null);
  const voiced = ar && MASCOT_VOICE.has(line);

  const speak = () => {
    if (voiced) {
      player ??= new Audio();
      const sound = player;
      sound.onplay = () => setTalking(true);
      sound.onended = sound.onerror = sound.onpause = () => setTalking(false);
      // Already started by the tap that opened the guide: just follow it.
      if (playerOn(line)) {
        setTalking(true);
        return;
      }
      sound.src = voiceUrl(line);
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
      if (voiced && player) {
        player.onplay = player.onended = player.onerror = player.onpause = null;
        player.pause();
      }
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
