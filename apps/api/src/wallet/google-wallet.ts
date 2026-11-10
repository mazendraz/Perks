import { createHash, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { texts, type WalletCard } from './apple-pass.js';

export const GOOGLE_STRIP_PREFIX = '/api/v1/public/wallet/google/strips';
export interface GoogleWallet {
  issuerId: string;
  clientEmail: string;
  privateKey: string;
  fetch: typeof fetch;
}
export function loadGoogleWallet(
  c: {
    GOOGLE_WALLET_ENABLED: string;
    GOOGLE_WALLET_ISSUER_ID?: string | undefined;
    GOOGLE_WALLET_SERVICE_ACCOUNT_FILE?: string | undefined;
  },
  fetchImpl: typeof fetch = fetch,
): GoogleWallet | null {
  if (c.GOOGLE_WALLET_ENABLED !== 'true') return null;
  const account = JSON.parse(readFileSync(c.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE!, 'utf8')) as {
    client_email?: string;
    private_key?: string;
  };
  if (!account.client_email || !account.private_key)
    throw new Error('Google Wallet service account file is missing client_email or private_key.');
  return {
    issuerId: c.GOOGLE_WALLET_ISSUER_ID!,
    clientEmail: account.client_email,
    privateKey: account.private_key,
    fetch: fetchImpl,
  };
}

// Changes whenever the strip art changes, so Google re-fetches the image.
export const stripVersion = (card: WalletCard) =>
  createHash('sha1')
    .update(
      JSON.stringify([
        card.threshold,
        card.display_balance,
        card.primary_color,
        card.accent_color,
        card.stamp_shape,
        card.stamp_icon,
        card.stamp_style,
      ]),
    )
    .digest('hex')
    .slice(0, 12);
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
export function signJwt(claims: Record<string, unknown>, privateKey: string) {
  const body = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64(claims);
  return body + '.' + createSign('RSA-SHA256').update(body).sign(privateKey, 'base64url');
}
const localized = (ar: string, en: string) => ({
  defaultValue: { language: 'ar', value: ar },
  translatedValues: [{ language: 'en', value: en }],
});
const hex = (value: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : fallback);
export const classId = (g: GoogleWallet, card: { merchant_id: string }) =>
  g.issuerId + '.perks-merchant-' + card.merchant_id;
export const objectId = (g: GoogleWallet, key: string) => g.issuerId + '.perks-card-' + key;

export function googleClass(
  g: GoogleWallet,
  card: WalletCard & { logo_asset_id?: string | null },
  origin: string,
) {
  const logo = card.logo_asset_id
    ? origin + '/api/v1/public/merchants/' + card.merchant_id + '/logos/' + card.logo_asset_id
    : origin + '/icons/perks-512.png';
  return {
    id: classId(g, card),
    issuerName: card.merchant_name,
    programName: card.merchant_name,
    programLogo: {
      sourceUri: { uri: logo },
      contentDescription: localized('شعار ' + card.merchant_name, card.merchant_name + ' logo'),
    },
    hexBackgroundColor: hex(card.primary_color, '#181b38'),
    countryCode: 'EG',
    reviewStatus: 'UNDER_REVIEW',
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
  };
}
export function googleObject(
  g: GoogleWallet,
  card: WalletCard & { fingerprint?: string },
  key: string,
  origin: string,
  version: string,
) {
  const t = texts(card);
  return {
    id: objectId(g, key),
    classId: classId(g, card),
    state: card.active ? 'ACTIVE' : 'INACTIVE',
    loyaltyPoints: {
      localizedLabel: localized(t.ar.stamps_label, t.en.stamps_label),
      balance: { string: `${Math.min(card.display_balance, card.threshold)}/${card.threshold}` },
    },
    heroImage: {
      sourceUri: { uri: origin + GOOGLE_STRIP_PREFIX + '/' + key + '/' + version + '.png' },
      contentDescription: localized(t.ar.stamps_label, t.en.stamps_label),
    },
    textModulesData: [
      {
        id: 'status',
        localizedHeader: localized(t.ar.status_label, t.en.status_label),
        localizedBody: localized(t.ar.status_value, t.en.status_value),
      },
      {
        id: 'reward',
        localizedHeader: localized(t.ar.reward_label, t.en.reward_label),
        body: card.reward_title,
      },
      {
        id: 'howto',
        localizedHeader: localized(t.ar.open_label, t.en.open_label),
        localizedBody: localized(t.ar.open_value, t.en.open_value),
      },
    ],
    linksModuleData: {
      uris: [
        {
          id: 'card',
          uri: origin + '/customer/' + card.id,
          localizedDescription: localized(t.ar.open_label, t.en.open_label),
        },
      ],
    },
  };
}
// "Add to Google Wallet": the signed JWT carries the class and object, so Google creates both on save.
export function saveUrl(
  g: GoogleWallet,
  card: WalletCard & { logo_asset_id?: string | null },
  key: string,
  origin: string,
  version: string,
) {
  const jwt = signJwt(
    {
      iss: g.clientEmail,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      origins: [origin],
      payload: {
        loyaltyClasses: [googleClass(g, card, origin)],
        loyaltyObjects: [googleObject(g, card, key, origin, version)],
      },
    },
    g.privateKey,
  );
  return 'https://pay.google.com/gp/v/save/' + jwt;
}

let token: { value: string; expires: number; email: string } | null = null;
export async function accessToken(g: GoogleWallet) {
  if (token && token.email === g.clientEmail && token.expires > Date.now() + 60_000)
    return token.value;
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    {
      iss: g.clientEmail,
      scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    g.privateKey,
  );
  const r = await g.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!r.ok) throw new Error('Google Wallet token request failed: ' + r.status);
  const body = (await r.json()) as { access_token: string; expires_in: number };
  token = {
    value: body.access_token,
    expires: Date.now() + body.expires_in * 1000,
    email: g.clientEmail,
  };
  return token.value;
}
const api = 'https://walletobjects.googleapis.com/walletobjects/v1';
// PATCH; 404 means the customer never saved the card, which is normal and not an error.
export async function patchGoogle(
  g: GoogleWallet,
  kind: 'loyaltyClass' | 'loyaltyObject',
  id: string,
  body: Record<string, unknown>,
) {
  const r = await g.fetch(api + '/' + kind + '/' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: {
      authorization: 'Bearer ' + (await accessToken(g)),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return r.status;
}
