// Phone vibration for card moments. Android browsers vibrate through navigator.vibrate.
// iPhone browsers have no vibration API; Safari 18+ gives a light tap when a switch toggles,
// so one tap per pulse is tried there. Both are best-effort and silently do nothing elsewhere.
export type HapticPattern = number | number[];
let iosSwitch: HTMLLabelElement | null = null;
function iosTap() {
  if (typeof document === 'undefined') return;
  if (!iosSwitch) {
    const label = document.createElement('label'),
      input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText =
      'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9px;top:0';
    label.append(input);
    document.body.append(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}
export function haptic(pattern: HapticPattern) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
      return;
    }
    // Pattern = vibrate, pause, vibrate…: one tap at the start of each pulse.
    const pulses = Array.isArray(pattern) ? pattern : [pattern];
    let at = 0;
    pulses.forEach((ms, i) => {
      if (i % 2 === 0) window.setTimeout(iosTap, at);
      at += ms;
    });
  } catch {
    /* Optional. */
  }
}
/** A firm double knock as a stamp lands. */
export const STAMP_HAPTIC: HapticPattern = [35, 55, 70];
/** A longer burst when the card completes and the reward is ready. */
export const REWARD_HAPTIC: HapticPattern = [70, 60, 70, 60, 180];
