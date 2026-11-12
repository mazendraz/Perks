import { StampFrame, StampSymbol } from './StampSymbol.js';
import { CardArtwork } from './CardArtwork.js';
import { templateCategory } from '../../contracts/src/branding.js';
import { memo, useId, type CSSProperties } from 'react';
import { StampInk } from './StampInk.js';
import { useCardMotion } from './useCardMotion.js';
import { Icon } from './Icon.js';
import type { CardData } from '../../contracts/src/index.js';
const StableArtwork = memo(CardArtwork);
const StampSlot = memo(function StampSlot({
  index,
  filled,
  last,
  seed,
  shape,
  symbol,
  inkStyle,
  grainId,
}: {
  index: number;
  filled: boolean;
  last: boolean;
  seed: string;
  shape: CardData['stamp_shape'];
  symbol: CardData['stamp_icon'];
  inkStyle: CardData['stamp_style'];
  grainId: string;
}) {
  return (
    <span className={filled ? 'filled' : ''} data-stamp-index={index}>
      <StampFrame shape={shape} />
      <span className="nq-ink-layer">
        <StampInk seed={seed} shape={shape} symbol={symbol} style={inkStyle} grainId={grainId} />
      </span>
      <span className="nq-ghost">
        <StampFrame shape={shape} />
      </span>
      {filled ? null : last ? (
        <Icon name="gift" size={20} />
      ) : (
        <span className="stamp-number">{String(index + 1).padStart(2, '0')}</span>
      )}
    </span>
  );
});
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
export function LoyaltyCard({
  card,
  lang = 'ar',
  waiting = false,
  reveal = false,
  experience = card.stamp_ink !== undefined,
}: {
  card: CardData;
  lang?: 'ar' | 'en';
  waiting?: boolean;
  reveal?: boolean;
  experience?: boolean;
}) {
  const threshold = Math.max(
      2,
      Math.min(50, Number.isFinite(card.threshold) ? Math.floor(card.threshold) : 5),
    ),
    balance = Math.max(0, Math.min(card.display_balance ?? card.balance, threshold));
  const motion = useCardMotion(card, balance, threshold, experience, waiting, reveal),
    displayBalance = motion.visualBalance;
  const grainId = 'nq-grain-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
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
  } as CSSProperties;
  return (
    <div
      className={'loyalty-card-shell' + (card.pending_rewards ? ' live-card' : '')}
      style={style}
    >
      <svg width="0" height="0" className="nq-ink-definitions" aria-hidden="true">
        <defs>
          <pattern id={grainId} width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r=".7" fill="#fff" />
            <circle cx="4" cy="3.5" r=".5" fill="#fff" />
            <circle cx="2.5" cy="5" r=".4" fill="#000" />
          </pattern>
        </defs>
      </svg>
      {!!card.pending_rewards && (
        <div
          className="nq-reward-banner"
          ref={motion.banner}
          style={{ opacity: motion.bannerReady ? 1 : 0 }}
        >
          <Icon name="gift" size={34} />
          <div>
            <strong>{ar ? 'مكافأتك جاهزة!' : 'Your reward is ready!'}</strong>
            <small>
              {card.reward_title}
              {card.pending_rewards > 1 ? ' · ' + card.pending_rewards : ''}
            </small>
          </div>
        </div>
      )}
      <article
        ref={motion.article}
        className={
          'loyalty-card nq-motion-card ' +
          (experience ? 'is-experience ' : '') +
          card.template +
          ' logo-' +
          (card.logo_style || 'framed') +
          (card.logo_asset_id || card.logo_url ? ' has-logo' : '') +
          ' stamp-shape-' +
          (card.stamp_shape || 'circle') +
          ' stamp-style-' +
          (card.stamp_style || 'solid')
        }
        data-stamp-icon={card.stamp_icon || 'check'}
        data-card-id={card.id}
        data-card-revision={card.revision}
        data-card-motion={motion.kind || undefined}
        style={style}
        aria-label={card.merchant_name}
      >
        <StableArtwork template={card.template} />
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
                  category === 'cafe'
                    ? 'coffee'
                    : category === 'restaurant'
                      ? 'utensils'
                      : 'scissors'
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
          style={{
            gridTemplateColumns:
              'repeat(' +
              (threshold >= 7 && threshold <= 10
                ? Math.ceil(threshold / 2)
                : Math.min(threshold, 6)) +
              ',minmax(0,1fr))',
          }}
          aria-hidden="true"
        >
          {Array.from({ length: threshold }, (_, i) => (
            <StampSlot
              key={i}
              index={i}
              filled={i < displayBalance}
              last={i === threshold - 1}
              seed={
                // Hidden slots stay stable; draw each committed mark on its impact.
                i < displayBalance && card.stamp_ink?.[i]
                  ? card.stamp_ink[i]!.ledgerId + ':' + card.stamp_ink[i]!.ordinal
                  : card.id + ':' + (card.cycle_number ?? 1) + ':' + i
              }
              shape={card.stamp_shape}
              symbol={card.stamp_icon}
              inkStyle={card.stamp_style}
              grainId={grainId}
            />
          ))}
        </div>
        <div className="card-progress-line">
          <div
            role="progressbar"
            aria-label={ar ? 'رصيد الأختام' : 'Stamp progress'}
            aria-valuemin={0}
            aria-valuemax={threshold}
            aria-valuenow={displayBalance}
            className="card-progress"
          >
            <b>{displayBalance}</b> {ar ? 'من' : 'of'} {threshold}
          </div>
          <span>
            {displayBalance === threshold
              ? ar
                ? 'مكافأتك جاهزة'
                : 'READY TO REDEEM'
              : ar
                ? 'كل زيارة بتقرّبك'
                : 'ONE VISIT CLOSER'}
          </span>
        </div>
        <div className="card-progress-track" aria-hidden="true">
          <span
            ref={motion.progress}
            style={{ '--progress-factor': displayBalance / threshold } as CSSProperties}
          />
        </div>
        <div className="card-reward-line">
          <div>
            <small>{ar ? 'المكافأة اللي جاية' : 'YOUR NEXT REWARD'}</small>
            <strong className="card-reward">{card.reward_title}</strong>
          </div>
          <span className="card-nuqta">
            PERKS <i>●</i>
          </span>
        </div>
        {!!card.pending_rewards && card.balance > 0 && (
          <small className="carry-stamps">
            {ar
              ? card.balance + ' أختام محفوظة للكارت التالي'
              : card.balance + ' stamps saved for your next card'}
          </small>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {motion.kind === 'cycle-renew'
            ? ar
              ? 'المكافأة اتصرفت. كارت جديد بدأ!'
              : 'Reward redeemed. A new card has started!'
            : motion.kind === 'reward-earned'
              ? ar
                ? 'كملت الأختام! مكافأتك جاهزة.'
                : 'Card complete! Your reward is ready.'
              : motion.kind === 'stamp-added'
                ? ar
                  ? 'اتضافت أختام جديدة لكارتك.'
                  : 'New stamps added to your card.'
                : ''}
        </span>
        <div className="nq-stamp-fx" ref={motion.layer} aria-hidden="true" />
      </article>
      {experience && waiting && (
        <p className="nq-stamp-wait" role="status">
          <span aria-hidden="true" />
          {ar ? 'الكاشير هيأكد ختمك…' : 'The cashier will confirm your stamp…'}
        </p>
      )}
    </div>
  );
}
