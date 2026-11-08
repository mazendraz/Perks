import { StampFrame, StampSymbol } from './StampSymbol.js';
import { CardArtwork } from './CardArtwork.js';
import { templateCategory } from '../../contracts/src/branding.js';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from './Icon.js';
import type { CardData } from '../../contracts/src/index.js';
export function cardInk(color: string) {
  const rgb = /^#([a-f0-9]{6})$/i.exec(color)?.[1];
  if (!rgb) return '#ffffff';
  const channels = [0, 2, 4]
    .map((i) => parseInt(rgb.slice(i, i + 2), 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722 > 0.179
    ? '#132a26'
    : '#ffffff';
}
export function LoyaltyCard({ card, lang = 'ar' }: { card: CardData; lang?: 'ar' | 'en' }) {
  const threshold = Math.max(
      2,
      Math.min(50, Number.isFinite(card.threshold) ? Math.floor(card.threshold) : 5),
    ),
    balance = Math.max(0, Math.min(card.display_balance ?? card.balance, threshold));
  const previous = useRef({
    id: card.id,
    balance,
    rawBalance: card.balance,
    revision: card.revision,
    cycle: card.cycle_number ?? 1,
    rewards: card.pending_rewards ?? 0,
  });
  const [motion, setMotion] = useState<{ kind: string; from: number; message: string } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const prev = previous.current,
      cycle = card.cycle_number ?? 1,
      rewards = card.pending_rewards ?? 0;
    previous.current = {
      id: card.id,
      balance,
      rawBalance: card.balance,
      revision: card.revision,
      cycle,
      rewards,
    };
    if (prev.id !== card.id) {
      clearTimeout(timer.current);
      setMotion(null);
      return;
    }
    if (prev.revision === card.revision) return;
    const renewed = cycle > prev.cycle,
      earned = rewards > prev.rewards;
    if (!renewed && !earned && balance <= prev.balance && card.balance <= prev.rawBalance) return;
    clearTimeout(timer.current);
    setMotion({
      kind: renewed ? 'cycle-renew' : earned ? 'reward-earned' : 'stamp-added',
      from: renewed ? 0 : prev.balance,
      message: renewed
        ? lang === 'ar'
          ? 'المكافأة اتصرفت. كارت جديد بدأ!'
          : 'Reward redeemed. A new card has started!'
        : earned
          ? lang === 'ar'
            ? 'كملت الأختام! مكافأتك جاهزة.'
            : 'Card complete! Your reward is ready.'
          : lang === 'ar'
            ? 'اتضافت أختام جديدة لكارتك.'
            : 'New stamps added to your card.',
    });
    timer.current = setTimeout(() => setMotion(null), 1600);
  }, [
    card.id,
    card.revision,
    card.cycle_number,
    card.pending_rewards,
    card.balance,
    balance,
    lang,
  ]);
  const ar = lang === 'ar',
    category = templateCategory(card.template);
  const edition =
    category === 'cafe'
      ? ar
        ? 'عضوية الكافيه'
        : 'CAFÉ MEMBERSHIP'
      : category === 'restaurant'
        ? ar
          ? 'عضوية المطعم'
          : 'DINING MEMBERSHIP'
        : category === 'barber'
          ? ar
            ? 'عضوية العناية'
            : 'GROOMING MEMBERSHIP'
          : ar
            ? 'عضوية ولاء'
            : 'LOYALTY MEMBERSHIP';
  const style = {
    '--logo-size': Math.max(32, Math.min(72, card.logo_size || 43)) + 'px',
    '--brand': card.primary_color,
    '--accent': card.accent_color,
    '--surface': card.surface_color,
    '--card-ink': cardInk(card.primary_color),
    '--accent-ink': cardInk(card.accent_color),
    '--surface-ink': cardInk(card.surface_color),
    '--progress': (balance / threshold) * 100 + '%',
  } as CSSProperties;
  return (
    <article
      className={
        'loyalty-card ' +
        card.template +
        ' logo-' +
        (card.logo_style || 'framed') +
        (card.logo_asset_id || card.logo_url ? ' has-logo' : '') +
        ' stamp-shape-' +
        (card.stamp_shape || 'circle') +
        ' stamp-style-' +
        (card.stamp_style || 'solid') +
        (motion ? ' ' + motion.kind : '')
      }
      data-stamp-icon={card.stamp_icon || 'check'}
      style={style}
      aria-label={card.merchant_name}
    >
      <CardArtwork template={card.template} />
      <div className="card-overline">
        <span>{edition}</span>
        <span className="card-contactless" aria-hidden="true">
          )))
        </span>
      </div>
      <div className="card-heading">
        <span className="brand-mark">
          {card.logo_asset_id || card.logo_url ? (
            <img
              src={
                card.logo_url ||
                '/api/v1/public/merchants/' + card.merchant_id + '/logos/' + card.logo_asset_id
              }
              alt=""
            />
          ) : (
            card.merchant_name.slice(0, 1)
          )}
        </span>
        <div>
          <strong>{card.merchant_name}</strong>
          <small>{card.program_name}</small>
        </div>
        <span className="card-monogram" aria-hidden="true">
          {category === 'general' ? (
            <Icon name="spark" size={25} />
          ) : (
            <StampSymbol
              symbol={
                category === 'cafe' ? 'coffee' : category === 'restaurant' ? 'utensils' : 'scissors'
              }
              className="edition-symbol"
            />
          )}
        </span>
      </div>
      <div className="card-member-line">
        <div>
          <span className="card-member-label">{ar ? 'باسم' : 'MEMBER'}</span>
          <div className="card-alias">{card.alias}</div>
        </div>
        {card.cycle_number !== undefined && (
          <div className="card-cycle">
            {ar ? 'كارت رقم ' : 'Card '}
            {card.cycle_number}
          </div>
        )}
      </div>
      <div
        className="stamp-dots"
        style={{ gridTemplateColumns: 'repeat(' + Math.min(threshold, 6) + ',minmax(0,1fr))' }}
        aria-hidden="true"
      >
        {Array.from({ length: threshold }, (_, i) => (
          <span
            className={
              (i < balance ? 'filled' : '') +
              (motion && i >= motion.from && i < balance ? ' stamp-land' : '')
            }
            style={
              {
                '--stamp-delay': Math.min(5, Math.max(0, i - (motion?.from ?? 0))) * 65 + 'ms',
              } as CSSProperties
            }
            key={i}
          >
            <StampFrame shape={card.stamp_shape} />
            {i < balance ? (
              <StampSymbol symbol={card.stamp_icon} />
            ) : i === threshold - 1 ? (
              <Icon name="gift" size={20} />
            ) : (
              <span className="stamp-number">{String(i + 1).padStart(2, '0')}</span>
            )}
          </span>
        ))}
      </div>
      <div className="card-progress-line">
        <div
          role="progressbar"
          aria-label={ar ? 'رصيد الأختام' : 'Stamp progress'}
          aria-valuemin={0}
          aria-valuemax={threshold}
          aria-valuenow={balance}
          className="card-progress"
        >
          <b>{balance}</b> {ar ? 'من' : 'of'} {threshold}
        </div>
        <span>
          {balance === threshold
            ? ar
              ? 'مكافأتك جاهزة'
              : 'READY TO REDEEM'
            : ar
              ? 'كل زيارة بتقرّبك'
              : 'ONE VISIT CLOSER'}
        </span>
      </div>
      <div className="card-progress-track" aria-hidden="true">
        <span />
      </div>
      <div className="card-reward-line">
        <div>
          <small>{ar ? 'المكافأة اللي جاية' : 'YOUR NEXT REWARD'}</small>
          <strong className="card-reward">{card.reward_title}</strong>
        </div>
        <span className="card-nuqta">
          NUQTA <i>●</i>
        </span>
      </div>
      {!!card.pending_rewards && (
        <div className="reward-ready">
          <Icon name="spark" size={17} />
          {ar ? 'مكافأتك جاهزة للصرف عند الكاشير' : 'Your reward is ready at the cashier'}
          {card.pending_rewards > 1 && <b>{card.pending_rewards}</b>}
        </div>
      )}
      {!!card.pending_rewards && card.balance > 0 && (
        <small className="carry-stamps">
          {ar
            ? card.balance + ' أختام محفوظة للكارت التالي'
            : card.balance + ' stamps saved for your next card'}
        </small>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {motion?.message || ''}
      </span>
      {motion && (
        <div className="card-moment" aria-hidden="true">
          {motion.message}
        </div>
      )}
    </article>
  );
}
