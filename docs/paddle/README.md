# Paddle ➡ Dodo Payments migrator

#### Usage:
```
dodo-migrate paddle
```

#### Supported methods:
- Move products (one-time and subscription) from Paddle to Dodo Payments
- Move discounts/coupons from Paddle to Dodo Payments
- Move customers from Paddle to Dodo Payments

#### Arguments (completely optional):
| name | value | info
|--- | --- | ---
| --provider-api-key | (string) | Paddle API key
| --dodo-api-key | (string) | Dodo Payments API key
| --mode | test_mode / live_mode | Choose your desired mode
| --dodo-brand-id | (string) | Your Dodo Payments brand ID
| --migrate-types | (string) | Comma-separated list: products,discounts,customers

#### Examples:

**Interactive migration (recommended):**
```bash
dodo-migrate paddle
```

**Non-interactive migration with all options:**
```bash
# Set environment variables (recommended for security)
export PADDLE_API_KEY="your_paddle_api_key"
export DODO_API_KEY="dp_XXXXXXXXXXXXXXXX"

dodo-migrate paddle \
  --provider-api-key="$PADDLE_API_KEY" \
  --dodo-api-key="$DODO_API_KEY" \
  --mode=test_mode \
  --dodo-brand-id=brand_XXXXXX \
  --migrate-types=products,discounts
```

**Migrate only products:**
```bash
dodo-migrate paddle --migrate-types=products
```

**Migrate customers and products:**
```bash
dodo-migrate paddle --migrate-types=customers,products
```

#### What gets migrated:

**Products:**
- Product name and description
- One-time prices → One-time products in Dodo Payments
- Recurring prices → Subscription products in Dodo Payments
- Currency and pricing information
- Tax-inclusive status (checked from Paddle's tax_mode field)
- Active products only

**Discounts:**
- Discount names and codes
- Percentage discounts (flat amount discounts are skipped)
- Usage limits and expiration dates
- Active discounts only

**Customers:**
- Customer email and name
- Marketing consent status
- Metadata including original Paddle customer ID
- Active customers only

#### Prerequisites:

1. **Paddle API Key**: You'll need a Paddle API key
   - For test data: Use your sandbox API key
   - For live data: Use your live API key
   - Find your API keys in the Paddle Dashboard → Developer Tools → Authentication

2. **Dodo Payments Account**: You'll need:
   - A Dodo Payments API key
   - At least one brand created in your Dodo Payments account

#### Security Notes:

- **Never share your Paddle API key**
- **Use environment variables** instead of passing API keys directly in command line arguments
- **Avoid exposing API keys in shell history** - use `export` commands or `.env` files
- Use sandbox keys for testing migrations
- The migration tool only reads data from Paddle, it doesn't modify your Paddle account
- All data is migrated to the Dodo Payments environment you specify (test_mode or live_mode)

#### Migration Process:

1. The tool connects to both Paddle and Dodo Payments
2. Fetches the selected data types from Paddle
3. Shows you a preview of what will be migrated
4. Asks for confirmation before creating anything in Dodo Payments
5. Creates the data in Dodo Payments with progress logging
6. Reports success/failure for each item

#### Troubleshooting:

**"Failed to connect to Paddle"**
- Verify your Paddle API key is correct and has the right permissions
- Make sure you're using the correct API key for your environment (sandbox vs live)

**"Failed to fetch brands from Dodo Payments"**
- Verify your Dodo Payments API key is correct
- Make sure you have at least one brand created in your account

**"No products/discounts/customers found"**
- Check that you have active data in your Paddle account
- For products: Make sure they have active prices
- For discounts: Make sure they are active and not expired

**Migration errors for specific items**
- Some items may fail due to validation errors
- Check the error messages for specific issues
- You can re-run the migration to retry failed items

#### Paddle API Limitations:

- **Flat amount discounts**: Paddle supports both percentage and flat amount discounts, but Dodo Payments currently only supports percentage discounts. Flat amount discounts will be skipped during migration.
- **Product variants**: If a Paddle product has multiple price variants, each variant will be migrated as a separate product in Dodo Payments.
- **Billing intervals**: Only monthly and yearly billing intervals are supported. Other intervals (weekly, daily) will be skipped.
- **Tax handling**: The migration checks Paddle's `tax_mode` field to determine tax inclusion. Products with `tax_mode: "internal"` are marked as tax-inclusive, while products with `tax_mode: "external"` are tax-exclusive. Only tax-inclusive products include the `tax_inclusive` field in Dodo Payments.

#### Data Mapping:

**Products:**
- Paddle `type: "recurring"` → Dodo `subscription_product`
- Paddle `type: "one_time"` → Dodo `one_time_product`
- Paddle `billing_cycle.interval: "month"` → Dodo `billing_period: "monthly"`
- Paddle `billing_cycle.interval: "year"` → Dodo `billing_period: "yearly"`
- Paddle `tax_mode: "internal"` → Dodo `price.tax_inclusive: true` (tax included in price)
- Paddle `tax_mode: "external"` → Dodo product without `tax_inclusive` field (tax added on top)

**Discounts:**
- Paddle `type: "percentage"` → Dodo `type: "percentage"`
- Paddle percentage ("15" for 15%) → Dodo basis points (1500 for 15%)
- Note: Paddle stores percentage discounts as numeric strings representing whole percentages (e.g., "15" for 15%), not fractional values

**Customers:**
- Paddle `email` → Dodo `email`
- Paddle `name` → Dodo `name`
- Paddle `id` → Dodo `metadata.paddle_customer_id`

