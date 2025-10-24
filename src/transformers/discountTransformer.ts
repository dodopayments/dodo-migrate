import { CanonicalDiscount, DodoPaymentsDiscount } from '../models/discount.js';

/**
 * Transforms canonical discount to Dodo Payments format
 * @param canonicalDiscount Canonical discount object
 * @param brandId Dodo Payments brand ID
 * @returns DodoPaymentsDiscount Dodo Payments discount object
 */
export function transformToDodoPayments(
  canonicalDiscount: CanonicalDiscount,
  brandId: string
): DodoPaymentsDiscount {
  // Validate required fields
  if (!canonicalDiscount.name || !canonicalDiscount.code) {
    throw new Error(`Invalid discount data: missing name or code for discount ${canonicalDiscount.id}`);
  }

  // Only support percentage discounts (Dodo Payments limitation)
  if (!canonicalDiscount.isPercent) {
    throw new Error(`Dodo Payments only supports percentage discounts. Cannot migrate fixed amount discount: ${canonicalDiscount.name}`);
  }

  // Convert percentage to the format expected by Dodo Payments (multiply by 100)
  const amount = canonicalDiscount.amount * 100;

  const dodoDiscount: DodoPaymentsDiscount = {
    name: canonicalDiscount.name,
    code: canonicalDiscount.code,
    type: 'percentage',
    amount,
    usage_limit: canonicalDiscount.usageLimit,
    expires_at: canonicalDiscount.expiresAt,
    brand_id: brandId,
    // Include duration fields for subscription cycles (if supported by Dodo Payments)
    duration: canonicalDiscount.duration,
    duration_in_months: canonicalDiscount.durationInMonths
  };

  return dodoDiscount;
}

/**
 * Validates a canonical discount object
 * @param discount Canonical discount to validate
 * @returns boolean True if valid, false otherwise
 */
export function validateCanonicalDiscount(discount: CanonicalDiscount): boolean {
  // Check required fields
  if (!discount.id || !discount.name || !discount.code) {
    return false;
  }

  // Check amount is valid
  if (typeof discount.amount !== 'number' || discount.amount < 0) {
    return false;
  }

  // Check duration fields
  if (!['once', 'repeating', 'forever'].includes(discount.duration)) {
    return false;
  }

  // If duration is 'repeating', durationInMonths must be a positive number
  if (discount.duration === 'repeating' && (typeof discount.durationInMonths !== 'number' || discount.durationInMonths <= 0)) {
    return false;
  }

  // If duration is not 'repeating', durationInMonths should be null
  if (discount.duration !== 'repeating' && discount.durationInMonths !== null) {
    return false;
  }

  return true;
}

/**
 * Transforms multiple canonical discounts to Dodo Payments format
 * @param discounts Array of canonical discounts
 * @param brandId Dodo Payments brand ID
 * @returns DodoPaymentsDiscount[] Array of Dodo Payments discount objects
 */
export function transformMultipleToDodoPayments(
  discounts: CanonicalDiscount[],
  brandId: string
): DodoPaymentsDiscount[] {
  const validDiscounts = discounts.filter(validateCanonicalDiscount);
  
  if (validDiscounts.length !== discounts.length) {
    const invalidCount = discounts.length - validDiscounts.length;
    console.warn(`[WARNING] ${invalidCount} invalid discounts were filtered out during transformation`);
  }

  return validDiscounts.map(discount => transformToDodoPayments(discount, brandId));
}
