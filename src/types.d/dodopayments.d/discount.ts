export type DiscountType = 'percentage';

/* ---------- Request types ---------- */

export interface CreateDiscountRequest {
    amount: number; // if `type` === 'percentage', this is in basis points, else, USD cents
    type: DiscountType;
    code?: string | null;
    expires_at?: string | null; // ISO 8601 date-time
    name?: string | null;
    restricted_to?: string[] | null;
    subscription_cycles?: number | null;
    usage_limit?: number | null;
}

/* ---------- Response types ---------- */

export interface CreateDiscountResponse {
    discount_id: string;
    business_id: string;
    amount: number;
    type: DiscountType;
    code: string;
    created_at: string; // ISO 8601 date-time
    expires_at?: string | null;name?: string | null;restricted_to: string[];
    subscription_cycles?: number | null;
    times_used: number;
    usage_limit?: number | null;
}
