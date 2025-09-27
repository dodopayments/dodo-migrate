import {
    BillingAddress,
    Currency,
    CustomerLimitedDetailsResponse,
    CustomerRequest,
    Metadata,
    PaymentMethodTypes
} from "./common";

/* ---------- Request types ---------- */

export interface AddonCartResponseItem {
    addon_id: string;
    quantity: number;
}

export interface AttachAddonReq {
    addon_id: string;
    quantity: number;
}

export interface OnDemandSubscriptionReq {
    adaptive_currency_fees_inclusive?: boolean | null;
    mandate_only: boolean;
    product_currency?: Currency | null;
    product_description?: string | null;
    product_price?: number | null;
}

export interface CreateSubscriptionRequest {
    addons?: AttachAddonReq[] | null;
    allowed_payment_method_types?: PaymentMethodTypes[] | null;
    billing: BillingAddress;
    billing_currency?: Currency | null;
    customer: CustomerRequest;
    discount_code?: string | null;
    metadata?: Metadata;
    on_demand?: OnDemandSubscriptionReq | null;
    payment_link?: boolean | null;
    product_id: string;
    quantity: number; // int32
    return_url?: string | null;
    show_saved_payment_methods?: boolean;
    tax_id?: string | null;
    trial_period_days?: number | null;
}

/* ---------- Response types ---------- */

export interface CreateSubscriptionResponse {
    addons: AddonCartResponseItem[];
    client_secret?: string | null;
    customer: CustomerLimitedDetailsResponse;
    discount_id?: string | null;
    expires_on?: string | null; // ISO 8601 date-time
    metadata: Metadata;
    payment_id: string;
    payment_link?: string | null;
    recurring_pre_tax_amount: number;
    subscription_id: string;
}
