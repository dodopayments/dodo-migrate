# Lemon Squeezy ➡ Dodo Payments migrator

#### Usage:
```
dodo-migrate lemonsqueezy
```

#### Supported methods:
- Move one-time payment products from Lemon Squeezy to Dodo Payments
- Move subscription products (monthly/yearly) from Lemon Squeezy to Dodo Payments
- Move percentage-based coupons/discounts from Lemon Squeezy to Dodo Payments
- Move customers from Lemon Squeezy to Dodo Payments
- Move license keys from Lemon Squeezy to Dodo Payments

#### Coupon Migration Details:
- Only **published** coupons are migrated
- Only **percentage-based** discounts are supported (fixed amount discounts are skipped with a warning)
- Preserves expiration dates and usage limits
- Maps discount codes and names accurately

#### License Key Migration Details:
- Requires products and customers to be migrated in the same session
- Maps license keys to Dodo products and customers via in-memory ID maps
- Activation limit of 0 in Lemon Squeezy is converted to unlimited (null) in Dodo
- Automatically adds expiry to Dodo Payments licence key where applicable
- Disabled and expired keys are skipped with a warning
- Duplicate keys (409) are handled gracefully for idempotent re-runs
- License key activations (device instances) are not migrated — customers will need to re-activate

#### Arguments (completely optional):
| name | value | info
--- | --- | ---
| --provider-api-key | (string) | Lemon Squeezy API key
| --dodo-api-key | (string) | Dodo Payments API key
| --mode | test_mode / live_mode | Choose your desired mode
| --dodo-brand-id | (string) | Your Dodo Payments brand ID


