/**
 * Canonical discount interface that is provider-agnostic
 * This interface defines the standard structure for discount data across all payment providers
 */
export interface CanonicalDiscount {
  id: string;
  provider: 'lemonsqueezy' | 'stripe' | 'polar';
  name: string;
  code: string;
  amount: number;
  isPercent: boolean;
  
  // Duration fields for subscription cycle support
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths: number | null;
  
  // Additional fields
  status: 'published' | 'draft' | 'archived';
  usageLimit: number | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  
  // Provider-specific metadata
  providerData?: Record<string, any>;
}

/**
 * LemonSqueezy specific discount interface
 * This represents the raw data structure from LemonSqueezy API
 */
export interface LemonSqueezyDiscount {
  id: string;
  type: string;
  attributes: {
    store_id: number;
    name: string;
    code: string;
    amount: number;
    amount_type: 'percent' | 'fixed';
    status: 'published' | 'draft' | 'archived';
    duration: 'once' | 'repeating' | 'forever';
    duration_in_months: number | null;
    is_limited_redemptions: boolean;
    max_redemptions: number | null;
    expires_at: string | null;
    created_at: string;
    updated_at: string;
  };
}

/**
 * Dodo Payments discount interface
 * This represents the structure expected by Dodo Payments API
 * Note: Dodo Payments currently only supports percentage discounts
 */
export interface DodoPaymentsDiscount {
  name: string;
  code: string;
  type: 'percentage';
  amount: number;
  usage_limit: number | null;
  expires_at: string | null;
  brand_id: string;
  // Duration fields for subscription cycles (if supported by Dodo Payments)
  duration?: 'once' | 'repeating' | 'forever';
  duration_in_months?: number | null;
}
