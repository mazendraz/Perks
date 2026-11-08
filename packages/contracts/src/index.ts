import type { CardTemplate, LogoStyle, StampShape, StampIcon, StampStyle } from './branding.js';
export type Language = 'ar' | 'en';
export interface Branch {
  id: string;
  name: string;
}
export interface Grant {
  id: string;
  merchant_id: string;
  role: 'owner' | 'manager' | 'cashier';
  max_qty: number;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  primary_color: string;
  branches: Branch[];
}
export interface Session {
  user: {
    id: string;
    email: string;
    role: 'platform_admin' | 'platform_support' | 'customer';
    mfaVerified: boolean;
    mfaRequired?: boolean;
  };
  csrfToken: string;
  grants: Grant[];
}
export interface CardData {
  logo_asset_id?: string | null;
  logo_url?: string;
  logo_style?: LogoStyle;
  logo_size?: number;
  id: string;
  merchant_id: string;
  merchant_name: string;
  alias: string;
  program_name: string;
  threshold: number;
  balance: number;
  primary_color: string;
  accent_color: string;
  surface_color: string;
  template: CardTemplate;
  stamp_shape?: StampShape;
  stamp_icon?: StampIcon;
  stamp_style?: StampStyle;
  reward_title: string;
  revision: number;
  cycle_number?: number;
  cycle_renewed_at?: string | null;
  display_balance?: number;
  pending_rewards?: number;
}
export interface ApiFailure {
  error: {
    code: string;
    requestId?: string;
    retryable?: boolean;
    fields?: { path: string; code: string }[];
  };
}
export interface SavedCard extends CardData {
  merchant_slug: string;
  program_id: string;
  program_version_id: string;
  program_version: number;
  reward_terms: string;
  status: string;
  merchant_status: string;
  earning_active: boolean;
  joined_at: string;
}
export interface Reward {
  id: string;
  title: string;
  terms: string;
  status: 'available' | 'redeemed' | 'expired' | 'voided';
  earned_at: string;
  expires_at: string;
  redeemed_at: string | null;
}
export interface AwardResult {
  operationId: string;
  transactionId: string;
  reference: string;
  purchaseId: string;
  membershipId: string;
  quantity: number;
  balanceAfter: number;
  accountRevision: number;
  rewardGrants: Reward[];
  committedAt: string;
  source: string;
}
