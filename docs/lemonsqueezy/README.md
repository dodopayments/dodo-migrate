# Lemon Squeezy ➡ Dodo Payments migrator

#### Usage:
```console
dodo-migrate lemonsqueezy
```

#### Supported methods:
- Move one-time payment products from Lemon Squeezy to Dodo Payments
- Move coupons/discounts from Lemon Squeezy to Dodo Payments

#### Migration Types:
You can migrate specific data types using the `--types` argument:

```console
# Migrate only products
dodo-migrate lemonsqueezy --types=products

# Migrate only coupons
dodo-migrate lemonsqueezy --types=coupons

# Migrate both (default)
dodo-migrate lemonsqueezy --types=products,coupons
```

#### Coupon Migration Details:
- Only **published** coupons are migrated
- Supports both percentage and fixed amount discounts
- Preserves expiration dates and usage limits
- Maps discount codes and names accurately
- Handles currency conversion for fixed amounts

#### Arguments (completely optional):
| name | value | info
--- | --- | ---
| --provider-api-key | (string) | Lemon Squeezy API key
| --dodo-api-key | (string) | Dodo Payments API key
| --mode | test_mode / live_mode | Choose your desired mode
| --dodo-brand-id | (string) | Your Dodo Payments brand ID
| --types | products,coupons | Comma-separated list of migration types
