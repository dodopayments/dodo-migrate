# Lemon Squeezy ➡ Dodo Payments migrator

#### Usage:
```
dodo-migrate lemonsqueezy
```

#### Supported methods:
- Move one-time payment products from Lemon Squeezy to Dodo Payments
- Move subscription products (monthly/yearly) from Lemon Squeezy to Dodo Payments
- Move percentage-based coupons/discounts from Lemon Squeezy to Dodo Payments

#### Coupon Migration Details:
- Only **published** coupons are migrated
- Only **percentage-based** discounts are supported (fixed amount discounts are skipped with a warning)
- Preserves expiration dates and usage limits
- Maps discount codes and names accurately

#### Arguments (completely optional):
| name | value | info
--- | --- | ---
| --provider-api-key | (string) | Lemon Squeezy API key
| --dodo-api-key | (string) | Dodo Payments API key
| --mode | test_mode / live_mode | Choose your desired mode
| --dodo-brand-id | (string) | Your Dodo Payments brand ID


