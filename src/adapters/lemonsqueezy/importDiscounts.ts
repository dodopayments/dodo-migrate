import { listDiscounts } from '@lemonsqueezy/lemonsqueezy.js';
import { CanonicalDiscount, LemonSqueezyDiscount } from '../../models/discount.js';

/**
 * Fetches and transforms LemonSqueezy discounts to canonical format
 * @returns Promise<CanonicalDiscount[]> Array of canonical discount objects
 */
export async function importLemonSqueezyDiscounts(): Promise<CanonicalDiscount[]> {
  try {
    // Fetch all discounts from LemonSqueezy API
    const response = await listDiscounts();
    
    if (response.error || response.statusCode !== 200) {
      throw new Error(`Failed to fetch discounts from LemonSqueezy: ${response.error?.message || 'Unknown error'}`);
    }

    const discounts: CanonicalDiscount[] = [];
    
    // Transform each LemonSqueezy discount to canonical format
    for (const lsDiscount of response.data.data as LemonSqueezyDiscount[]) {
      const canonicalDiscount = transformLemonSqueezyDiscount(lsDiscount);
      discounts.push(canonicalDiscount);
    }

    return discounts;
  } catch (error) {
    console.error('[ERROR] Failed to import LemonSqueezy discounts:', error);
    throw error;
  }
}

/**
 * Transforms a LemonSqueezy discount to canonical format
 * @param lsDiscount Raw LemonSqueezy discount data
 * @returns CanonicalDiscount Canonical discount object
 */
export function transformLemonSqueezyDiscount(lsDiscount: LemonSqueezyDiscount): CanonicalDiscount {
  // Map duration and duration_in_months based on LemonSqueezy API structure
  let duration: 'once' | 'repeating' | 'forever';
  let durationInMonths: number | null = null;

  switch (lsDiscount.attributes.duration) {
    case 'once':
      duration = 'once';
      durationInMonths = null;
      break;
    case 'forever':
      duration = 'forever';
      durationInMonths = null;
      break;
    case 'repeating':
      duration = 'repeating';
      durationInMonths = lsDiscount.attributes.duration_in_months;
      break;
    default:
      // Fallback to 'once' for unknown duration types
      duration = 'once';
      durationInMonths = null;
      console.warn(`[WARNING] Unknown duration type '${lsDiscount.attributes.duration}' for discount ${lsDiscount.attributes.name}, defaulting to 'once'`);
  }

  return {
    id: lsDiscount.id,
    provider: 'lemonsqueezy',
    name: lsDiscount.attributes.name,
    code: lsDiscount.attributes.code,
    amount: lsDiscount.attributes.amount,
    isPercent: lsDiscount.attributes.amount_type === 'percent',
    duration,
    durationInMonths,
    status: lsDiscount.attributes.status,
    usageLimit: lsDiscount.attributes.is_limited_redemptions ? lsDiscount.attributes.max_redemptions : null,
    expiresAt: lsDiscount.attributes.expires_at,
    createdAt: lsDiscount.attributes.created_at,
    updatedAt: lsDiscount.attributes.updated_at,
    providerData: {
      store_id: lsDiscount.attributes.store_id,
      amount_type: lsDiscount.attributes.amount_type
    }
  };
}

/**
 * Filters discounts by status and type
 * @param discounts Array of canonical discounts
 * @param statusFilter Optional status filter
 * @param typeFilter Optional type filter (percentage/fixed)
 * @returns CanonicalDiscount[] Filtered discounts
 */
export function filterDiscounts(
  discounts: CanonicalDiscount[],
  statusFilter?: 'published' | 'draft' | 'archived',
  typeFilter?: 'percentage' | 'fixed'
): CanonicalDiscount[] {
  let filtered = discounts;

  if (statusFilter) {
    filtered = filtered.filter(discount => discount.status === statusFilter);
  }

  if (typeFilter) {
    const isPercent = typeFilter === 'percentage';
    filtered = filtered.filter(discount => discount.isPercent === isPercent);
  }

  return filtered;
}
