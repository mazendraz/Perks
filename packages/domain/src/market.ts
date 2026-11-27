/**
 * The market Perks sells in. Today that is Egypt only: every price is shown and charged in
 * Egyptian pounds, whatever the visitor's device language or location.
 *
 * Adding a market later (Saudi Arabia, the UAE) means adding an entry here and a matching active
 * row in `plan_prices` for its currency (the table already accepts EGP, SAR and AED). Nothing else
 * should read the device language to pick a currency.
 */
export interface Market {
  key: string;
  currency: 'EGP' | 'SAR' | 'AED';
  /** Arabic unit written after an amount: "500 جنيه". */
  unitAr: string;
  /** Arabic currency name: "الأسعار بالجنيه المصري". */
  nameAr: string;
  unitEn: string;
  /** Official WhatsApp line, in international form without "+". */
  whatsapp: string;
  /** Where self-service subscriptions are paid by InstaPay: the same official number. */
  instapay: string;
}

export const MARKETS = {
  eg: {
    key: 'eg',
    currency: 'EGP',
    unitAr: 'جنيه',
    nameAr: 'الجنيه المصري',
    unitEn: 'EGP',
    whatsapp: '201006111380',
    instapay: '01006111380',
  },
} as const satisfies Record<string, Market>;

/** The only market that is open today. */
export const ACTIVE_MARKET: Market = MARKETS.eg;
