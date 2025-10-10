# Cashfree → Dodo Payments Migration

This guide explains how to migrate data from Cashfree to Dodo Payments using the dodo-migrate CLI.

## Quick start

```bash
npm i -g dodo-migrate

dodo-migrate cashfree
```

You will be prompted for:
- Cashfree API credentials (Client ID/Key and Client Secret)
- Dodo Payments API key
- Environment (test_mode or live_mode)
- Brand selection in Dodo Payments
- What to migrate (products, coupons, customers)

## Confirmation flow

Before creating anything in Dodo Payments, the CLI will:

- List the items to be migrated for each selected type:
  - Products (with type, currency, price, and billing period for subscriptions)
  - Coupons (with discount amount/percentage and currency)
  - Customers (with name/email preview)
- Ask you to confirm whether to proceed. If you choose No, that section is skipped.

## Supported models (planned)
- Products
- Discount codes (coupons)
- Customers

## Flags
- --provider-api-key Cashfree API Key / Client ID
- --provider-api-secret Cashfree API Secret / Client Secret
- --dodo-api-key Dodo Payments API Key
- --dodo-brand-id Target Dodo Payments brand ID
- --mode Dodo Payments environment (test_mode | live_mode, default: test_mode)
- --migrate-types Comma-separated values: products,coupons,customers
- --cashfree-env Cashfree environment (sandbox | production, default: sandbox)
- --cashfree-api-version Cashfree API version header (default: 2025-01-01)

## Notes
- Sandbox may not have Subscriptions endpoints enabled by default. If endpoints return 404, enable Subscriptions or provide a mock base URL.
- Ensure your Dodo API key has write access for the selected brand.

## References
- Repository: `https://github.com/dodopayments/dodo-migrate`
- Cashfree API docs: `https://www.cashfree.com/docs/`
