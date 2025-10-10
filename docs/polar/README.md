# Polar.sh Migration (Dodo Payments)

This provider helps migrate from Polar.sh to Dodo Payments.

Status: wired to Polar Core API.

## Base URLs
- Production: `https://api.polar.sh/v1`
- Sandbox: `https://sandbox-api.polar.sh/v1`

Use `--server production|sandbox` to switch, or override with `--polar-base-url`.

## Usage

```bash
# Production
dodo-migrate polar \
  --provider-api-key "<POLAR_OAT>" \
  --dodo-api-key "<DODO_API_KEY>" \
  --mode test_mode \
  --server production

# Sandbox
dodo-migrate polar \
  --provider-api-key "<POLAR_OAT_SANDBOX>" \
  --dodo-api-key "<DODO_API_KEY>" \
  --mode test_mode \
  --server sandbox
```

You can pass `--migrate-types products,coupons,customers` to select specific entities.

## Configuration
- provider-api-key: Polar Bearer token
- dodo-api-key: Dodo Payments API key
- dodo-brand-id: Optionally specify brand; otherwise you'll be prompted
- polar-base-url: Override Polar API base if needed (default: https://api.polar.sh)
 - server: `production` or `sandbox` (sets base automatically)

## Notes
 - Products, Coupons, Customers are fetched from `/products/`, `/discounts/`, `/customers/`.
 - Amounts are treated as minor units (cents). Logs display major units for readability.
 - Interval (monthly/yearly) is resolved at product level.
 - Confirmation prompts act as a dry-run gate; no global `--dry-run` flag yet.
