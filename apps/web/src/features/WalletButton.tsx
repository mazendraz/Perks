import { portalAssetUrl } from '../portals.js';
import type { Language } from '../../../../packages/contracts/src/index.js';

// Kept free of stylesheet imports so it renders under plain Node (tests/unit/wallet-badges).
export function WalletButton({
  provider,
  membershipId,
  lang,
}: {
  provider: 'apple' | 'google';
  membershipId: string;
  lang: Language;
}) {
  const name = provider === 'apple' ? 'Apple Wallet' : 'Google Wallet';
  return (
    <a
      className={'wallet-badge-button ' + provider + '-wallet-button'}
      href={portalAssetUrl('/api/v1/me/memberships/' + membershipId + '/wallet/' + provider)}
    >
      <img
        src={'/wallet/' + provider + '-add-to-wallet-' + lang + '.svg'}
        height={55}
        alt={(lang === 'ar' ? 'إضافة إلى ' : 'Add to ') + name}
      />
    </a>
  );
}
