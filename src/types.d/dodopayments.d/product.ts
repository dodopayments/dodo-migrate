import {
    AttachExistingCustomer, BillingAddress,
    CountryCodeAlpha2,
    Currency,
    CustomerLimitedDetailsResponse, CustomerRequest,
    Metadata, NewCustomer,
    PaymentMethodTypes
} from "./common";

/* ---------- Request types ---------- */

export interface OneTimeProductCartItemReq {
    amount?: number | null;
    product_id: string;
    quantity: number;
}

export interface CreateOneTimePaymentRequest {
    allowed_payment_method_types?: PaymentMethodTypes[] | null;
    billing: BillingAddress;
    billing_currency?: Currency | null;
    customer: CustomerRequest;
    discount_code?: string | null;
    metadata?: Metadata;
    payment_link?: boolean | null;
    product_cart: OneTimeProductCartItemReq[];
    return_url?: string | null;
    show_saved_payment_methods?: boolean;
    tax_id?: string | null;
}

/* ---------- Response types ---------- */

export type OneTimeProductCartItemRes = OneTimeProductCartItemReq;

export interface CreateOneTimePaymentResponse {
    client_secret: string;
    customer: CustomerLimitedDetailsResponse;
    discount_id?: string | null;
    expires_on?: string | null;  // ISO 8601 date-time
    metadata: Metadata;
    payment_id: string;
    payment_link?: string | null;
    product_cart?: OneTimeProductCartItemRes[] | null;
    total_amount: number;
}
