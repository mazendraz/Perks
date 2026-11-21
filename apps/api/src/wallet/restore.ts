import { keyedHash, safeEqual } from '../crypto.js';

// The Wallet door: the pass's "Open your card" link carries <card>.<generation>.<mac>. The mac is
// derived, never stored; using the link moves the card to the next generation, so the link that
// was used (or photographed) stops working once the updated pass arrives.
const mac = (membershipId: string, generation: number, pepper: string) =>
  keyedHash('wallet-restore:' + membershipId + ':' + generation, pepper).slice(0, 32);

export function walletRestoreToken(membershipId: string, generation: number, pepper: string) {
  return membershipId + '.' + generation + '.' + mac(membershipId, generation, pepper);
}

export function readWalletRestoreToken(token: string, pepper: string) {
  const match =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([1-9][0-9]{0,8})\.([0-9a-f]{32})$/.exec(
      token,
    );
  if (!match) return null;
  const membershipId = match[1]!,
    generation = Number(match[2]);
  return safeEqual(match[3]!, mac(membershipId, generation, pepper))
    ? { membershipId, generation }
    : null;
}

/** The pass link: opens the card here, or brings every card back on a new phone. */
export function walletOpenUrl(
  origin: string,
  card: { id: string; restore_generation?: number },
  pepper: string,
) {
  return (
    origin +
    '/customer/open?w=' +
    walletRestoreToken(card.id, card.restore_generation ?? 1, pepper)
  );
}

export function withOpenUrl<T extends { id: string; restore_generation?: number }>(
  card: T,
  origin: string,
  pepper: string,
): T & { open_url: string } {
  return { ...card, open_url: walletOpenUrl(origin, card, pepper) };
}
