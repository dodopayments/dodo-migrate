# Polar.sh Migration (Dodo Payments)

This provider helps migrate from Polar.sh to Dodo Payments.

Status: scaffolded. Endpoints and mappings will be updated as Polar's API surface is confirmed.

## Usage

```bash
dodo-migrate polar \
  --provider-api-key "<POLAR_BEARER_TOKEN>" \
  --dodo-api-key "<DODO_API_KEY>" \
  --mode test_mode
```

You can pass `--migrate-types products,coupons,customers` to select specific entities.

## Configuration
- provider-api-key: Polar Bearer token
- dodo-api-key: Dodo Payments API key
- dodo-brand-id: Optionally specify brand; otherwise you'll be prompted
- polar-base-url: Override Polar API base if needed (default: https://api.polar.sh)

## Notes
- Products, Coupons, Customers are currently implemented as best-effort placeholders.
- Currency, interval and amount fields may need adjustments once Polar schemas are finalized.
- Dry-run prompts are included to preview items before creation in Dodo Payments.
