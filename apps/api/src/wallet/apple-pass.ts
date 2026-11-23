import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import forge from 'node-forge';
import sharp from 'sharp';
import type {
  CardTemplate,
  LogoMarkPosition,
  StampIcon,
  StampShape,
} from '../../../../packages/contracts/src/branding.js';
import { appleStripSvg, posterArtworkSvg, type ArtworkLogo } from './pass-artwork.js';
import { contrast, mix, walletTheme } from '../../../../packages/domain/src/wallet-theme.js';
import { categoryEditions, templateCategory } from '../../../../packages/contracts/src/branding.js';
import { walletReminderText } from '../../../../packages/contracts/src/customer-reminders.js';
import { fillWalletMessage } from '../../../../packages/contracts/src/owner-plan.js';
export { inkFor, stripSvg } from './pass-artwork.js';
import { APPLE_SERVICE_PREFIX } from './constants.js';
import { perksIconSvg } from '../../../../packages/domain/src/brand.js';

export interface WalletCard {
  card_number?: string;
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
  surface_color?: string;
  template?: CardTemplate;
  /** "Your logo" edition: where the large logo sits and how much runs past the edge. */
  logo_mark_position?: LogoMarkPosition;
  logo_mark_bleed?: number;
  stamp_shape: StampShape;
  stamp_icon: StampIcon;
  stamp_style: 'solid' | 'outline';
  reward_title: string;
  reward_terms: string;
  active: boolean;
  earning_active: boolean;
  /** The shop's Wallet reminder templates while a reminder is being delivered to this card. */
  reminder_templates?: {
    wallet: { ar: string; en: string };
    walletReady?: { ar: string; en: string } | null;
    /** Place in a reminder series; present from the second reminder of one absence. */
    step?: number;
  } | null;
  /**
   * A message the shop sent by hand, while it is being delivered to this card. `repeat`: the same
   * words already reached this card before.
   */
  manual_message?: { id: string; ar: string; en: string; repeat?: boolean } | null;
  /** Generation of the Wallet restore key (048); it moves on each time the link is used. */
  restore_generation?: number;
  /** The pass link with its restore key (wallet/restore.ts); absent in design previews. */
  open_url?: string;
}
// The link text hides the key, so a photo of the back of the card does not give it away.
const openLink = (card: WalletCard, text: string) =>
  card.open_url ? `<a href="${escapeXml(card.open_url)}">${escapeXml(text)}</a>` : undefined;
// Lock-screen line the first time a restore link is used (and on each use after that).
const securityKey = (card: WalletCard) => 'security_' + (card.restore_generation ?? 1);
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

const rgb = (value: string) => {
  const n = parseInt(value.slice(1), 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
};
const escapeXml = (s: string) => s.replace(/[<>&"']/g, (ch) => '&#' + ch.charCodeAt(0) + ';');

const arStamps = (n: number) =>
  n === 1 ? 'ختم واحد' : n === 2 ? 'ختمين' : n <= 10 ? `${n} أختام` : `${n} ختم`;
// The reminder is written for this customer: stamps left, or the reward waiting for them.
// A manual message from the shop takes the same place on the back of the pass; the newer one
// of the two is the only one in the card (wallet_card_json picks it).
const reminderTexts = (card: WalletCard) =>
  !card.active
    ? null
    : card.manual_message
      ? {
          ar: fillWalletMessage(
            card.manual_message.ar,
            card.customer_name ?? '',
            card.merchant_name,
          ),
          en: fillWalletMessage(
            card.manual_message.en,
            card.customer_name ?? '',
            card.merchant_name,
          ),
        }
      : card.reminder_templates
        ? {
            ar: walletReminderText(card.reminder_templates, card, 'ar'),
            en: walletReminderText(card.reminder_templates, card, 'en'),
          }
        : null;
// Wallet announces the reminder field only when its value changes. The value is a hash of the
// text, so the same words again (a later reminder in a series, or a message the shop repeats) would
// be silent. Those carry a nonce; every other card keeps the hash it always had.
const reminderNonce = (card: WalletCard) =>
  card.manual_message
    ? card.manual_message.repeat
      ? card.manual_message.id
      : null
    : (card.reminder_templates?.step ?? 1) > 1
      ? 'step' + card.reminder_templates!.step
      : null;
const reminderKey = (card: WalletCard) => {
  const words = reminderTexts(card);
  if (!words) return '';
  const nonce = reminderNonce(card);
  return (
    'reminder_' +
    createHash('sha256')
      .update(JSON.stringify(nonce ? [words, nonce] : words))
      .digest('hex')
      .slice(0, 24)
  );
};
const editionLabels = categoryEditions;
export function texts(card: WalletCard) {
  const edition = editionLabels[templateCategory(card.template ?? 'classic')];
  const editionPair = [edition.ar, edition.en] as const;
  const left = Math.max(0, card.threshold - card.display_balance),
    ready = card.pending_rewards > 0;
  return {
    ar: {
      stamps_label: 'الأختام',
      stamp_change: 'الأختام: %@',
      edition_value: editionPair[0],
      reward_label: 'المكافأة',
      member_label: 'باسم',
      member_value: 'عميل Perks',
      left_label: ready ? 'مكافأتك' : 'فاضل',
      left_value: !card.active ? 'مقفول' : ready ? 'جاهزة 🎁' : arStamps(left),
      // The status announces itself (changeMessage), so it changes only when the card's state
      // does: reward ready or card closed. The countdown is a separate, silent field, or every
      // stamp would ping "1 stamp to go" while the customer is still at the till.
      status_label: 'حالة الكارت',
      status_value: !card.active
        ? 'الكارت ده اتقفل'
        : ready
          ? 'مكافأتك جاهزة! اطلبها من الكاشير'
          : 'كارتك شغال: كل زيارة بختم',
      status_change: '%@',
      progress_label: 'فاضلك',
      progress_value: !card.active
        ? 'الكارت ده اتقفل'
        : ready
          ? 'مكافأتك جاهزة'
          : `باقي ${arStamps(left)} على المكافأة`,
      reminder_label: 'رسالة من المحل',
      ...(reminderKey(card) ? { [reminderKey(card)]: reminderTexts(card)!.ar } : {}),
      open_label: 'افتح الكارت',
      open_value: 'علشان تاخد ختم، افتح كارتك واعرض الكود للكاشير',
      ...(card.open_url
        ? {
            open_link: openLink(card, 'افتح كارتك ←')!,
            security_label: 'لو غيّرت موبايلك',
            [securityKey(card)]:
              (card.restore_generation ?? 1) > 1
                ? 'كروتك اتفتحت على موبايل جديد. لو مش إنت، شيله من صفحة الكارت.'
                : 'دوس «افتح كارتك» من هنا، وكل كروتك هترجع على الموبايل الجديد.',
          }
        : {}),
      terms_label: 'الشروط',
      about_label: 'عن Perks',
      about_value: 'كارت الولاء بتاعك على موبايلك. الكارت ده بيتحدث لوحده بعد كل ختم.',
    },
    en: {
      stamps_label: 'Stamps',
      stamp_change: 'Stamps: %@',
      edition_value: editionPair[1],
      reward_label: 'Reward',
      member_label: 'Member',
      member_value: 'Perks member',
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
          : 'Your card is active: every visit earns a stamp',
      status_change: '%@',
      progress_label: 'To go',
      progress_value: !card.active
        ? 'This card is closed'
        : ready
          ? 'Your reward is ready'
          : `${left} ${left === 1 ? 'stamp' : 'stamps'} to your reward`,
      reminder_label: 'A message from the business',
      ...(reminderKey(card) ? { [reminderKey(card)]: reminderTexts(card)!.en } : {}),
      open_label: 'Open your card',
      open_value: 'To get a stamp, open your card and show the code to the cashier',
      ...(card.open_url
        ? {
            open_link: openLink(card, 'Open your card →')!,
            security_label: 'If you change phones',
            [securityKey(card)]:
              (card.restore_generation ?? 1) > 1
                ? 'Your cards were opened on a new phone. If this wasn’t you, remove it from the card page.'
                : 'Tap “Open your card” here and all your cards come back on the new phone.',
          }
        : {}),
      terms_label: 'Terms',
      about_label: 'About Perks',
      about_value: 'Your loyalty card on your phone. This card updates itself after every stamp.',
    },
  };
}
/**
 * The language the shop wrote its program in: Arabic when the program's own words are mostly
 * Arabic letters. The pass shows every label in this language, whatever the phone's language,
 * so an Arabic card never mixes in English captions.
 */
export function programLanguage(
  card: Pick<WalletCard, 'program_name' | 'reward_title' | 'reward_terms'>,
): 'ar' | 'en' {
  const text = [card.program_name, card.reward_title, card.reward_terms].join(' '),
    arabic = (text.match(/[؀-ۿݐ-ݿ]/g) ?? []).length,
    latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return latin > arabic ? 'en' : 'ar';
}
const REWARD_FIELD_MAX = 30;
/** The reward for the card face: about 30 characters, cut at a word. The full title is on the back. */
export function shortReward(title: string, max = REWARD_FIELD_MAX) {
  const chars = Array.from(title.trim());
  if (chars.length <= max) return title.trim();
  const cut = chars.slice(0, max - 1).join(''),
    space = cut.lastIndexOf(' ');
  return (space >= max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…';
}
// A shop name longer than this does not fit beside a logo and the stamps count.
const LOGO_TEXT_MAX = 18;
/**
 * A caption colour that reads on the card: the theme's own when it has enough contrast,
 * otherwise the text colour faded only as much as still reads.
 */
export function readableLabel(theme: { background: string; ink: string; label: string }) {
  if (contrast(theme.label, theme.background) >= 4.5) return theme.label;
  for (const amount of [0.25, 0.2, 0.15, 0.1, 0.05]) {
    const label = mix(theme.ink, theme.background, amount);
    if (contrast(label, theme.background) >= 4.5) return label;
  }
  return theme.ink;
}
const stringsEscape = (value: string) =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t');
const stringsFile = (entries: Record<string, string>) =>
  Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(
      Object.entries(entries)
        .map(([k, v]) => `"${stringsEscape(k)}" = "${stringsEscape(v)}";\n`)
        .join(''),
      'utf16le',
    ),
  ]);

export function passJson(
  card: WalletCard,
  options: {
    serial: string;
    authToken: string;
    origin: string;
    signer: AppleWalletSigner;
    /** The shop's logo already spells its name, so the name is not repeated beside it. */
    wordmark?: boolean;
    /** The pass carries the shop logo (a long name is then left out of the logo row). */
    logo?: boolean;
  },
) {
  // Colours come from the shop's card edition (template), the same as the web card.
  const theme = walletTheme(card),
    cardUrl = options.origin + '/customer/' + card.id + '?wallet=1',
    // Beside the logo, a long name would run into the stamps count: the logo alone says it.
    showName =
      !options.wordmark && !(options.logo && Array.from(card.merchant_name).length > LOGO_TEXT_MAX);
  // Shared by both layouts. iOS 27 shows the poster and only announces changes to fields the
  // poster itself has: without these, shop messages and reminders made no banner there.
  const backFields = [
    // Always present, even empty: Wallet announces a reminder (changeMessage) only when an
    // existing field changes value, not when a field first appears.
    {
      key: 'reminder',
      label: 'reminder_label',
      value: reminderKey(card),
      changeMessage: '%@',
    },
    { key: 'reward_full', label: 'reward_label', value: card.reward_title },
    // No changeMessage: a new stamp must not announce the countdown (see status_value).
    { key: 'progress', label: 'progress_label', value: 'progress_value' },
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
    card.open_url
      ? // Localized: the strings file holds the link, so its key stays out of pass.json text.
        { key: 'open', label: 'open_label', value: 'open_value', attributedValue: 'open_link' }
      : {
          key: 'open',
          label: 'open_label',
          value: 'open_value',
          attributedValue: `<a href="${escapeXml(cardUrl)}">${escapeXml(cardUrl)}</a>`,
        },
    ...(card.open_url
      ? [
          {
            key: 'security',
            label: 'security_label',
            value: securityKey(card),
            changeMessage: '%@',
          },
        ]
      : []),
    ...(card.reward_terms
      ? [{ key: 'terms', label: 'terms_label', value: card.reward_terms }]
      : []),
    { key: 'about', label: 'about_label', value: 'about_value' },
  ];
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
    ...(showName ? { logoText: card.merchant_name } : {}),
    backgroundColor: rgb(theme.background),
    foregroundColor: rgb(theme.ink),
    labelColor: rgb(readableLabel(theme)),
    // No barcode: the pass is a card face. Stamping uses the live code on the web card.
    sharingProhibited: true,
    ...(card.active ? {} : { voided: true }),
    // iOS 27+: the whole card face is the shop's edition (artwork.png). Wallet picks this style
    // when it knows it; iOS 26 and earlier fall back to the storeCard below, whose strip is the
    // same card face in the strip shape (Apple has no way to show the poster before iOS 27).
    footerBackgroundColor: rgb(mix(theme.background, theme.ink, 0.08)),
    posterGeneric: {
      headerFields: [
        {
          key: 'stamps',
          label: 'stamps_label',
          value: `${Math.min(card.display_balance, card.threshold)}/${card.threshold}`,
          changeMessage: 'stamp_change',
        },
      ],
      primaryFields: [
        // An empty label makes the first primary field the large title.
        // Centred, so the reward lines sit away from the card edges.
        {
          key: 'reward',
          label: '',
          value: card.reward_title,
          textAlignment: 'PKTextAlignmentCenter',
        },
        {
          key: 'left',
          label: 'left_label',
          value: 'left_value',
          textAlignment: 'PKTextAlignmentCenter',
        },
      ],
      footerFields: [
        {
          key: 'edition',
          label: '',
          value: 'edition_value',
          textAlignment: 'PKTextAlignmentCenter',
        },
      ],
      backFields,
    },
    storeCard: {
      headerFields: [
        {
          key: 'stamps',
          label: 'stamps_label',
          value: `${Math.min(card.display_balance, card.threshold)}/${card.threshold}`,
          textAlignment: 'PKTextAlignmentRight',
          changeMessage: 'stamp_change',
        },
      ],
      // One line on the card face; the full reward is the first thing on the back.
      secondaryFields: [
        { key: 'reward', label: 'reward_label', value: shortReward(card.reward_title) },
      ],
      auxiliaryFields: [
        {
          key: 'left',
          label: 'left_label',
          value: 'left_value',
          textAlignment: 'PKTextAlignmentRight',
        },
      ],
      backFields,
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
// Logos wider than this are wordmarks: they already carry the shop's name.
const WORDMARK_RATIO = 1.3;
const logoSizes = [
  ['logo.png', 50],
  ['logo@2x.png', 100],
  ['logo@3x.png', 150],
] as const;
// Wallet shows the logo at up to 160×50 points beside the shop name. A square logo is drawn
// as a rounded tile (so a white logo background reads as an app-icon, not a pasted box);
// a wide wordmark keeps its own shape.
/** The logo without the empty margins around it, so it fills its slot. */
export async function trimmedLogo(source: Buffer) {
  try {
    return await sharp(source).trim({ threshold: 12 }).png().toBuffer();
  } catch {
    // A logo with no margins (or a single colour) cannot be trimmed; use it as it is.
    return source;
  }
}
// Wallet shows the logo at up to 160×50 points beside the shop name. The logo is placed exactly
// as the shop uploaded it: no tile, frame or background is added behind it.
export async function walletLogo(source: Buffer, h: number, maxWidth = Math.round(h * 3)) {
  const logo = await trimmedLogo(source),
    meta = await sharp(logo).metadata(),
    ratio = (meta.width || 1) / (meta.height || 1),
    inner = Math.round(h * 0.84),
    pad = h - inner;
  return sharp(logo)
    .resize({ height: inner, width: maxWidth, fit: 'inside' })
    .extend({
      top: Math.ceil(pad / 2),
      bottom: Math.floor(pad / 2),
      // A square logo sits beside the shop name: leave a little space before the text.
      right: ratio > WORDMARK_RATIO ? 0 : Math.round(pad / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}
/** The shop logo for drawing inside the card artwork, as uploaded, with no margins. */
export async function artworkLogo(source: Buffer): Promise<ArtworkLogo> {
  const png = await sharp(await trimmedLogo(source))
    .resize({ height: 240, width: 960, fit: 'inside' })
    .png()
    .toBuffer();
  const out = await sharp(png).metadata();
  return {
    href: 'data:image/png;base64,' + png.toString('base64'),
    width: out.width || 240,
    height: out.height || 240,
  };
}
/**
 * The poster logo with clear space on the card-edge side, so the logo does not sit tight
 * against the edge. Wallet places the image; this is the only margin we control.
 */
export async function posterLogo(source: Buffer, h: number, rtl: boolean) {
  const edge = Math.round(h * 0.3),
    // The poster slot is 30 points tall and up to 126 wide (4.2×): a wordmark may use it all.
    logo = await walletLogo(source, h, Math.round(h * 4.2) - edge);
  return sharp(logo)
    .extend({
      left: rtl ? 0 : edge,
      right: rtl ? edge : 0,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}
interface LogoAssets {
  wordmark: boolean;
  artwork: ArtworkLogo;
  files: [string, Buffer][];
}
// The logo files depend only on the shop's logo, not on the card, so each logo is processed once
// and reused for every pass of that shop. This was most of the work of building a pass.
const LOGO_CACHE_SIZE = 300;
const logoCache = new Map<string, Promise<LogoAssets>>();
async function makeLogoAssets(source: Buffer): Promise<LogoAssets> {
  const meta = await sharp(await trimmedLogo(source)).metadata();
  const files: [string, Buffer][] = [];
  for (const [name, h] of logoSizes) files.push([name, await walletLogo(source, h)]);
  // The poster's logo slot is 30 points tall (up to 126 wide). Arabic puts it on the right.
  for (const scale of [1, 2, 3]) {
    const name = `primaryLogo${scale > 1 ? '@' + scale + 'x' : ''}.png`;
    files.push(
      [name, await posterLogo(source, 30 * scale, false)],
      ['ar.lproj/' + name, await posterLogo(source, 30 * scale, true)],
    );
  }
  return {
    wordmark: (meta.width || 1) / (meta.height || 1) > WORDMARK_RATIO,
    artwork: await artworkLogo(source),
    files,
  };
}
export function logoAssets(source: Buffer) {
  const key = createHash('sha256').update(source).digest('hex');
  let entry = logoCache.get(key);
  if (entry) {
    // Most recently used last, so the oldest logo is the one dropped.
    logoCache.delete(key);
    logoCache.set(key, entry);
    return entry;
  }
  entry = makeLogoAssets(source);
  entry.catch(() => logoCache.delete(key));
  logoCache.set(key, entry);
  if (logoCache.size > LOGO_CACHE_SIZE) logoCache.delete(logoCache.keys().next().value!);
  return entry;
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
  const logo = options.logo ? await logoAssets(options.logo) : null,
    wordmark = !!logo?.wordmark;
  // The logo, drawn inside the artwork: large at the top, or as the faint background of the
  // "Your logo" edition (then not repeated at the top).
  const inArt = logo?.artwork ?? null,
    logoEdition = walletTheme(card).art.kind === 'logo',
    art = { logo: logoEdition ? null : inArt, watermark: logoEdition ? inArt : null };
  // The card speaks the program's language on every phone (labels, values and stamp direction).
  const lang = programLanguage(card),
    rtl = lang === 'ar';
  // iOS 26 and earlier cannot show the poster: they get a strip drawn for the strip shape, with
  // the shop logo, stamps and progress line.
  const strips: [string, Buffer][] = [];
  for (const scale of [1, 2, 3])
    strips.push([
      `strip${scale > 1 ? '@' + scale + 'x' : ''}.png`,
      await png(appleStripSvg(card, scale, rtl, inArt), 375 * scale, 144 * scale),
    ]);
  const files: [string, Buffer][] = [
    [
      'pass.json',
      Buffer.from(JSON.stringify(passJson(card, { ...options, wordmark, logo: !!logo }))),
    ],
    ['icon.png', await png(appIcon, 38)],
    ['icon@2x.png', await png(appIcon, 76)],
    ['icon@3x.png', await png(appIcon, 114)],
    ...strips,
  ];
  // The logo slot Wallet gives a poster is only 30 points tall, so the logo is also drawn large
  // inside the artwork, where people actually see it.
  for (const scale of [1, 2, 3]) {
    const suffix = scale > 1 ? '@' + scale + 'x' : '';
    files.push(
      [
        `artwork${suffix}.png`,
        await png(posterArtworkSvg(card, scale, false, art), 358 * scale, 448 * scale),
      ],
      [
        `ar.lproj/artwork${suffix}.png`,
        await png(posterArtworkSvg(card, scale, true, art), 358 * scale, 448 * scale),
      ],
    );
  }
  if (logo) files.push(...logo.files);
  // Every phone language gets the program's strip and words: an Arabic phone looks in ar.lproj
  // first, so it gets the same strip as the base one, never a strip in the other direction.
  for (const [name, data] of strips) files.push(['ar.lproj/' + name, data]);
  const words = stringsFile(texts(card)[lang]);
  files.push(['ar.lproj/pass.strings', words], ['en.lproj/pass.strings', words]);
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
