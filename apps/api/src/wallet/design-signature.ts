import { createHash } from 'node:crypto';
import { passJson, texts, type AppleWalletSigner, type WalletCard } from './apple-pass.js';
import { googleClass, googleObject, type GoogleWallet } from './google-wallet.js';
import { artworkSignature } from './pass-artwork.js';

let cache: string | null = null;
/**
 * A fingerprint of the whole Wallet design as this build draws it: the artwork (every edition) and
 * the fields, labels and layout keys of the Apple pass and the Google card. When a deploy changes
 * any of it, the worker re-sends every saved card once (wallet_design_sync), so customers see the
 * new design without removing and re-adding their card.
 */
export function walletDesignSignature() {
  if (cache) return cache;
  const card: WalletCard & { logo_asset_id?: string | null } = {
    id: '00000000-0000-4000-8000-00000000d351',
    merchant_id: '00000000-0000-4000-8000-00000000d352',
    merchant_name: 'Perks',
    customer_name: 'Perks',
    card_number: '012345',
    program_name: 'Perks',
    threshold: 8,
    display_balance: 3,
    pending_rewards: 0,
    primary_color: '#204E43',
    accent_color: '#D4B56A',
    template: 'classic',
    stamp_shape: 'seal',
    stamp_icon: 'coffee',
    stamp_style: 'solid',
    reward_title: 'Perks',
    reward_terms: 'Perks',
    active: true,
    earning_active: true,
    logo_asset_id: '00000000-0000-4000-8000-00000000d353',
  };
  const signer = { passTypeIdentifier: 'pass', teamIdentifier: 'team' } as AppleWalletSigner;
  const google = { issuerId: 'issuer' } as GoogleWallet;
  const origin = 'https://perks.example';
  cache = createHash('sha256')
    .update(artworkSignature())
    .update(
      JSON.stringify([
        texts(card),
        passJson(card, { serial: 's', authToken: 't', origin, signer }),
        passJson(card, { serial: 's', authToken: 't', origin, signer, wordmark: true }),
        googleClass(google, card, origin),
        googleObject(google, card, 'k', origin, 'v'),
      ]),
    )
    .digest('hex')
    .slice(0, 16);
  return cache;
}
