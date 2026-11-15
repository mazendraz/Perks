import type { TemplateCategory } from '../../contracts/src/branding.js';
// Line artwork behind every card, drawn in a 600×420 box. Shared by the web card and Wallet.
export const cardArtMarkup: Record<TemplateCategory, string> = {
  cafe: '<ellipse cx="485" cy="270" rx="100" ry="132" transform="rotate(32 485 270)"/><path d="M440 158c100 85-3 137 90 223M394 122c-18-52 48-58 27-109M438 112c-18-52 48-58 27-109M-30 380C110 260 205 460 400 378M-30 397C110 277 205 477 400 395"/><circle cx="490" cy="270" r="165" stroke-dasharray="2 10"/>',
  restaurant:
    '<circle cx="480" cy="255" r="164"/><circle cx="480" cy="255" r="141"/><circle cx="480" cy="255" r="121" stroke-dasharray="1 9"/><path d="M265 75v100m18-100v100m18-100v100m-36-38h36m-36 38q18 35 36 0m-18 20v150M578 68c-24 50-30 98-30 131h30m0-131v285M-20 367h330M-20 380h330"/>',
  barber:
    '<path d="M392-10v440m24-440v440M392 12l24-24m-24 77 24-24m-24 77 24-24m-24 77 24-24m-24 77 24-24m-24 77 24-24m-24 77 24-24m-24 77 24-24M472 195l115 135m-115-30L587 145"/><circle cx="457" cy="176" r="29"/><circle cx="457" cy="313" r="29"/><path d="M35 382h285M35 391h285"/>',
  carwash:
    '<path d="M318 292h264l-6-46-48-10-44-48H384l-40 48-26 8Z"/><path d="M352 236h220"/><circle cx="380" cy="296" r="26"/><circle cx="520" cy="296" r="26"/><circle cx="440" cy="112" r="34"/><circle cx="526" cy="70" r="20"/><circle cx="378" cy="58" r="14"/><circle cx="566" cy="148" r="11"/><path d="M-30 380C110 340 205 410 400 372s200 20 260-10M-30 397C110 357 205 427 400 389"/>',
  workspace:
    '<path d="M330 300h260M372 300l-12-84h172l-12 84M362 222h176"/><path d="M572 300V128l-56 22M516 150c0 18 20 26 34 16"/><path d="M-30 372h440M-30 386h440" stroke-dasharray="3 9"/><circle cx="420" cy="92" r="28"/><path d="M420 64v-16M448 92h16M392 92h-16"/>',
  gym: '<path d="M372 210h156"/><rect x="340" y="156" width="32" height="108" rx="7"/><rect x="306" y="174" width="34" height="72" rx="7"/><rect x="528" y="156" width="32" height="108" rx="7"/><rect x="560" y="174" width="34" height="72" rx="7"/><path d="M-30 372h170l26-46 34 92 30-70 22 24h330"/>',
  beauty:
    '<path d="M472 400C472 270 522 168 602 124M472 300c-42-20-62-62-52-104 42 10 62 52 52 104M502 222c10-42 52-62 94-52-10 42-52 62-94 52"/><circle cx="372" cy="110" r="60"/><circle cx="372" cy="110" r="44"/><path d="M372 30v14M372 176v14M292 110h14M438 110h14"/><path d="M-30 386C110 346 205 416 400 378"/>',
  bakery:
    '<path d="M522 404V122M522 164c-20-10-30-30-24-50 20 6 30 26 24 50M522 164c20-10 30-30 24-50-20 6-30 26-24 50M522 214c-20-10-30-30-24-50 20 6 30 26 24 50M522 214c20-10 30-30 24-50-20 6-30 26-24 50M522 264c-20-10-30-30-24-50 20 6 30 26 24 50M522 264c20-10 30-30 24-50-20 6-30 26-24 50"/><path d="M292 304c22-64 128-64 150 0-32-15-54-15-75 0-21-15-43-15-75 0Z"/><path d="M-30 386C110 346 205 416 400 378"/>',
  general:
    '<circle cx="510" cy="66" r="154"/><circle cx="510" cy="66" r="130"/><circle cx="510" cy="66" r="106"/><path d="M-80 315C125 60 280 505 700 150M-80 340C125 85 280 530 700 175"/>',
};
