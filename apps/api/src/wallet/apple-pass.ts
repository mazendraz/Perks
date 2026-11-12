import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import forge from 'node-forge';
import sharp from 'sharp';
import type {
  CardTemplate,
  StampIcon,
  StampShape,
} from '../../../../packages/contracts/src/branding.js';
import { inkFor, mix, stripSvg } from './pass-artwork.js';
export { inkFor, stripSvg } from './pass-artwork.js';
import { APPLE_SERVICE_PREFIX } from './constants.js';
import { perksIconSvg } from '../../../../packages/domain/src/brand.js';

export interface WalletCard {
  id: string;
  merchant_id: string;
  merchant_name: string;
  customer_name?: string;
  program_name: string;
  threshold: number;
  display_balance: number;
  pending_rewards: number;
  primary_color: string;
  accent_color: string;
  template?: CardTemplate;
  stamp_shape: StampShape;
  stamp_icon: StampIcon;
  stamp_style: 'solid' | 'outline';
  reward_title: string;
  reward_terms: string;
  active: boolean;
  earning_active: boolean;
}
export interface AppleWalletSigner {
  passTypeIdentifier: string;
  teamIdentifier: string;
  certificate: forge.pki.Certificate;
  key: forge.pki.PrivateKey;
  wwdr: forge.pki.Certificate;
}

function readCertificate(path: string) {
  const raw = readFileSync(path);
  const text = raw.toString('latin1');
  return text.includes('-----BEGIN CERTIFICATE-----')
    ? forge.pki.certificateFromPem(text)
    : forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(text)));
}
export function loadAppleSigner(c: {
  APPLE_WALLET_ENABLED: string;
  APPLE_PASS_TYPE_ID?: string | undefined;
  APPLE_TEAM_ID?: string | undefined;
  APPLE_PASS_CERT_FILE?: string | undefined;
  APPLE_PASS_KEY_FILE?: string | undefined;
  APPLE_PASS_KEY_PASSPHRASE?: string | undefined;
  APPLE_WWDR_CERT_FILE?: string | undefined;
}): AppleWalletSigner | null {
  if (c.APPLE_WALLET_ENABLED !== 'true') return null;
  const keyPem = readFileSync(c.APPLE_PASS_KEY_FILE!, 'utf8');
  const key = c.APPLE_PASS_KEY_PASSPHRASE
    ? forge.pki.decryptRsaPrivateKey(keyPem, c.APPLE_PASS_KEY_PASSPHRASE)
    : forge.pki.privateKeyFromPem(keyPem);
  if (!key) throw new Error('Apple Wallet signing key could not be read.');
  const certificate = readCertificate(c.APPLE_PASS_CERT_FILE!);
  const uid = certificate.subject.attributes.find(
    (a) => a.type === '0.9.2342.19200300.100.1.1',
  )?.value;
  if (uid && uid !== c.APPLE_PASS_TYPE_ID)
    throw new Error('Apple pass certificate does not match APPLE_PASS_TYPE_ID.');
  const publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
  if (publicKey.n.compareTo((key as forge.pki.rsa.PrivateKey).n) !== 0)
    throw new Error('Apple pass certificate does not match the signing key.');
  return {
    passTypeIdentifier: c.APPLE_PASS_TYPE_ID!,
    teamIdentifier: c.APPLE_TEAM_ID!,
    certificate,
    key,
    wwdr: readCertificate(c.APPLE_WWDR_CERT_FILE!),
  };
}
// Stable per serial, so every installed copy of the pass keeps working after a re-download.
export function passAuthToken(serial: string, pepper: string) {
  return createHmac('sha256', pepper)
    .update('apple-wallet-pass:' + serial)
    .digest('base64url');
}

const hex = (value: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : fallback);
const rgb = (value: string) => {
  const n = parseInt(value.slice(1), 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
};
const escapeXml = (s: string) => s.replace(/[<>&"']/g, (ch) => '&#' + ch.charCodeAt(0) + ';');

const arStamps = (n: number) =>
  n === 1 ? 'ختم واحد' : n === 2 ? 'ختمين' : n <= 10 ? `${n} أختام` : `${n} ختم`;
export function texts(card: WalletCard) {
  const left = Math.max(0, card.threshold - card.display_balance),
    ready = card.pending_rewards > 0;
  return {
    ar: {
      stamps_label: 'الأختام',
      reward_label: 'المكافأة',
      member_label: 'باسم',
      member_value: 'عميل Perks',
      qr_hint: 'امسح الكود يفتح كارتك',
      left_label: ready ? 'مكافأتك' : 'فاضل',
      left_value: !card.active ? 'مقفول' : ready ? 'جاهزة 🎁' : arStamps(left),
      status_label: 'حالة الكارت',
      status_value: !card.active
        ? 'الكارت ده اتقفل'
        : ready
          ? 'مكافأتك جاهزة! اطلبها من الكاشير'
          : `باقي ${arStamps(left)} على المكافأة`,
      status_change: '%@',
      open_label: 'افتح الكارت',
      open_value: 'علشان تاخد ختم، افتح كارتك واعرض الكود للكاشير',
      terms_label: 'الشروط',
      about_label: 'عن Perks',
      about_value: 'كارت الولاء بتاعك على موبايلك. الكارت ده بيتحدث لوحده بعد كل ختم.',
    },
    en: {
      stamps_label: 'Stamps',
      reward_label: 'Reward',
      member_label: 'Member',
      member_value: 'Perks member',
      qr_hint: 'Scan to open your card',
      left_label: ready ? 'Your reward' : 'To go',
      left_value: !card.active
        ? 'Closed'
        : ready
          ? 'Ready 🎁'
          : `${left} ${left === 1 ? 'stamp' : 'stamps'}`,
      status_label: 'Card status',
      status_value: !card.active
        ? 'This card is closed'
        : ready
          ? 'Your reward is ready! Ask the cashier'
          : `${left} ${left === 1 ? 'stamp' : 'stamps'} to your reward`,
      status_change: '%@',
      open_label: 'Open your card',
      open_value: 'To get a stamp, open your card and show the code to the cashier',
      terms_label: 'Terms',
      about_label: 'About Perks',
      about_value: 'Your loyalty card on your phone. This card updates itself after every stamp.',
    },
  };
}
const stringsFile = (entries: Record<string, string>) =>
  Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(
      Object.entries(entries)
        .map(([k, v]) => `"${k}" = "${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}";\n`)
        .join(''),
      'utf16le',
    ),
  ]);

export function passJson(
  card: WalletCard,
  options: { serial: string; authToken: string; origin: string; signer: AppleWalletSigner },
) {
  const bg = hex(card.primary_color, '#181b38'),
    ink = inkFor(bg),
    cardUrl = options.origin + '/customer/' + card.id + '?wallet=1';
  return {
    formatVersion: 1,
    passTypeIdentifier: options.signer.passTypeIdentifier,
    teamIdentifier: options.signer.teamIdentifier,
    serialNumber: options.serial,
    // Apple only calls HTTPS web services; a local http:// pass is a static snapshot.
    ...(options.origin.startsWith('https://')
      ? {
          authenticationToken: options.authToken,
          webServiceURL: options.origin + APPLE_SERVICE_PREFIX,
        }
      : {}),
    organizationName: card.merchant_name,
    description: card.merchant_name + ' · Perks',
    logoText: card.merchant_name,
    backgroundColor: rgb(bg),
    foregroundColor: rgb(ink),
    // Labels sit between the ink and the card colour so they read as quiet captions.
    labelColor: rgb(mix(ink, bg, ink === '#ffffff' ? 0.36 : 0.3)),
    sharingProhibited: true,
    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message: cardUrl,
        messageEncoding: 'iso-8859-1',
        altText: 'qr_hint',
      },
    ],
    ...(card.active ? {} : { voided: true }),
    storeCard: {
      headerFields: [
        {
          key: 'stamps',
          label: 'stamps_label',
          value: `${Math.min(card.display_balance, card.threshold)}/${card.threshold}`,
          textAlignment: 'PKTextAlignmentRight',
        },
      ],
      secondaryFields: [{ key: 'reward', label: 'reward_label', value: card.reward_title }],
      auxiliaryFields: [
        {
          key: 'left',
          label: 'left_label',
          value: 'left_value',
          textAlignment: 'PKTextAlignmentRight',
        },
      ],
      backFields: [
        {
          key: 'member',
          label: 'member_label',
          value: card.active && card.customer_name ? card.customer_name : 'member_value',
        },
        {
          key: 'status',
          label: 'status_label',
          value: 'status_value',
          changeMessage: 'status_change',
        },
        {
          key: 'open',
          label: 'open_label',
          value: 'open_value',
          attributedValue: `<a href="${escapeXml(cardUrl)}">${escapeXml(cardUrl)}</a>`,
        },
        ...(card.reward_terms
          ? [{ key: 'terms', label: 'terms_label', value: card.reward_terms }]
          : []),
        { key: 'about', label: 'about_label', value: 'about_value' },
      ],
    },
  };
}

// Minimal STORE-only ZIP: a .pkpass is a flat archive of small files.
export function zip(files: [string, Buffer][]) {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const fileName = Buffer.from(name, 'utf8'),
      crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0x00210000, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    locals.push(local, fileName, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(0x00210000, 12);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(fileName.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, fileName);
    offset += 30 + fileName.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
export function signManifest(manifest: Buffer, signer: AppleWalletSigner) {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest.toString('binary'));
  p7.addCertificate(signer.certificate);
  p7.addCertificate(signer.wwdr);
  p7.addSigner({
    key: signer.key as forge.pki.rsa.PrivateKey,
    certificate: signer.certificate,
    digestAlgorithm: forge.pki.oids.sha256!,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType!, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest! },
      { type: forge.pki.oids.signingTime!, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}

async function png(svg: string | Buffer, width: number, height?: number) {
  return sharp(Buffer.isBuffer(svg) ? svg : Buffer.from(svg))
    .resize(width, height ?? width, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}
const logoSizes = [
  ['logo.png', 50],
  ['logo@2x.png', 100],
  ['logo@3x.png', 150],
] as const;
// Wallet shows the logo at up to 160×50 points beside the shop name. A square logo is drawn
// as a rounded tile (so a white logo background reads as an app-icon, not a pasted box);
// a wide wordmark keeps its own shape.
export async function walletLogo(source: Buffer, h: number) {
  const meta = await sharp(source).metadata(),
    ratio = (meta.width || 1) / (meta.height || 1),
    inner = Math.round(h * 0.84),
    pad = h - inner;
  if (ratio > 1.3)
    return sharp(source)
      .resize({ height: inner, width: Math.round(h * 3), fit: 'inside' })
      .extend({
        top: Math.ceil(pad / 2),
        bottom: Math.floor(pad / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
  const tile = await sharp(source)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toBuffer();
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><rect width="${inner}" height="${inner}" rx="${(inner * 0.24).toFixed(1)}"/></svg>`,
  );
  return sharp(tile)
    .composite([{ input: mask, blend: 'dest-in' }])
    .extend({
      top: Math.ceil(pad / 2),
      bottom: Math.floor(pad / 2),
      left: 0,
      right: Math.round(pad / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}
export async function buildPkpass(
  card: WalletCard,
  options: {
    serial: string;
    authToken: string;
    origin: string;
    signer: AppleWalletSigner;
    logo?: Buffer | null;
  },
) {
  const appIcon = Buffer.from(perksIconSvg({ rounded: false, maskable: false }));
  const files: [string, Buffer][] = [
    ['pass.json', Buffer.from(JSON.stringify(passJson(card, options)))],
    ['icon.png', await png(appIcon, 29)],
    ['icon@2x.png', await png(appIcon, 58)],
    ['icon@3x.png', await png(appIcon, 87)],
    ['strip.png', await png(stripSvg(card, 1), 375, 144)],
    ['strip@2x.png', await png(stripSvg(card, 2), 750, 288)],
    ['strip@3x.png', await png(stripSvg(card, 3), 1125, 432)],
  ];
  if (options.logo) for (const [name, h] of logoSizes) files.push([name, await walletLogo(options.logo, h)]);
  const t = texts(card);
  // Arabic phones fill the stamps from the right, like the Arabic web card.
  for (const scale of [1, 2, 3])
    files.push([
      `ar.lproj/strip${scale > 1 ? '@' + scale + 'x' : ''}.png`,
      await png(stripSvg(card, scale, 144, true), 375 * scale, 144 * scale),
    ]);
  files.push(
    ['ar.lproj/pass.strings', stringsFile(t.ar)],
    ['en.lproj/pass.strings', stringsFile(t.en)],
  );
  const manifest = Buffer.from(
    JSON.stringify(
      Object.fromEntries(
        files.map(([name, data]) => [name, createHash('sha1').update(data).digest('hex')]),
      ),
    ),
  );
  files.push(['manifest.json', manifest], ['signature', signManifest(manifest, options.signer)]);
  return zip(files);
}
