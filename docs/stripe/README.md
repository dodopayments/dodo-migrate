# Stripe ➡ Dodo Payments migrator

#### Usage:
```
dodo-migrate stripe
```

#### Supported methods:
- Move products (one-time and subscription) from Stripe to Dodo Payments
- Move coupons/discounts from Stripe to Dodo Payments
- Move customers from Stripe to Dodo Payments

#### Arguments (completely optional):
| name | value | info
--- | --- | ---
| --provider-api-key | (string) | Stripe Secret API key (sk_...)
| --dodo-api-key | (string) | Dodo Payments API key
| --mode | test_mode / live_mode | Choose your desired mode
| --dodo-brand-id | (string) | Your Dodo Payments brand ID
| --migrate-types | (string) | Comma-separated list: products,coupons,customers

#### Examples:

**Interactive migration (recommended):**
```bash
dodo-migrate stripe
```

**Non-interactive migration with all options:**
```bash
dodo-migrate stripe \
  --provider-api-key=sk_test_XXXXXXXXXXXXXXXX \
  --dodo-api-key=dp_XXXXXXXXXXXXXXXX \
  --mode=test_mode \
  --dodo-brand-id=brand_XXXXXX \
  --migrate-types=products,coupons
```

**Migrate only products:**
```bash
dodo-migrate stripe --migrate-types=products
```

#### What gets migrated:

**Products:**
- Product name and description
- One-time prices → One-time products in Dodo Payments
- Recurring prices → Subscription products in Dodo Payments
- Currency and pricing information
- Active products only

**Coupons:**
- Coupon codes and names
- Percentage and fixed amount discounts
- Usage limits and expiration dates
- Valid coupons only

**Customers:**
- Customer email, name, and phone
- Billing address information
- Metadata including original Stripe customer ID
- Non-deleted customers only

#### Prerequisites:

1. **Stripe API Key**: You'll need a Stripe Secret API key (starts with `sk_`)
   - For test data: Use your test mode secret key
   - For live data: Use your live mode secret key
   - Find your API keys in the Stripe Dashboard → Developers → API keys

2. **Dodo Payments Account**: You'll need:
   - A Dodo Payments API key
   - At least one brand created in your Dodo Payments account

#### Security Notes:

- Never share your Stripe secret API key
- Use test mode keys for testing migrations
- The migration tool only reads data from Stripe, it doesn't modify your Stripe account
- All data is migrated to the Dodo Payments environment you specify (test_mode or live_mode)

#### Migration Process:

1. The tool connects to both Stripe and Dodo Payments
2. Fetches the selected data types from Stripe
3. Shows you a preview of what will be migrated
4. Asks for confirmation before creating anything in Dodo Payments
5. Creates the data in Dodo Payments with progress logging
6. Reports success/failure for each item

#### Troubleshooting:

**"Failed to connect to Stripe"**
- Verify your Stripe API key is correct and has the right permissions
- Make sure you're using a secret key (sk_...) not a publishable key (pk_...)

**"Failed to fetch brands from Dodo Payments"**
- Verify your Dodo Payments API key is correct
- Make sure you have at least one brand created in your account

**"No products/coupons/customers found"**
- Check that you have active data in your Stripe account
- For products: Make sure they have active prices
- For coupons: Make sure they are valid and not expired

**Migration errors for specific items**
- Some items may fail due to validation errors
- Check the error messages for specific issues
- You can re-run the migration to retry failed items
