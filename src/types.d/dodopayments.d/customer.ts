import {CustomerLimitedDetailsResponse, NewCustomer} from "./common";

/* ---------- Request types ---------- */

export interface CreateCustomerRequest extends NewCustomer {}

/* ---------- Response types ---------- */

export interface CustomerResponse extends CustomerLimitedDetailsResponse {
    business_id: string;
    created_at: string; // ISO 8601 date-time
    phone_number?: string | null;
}
