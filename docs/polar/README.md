# Polar.sh Migration Guide

Migrate products, discounts, customers, and license keys from Polar.sh to Dodo Payments with `dodo-migrate polar`.

## Prerequisites

Before starting migration:

1. **Polar.sh Organization Access Token**
   - Go to [Polar.sh Settings > Tokens](https://polar.sh/settings/tokens)
   - Create a new "Organization Access Token"
   - Required permissions: Read access to products, discounts, customers, organizations
   - Save token securely - you'll need it for migration

2. **Dodo Payments API Key**
   - Go to your [Dodo Payments Dashboard](https://dodopayments.com/dashboard)
   - Navigate to Settings > API Keys
   - Create API key for test or live mode
   - Save API key securely

3. **Dodo Payments Brand ID**
   - Find your Brand ID in Dodo Payments dashboard
   - Required to specify which brand receives migrated data
   - Format: `brand_xxxxx`

4. **Node.js ≥18**
   - Check version: `node --version`
   - Update if needed: [nodejs.org](https://nodejs.org)

---

## Quick Start

### Interactive Mode (Recommended for First-Time Users)

```bash
dodo-migrate polar
```

The CLI will guide you through:
1. Enter Polar.sh Organization Access Token
2. Enter Dodo Payments API key
3. Select environment (test/live mode)
4. Select organization (if you have multiple)
5. Select brand
6. Choose what to migrate (products, discounts, customers, license keys)
7. Preview items
8. Confirm and migrate

### Non-Interactive Mode (for CI/CD)

```bash
dodo-migrate polar \
  --provider-api-key="polar_org_xxxxx" \
  --dodo-api-key="dodo_xxxxx" \
  --dodo-brand-id="brand_xxxxx" \
  --mode="test_mode" \
  --migrate-types="products,discounts" \
  --polar-organization-id="org_xxxxx"  # Only if you have multiple orgs
```

---

## Supported Data Types

### ✅ Products

**What's Migrated:**
- Product name and description
- One-time and recurring (monthly/yearly) prices
- Multiple price variants (creates separate Dodo products)
- Currency information

**Transformations:**
- Polar recurring intervals → Dodo billing periods (month → monthly, year → yearly)
- Multiple prices per product → Multiple Dodo products
- Price amounts preserved in cents

**Limitations:**
- ⚠️ **Non-license-key benefits not migrated** (GitHub access, file downloads, custom, etc.)
  - Products with non-license-key benefits will migrate successfully
  - Warning logged for manual setup
  - Configure benefits manually in Dodo Payments after migration
- License key benefits are migrated separately (see License Keys section below)
- Weekly/daily recurring intervals not supported (only monthly/yearly)
- Trial periods not migrated
- Pay-what-you-want pricing → Skipped with warning

### ✅ Discounts

**What's Migrated:**
- Discount codes
- Percentage and fixed amount discounts
- Usage limits (max redemptions)
- Expiration dates
- Discount names

**Transformations:**
- Polar basis points → Percentage (2000 basis points → 20%)
- Fixed amounts preserved with currency
- Expiration dates converted to ISO 8601 format

**Limitations:**
- ⚠️ **Product restrictions not migrated**
  - Discounts restricted to specific products will be created without restrictions
  - Warning logged during migration
- Discount duration types (once/repeating/forever) → Only expiration date migrated
- Expired discounts automatically skipped

### ✅ Customers

**What's Migrated:**
- Email addresses (required)
- Customer names
- Billing addresses (line1, line2, city, state, postal code, country)
- Metadata with reconciliation IDs

**Metadata Preserved:**
- `polar_customer_id`: Original Polar customer ID
- `polar_external_id`: Your external system ID
- `polar_metadata`: Custom metadata from Polar
- `migrated_from`: "polar"
- `migrated_at`: ISO 8601 timestamp

**Limitations:**
- Phone numbers not migrated (Polar doesn't store phone)
- Customers without email → Skipped with warning
- Deleted customers → Skipped automatically

### ✅ License Keys

**What's Migrated:**
- License key strings
- Activation limits
- Expiration dates
- Customer and product associations

**Requirements:**
- Products and customers must be migrated in the same session as license keys
- The migration builds an in-memory mapping of Polar IDs → Dodo IDs
- License keys are resolved from Polar benefits (benefit → product mapping built during product migration)

**Transformations:**
- Polar `benefit_id` → resolved to Dodo `product_id` via benefit-to-product mapping
- Polar `customer_id` → mapped to Dodo `customer_id`
- `limit_activations` → `activations_limit` (null = unlimited in both systems)
- `expires_at` → direct mapping (ISO 8601, null = perpetual)  

**Limitations:**
- ⚠️ **Revoked/disabled keys are skipped** (only `"granted"` status keys are migrated)
- License key activations (device instances) are not migrated — customers will need to re-activate
- Keys without a resolvable product or customer mapping are skipped with a warning
- Usage counts (`usage`, `limit_usage`) are not migrated (Dodo tracks activations, not usage)

---

## CLI Arguments Reference

| Argument | Description | Required | Default |
|----------|-------------|----------|---------|
| `--provider-api-key` | Polar.sh Organization Access Token | Interactive: No<br>Non-interactive: Yes | Prompts in interactive mode |
| `--dodo-api-key` | Dodo Payments API Key | Interactive: No<br>Non-interactive: Yes | Prompts in interactive mode |
| `--dodo-brand-id` | Dodo Payments Brand ID | Interactive: No<br>Non-interactive: Yes | Prompts in interactive mode |
| `--mode` | Environment: `test_mode` or `live_mode` | No | `test_mode` |
| `--migrate-types` | Comma-separated: `products`, `discounts`, `customers`, `license_keys` | No | Interactive: Prompts<br>Non-interactive: `products,discounts` |
| `--polar-organization-id` | Polar organization ID (if multiple orgs) | Only if multiple orgs in non-interactive mode | Auto-select if single org |

---

## Examples

### Migrate Only Products (Interactive)

```bash
dodo-migrate polar --migrate-types="products"
```

### Migrate to Live Mode (Interactive)

```bash
dodo-migrate polar --mode="live_mode"
```

### Full Non-Interactive Migration (CI/CD)

```bash
#!/bin/bash
# migration-script.sh

export POLAR_API_KEY="polar_org_xxxxx"
export DODO_API_KEY="dodo_xxxxx"
export DODO_BRAND_ID="brand_xxxxx"

dodo-migrate polar \
  --provider-api-key="$POLAR_API_KEY" \
  --dodo-api-key="$DODO_API_KEY" \
  --dodo-brand-id="$DODO_BRAND_ID" \
  --mode="test_mode" \
  --migrate-types="products,discounts,customers"

if [ $? -eq 0 ]; then
  echo "Migration completed successfully"
else
  echo "Migration failed"
  exit 1
fi
```

### Migrate Specific Organization

```bash
dodo-migrate polar \
  --provider-api-key="polar_org_xxxxx" \
  --dodo-api-key="dodo_xxxxx" \
  --dodo-brand-id="brand_xxxxx" \
  --polar-organization-id="org_abc123xyz"
```

---

## Troubleshooting

### "Failed to connect to Polar.sh"

**Cause**: Invalid Organization Access Token

**Solution**:
1. Verify token at [Polar.sh Settings > Tokens](https://polar.sh/settings/tokens)
2. Ensure token is **Organization Access Token** (not Personal Access Token)
3. Check token has read permissions for products, discounts, customers
4. Regenerate token if necessary

### "No organizations found for this access token"

**Cause**: Token doesn't have access to any organizations

**Solution**:
1. Verify you're a member of at least one Polar.sh organization
2. Check token permissions include organization access
3. Try creating a new Organization Access Token

### "Multiple Polar.sh organizations detected"

**Cause**: Your account has access to multiple organizations (non-interactive mode)

**Solution**:
- Add `--polar-organization-id` flag with specific organization ID
- Get organization ID from Polar.sh dashboard or run in interactive mode first

### "Product 'X' has N benefits that require manual setup"

**Cause**: Non-license-key benefits are Polar-specific features not directly supported by Dodo Payments

**Solution**:
1. License key benefits are handled by the `license_keys` migration type
2. Other benefits must be configured manually in Dodo Payments:
   - **GitHub access**: Use GitHub Apps or manual invitations
   - **File downloads**: Use cloud storage (S3, GCS) with signed URLs
   - **Discord invites**: Use Discord bot with role assignment

### "License key migration requires products and customers to be migrated in the same session"

**Cause**: License keys need product and customer ID mappings that are built during migration

**Solution**:
- Re-run migration with all three types selected: `--migrate-types="products,customers,license_keys"`

### "Discount 'CODE' is restricted to specific products"

**Cause**: Polar allows product-specific discounts; Dodo has different approach

**Solution**:
- Discount migrates without product restrictions
- Manually configure product restrictions in Dodo Payments after migration (if supported)

### "Skipping customer ${id} - no email address"

**Cause**: Dodo Payments requires email addresses for customers

**Solution**:
- Customer without email cannot be migrated
- Update customer in Polar.sh with email, then re-run migration
- Or manually create customer in Dodo Payments

### "Polar.sh API rate limit exceeded"

**Cause**: More than 300 requests per minute

**Solution**:
- Wait for the time specified in error message
- Migration will automatically respect rate limits
- For large migrations (>1000 items), consider running during off-peak hours

---

## Migration Best Practices

### 1. Always Test First

```bash
# Step 1: Test mode migration
dodo-migrate polar --mode="test_mode" --migrate-types="products"

# Step 2: Verify in Dodo Payments test dashboard

# Step 3: Production migration
dodo-migrate polar --mode="live_mode" --migrate-types="products"
```

### 2. Migrate Incrementally

```bash
# Day 1: Products only
dodo-migrate polar --migrate-types="products"

# Day 2: Verify products, then discounts
dodo-migrate polar --migrate-types="discounts"

# Day 3: Verify all, then customers
dodo-migrate polar --migrate-types="customers"
```

### 3. Keep Tokens Secure

```bash
# ✅ DO: Use environment variables
export POLAR_TOKEN="polar_org_xxxxx"
dodo-migrate polar --provider-api-key="$POLAR_TOKEN"

# ❌ DON'T: Commit tokens to git
# ❌ DON'T: Share tokens in chat/email
# ❌ DON'T: Use production tokens for testing
```

### 4. Backup Before Live Migration

1. Export data from Polar.sh (if available)
2. Document current state in Dodo Payments
3. Run test migration first
4. Verify test results thoroughly
5. Then run live migration

### 5. Monitor Progress

Migration logs show:
- `[LOG]`: Informational messages and progress
- `[SUCCESS]`: Successful item migrations
- `[WARN]`: Non-fatal issues (benefits, restrictions)
- `[ERROR]`: Failed migrations (continue processing)

Individual failures don't stop migration - check logs for complete results.

---

## Rate Limits

**Polar.sh API**: 300 requests per minute

Migration handles rate limiting automatically:
- Adds 200ms delay between API calls to stay under limits
- Retries with exponential backoff on 429 (rate limit) responses
- Reads `retry-after` header when available

**Large Migrations**:
- 100 products → ~30 seconds
- 500 products → ~3 minutes
- 1000+ products → May hit rate limits, wait and retry

---

## Data Reconciliation

After migration, use metadata for reconciliation:

```javascript
// Example: Find migrated Polar customer in Dodo
const dodoCustomer = await dodoClient.customers.list({
  metadata: { polar_customer_id: "cus_polar123" }
});

// Example: Track migration timestamp
const migratedCustomers = await dodoClient.customers.list({
  metadata: { migrated_from: "polar" }
});
```

---

## Frequently Asked Questions

**Q: Can I migrate subscriptions?**  
A: No - active subscriptions cannot be migrated. Migration supports products, discounts, and customer data only. Subscription relationships must be recreated in Dodo Payments.

**Q: Will migration create duplicate data if run twice?**  
A: Yes - migration doesn't check for existing data. Run once per environment or manually clean up duplicates.

**Q: Can I migrate from multiple Polar organizations?**  
A: Run migration separately for each organization. Use `--polar-organization-id` to specify which org.

**Q: How long does migration take?**  
A: Depends on data volume:
- Small (< 100 items): < 1 minute
- Medium (100-500 items): 2-5 minutes
- Large (500-1000 items): 5-10 minutes
- Very large (1000+ items): May require multiple runs due to rate limits

**Q: Can I cancel migration after it starts?**  
A: In interactive mode, you can cancel before confirmation. Once migration starts, items are created immediately (no rollback). Use test mode first!

**Q: What happens to Polar.sh data after migration?**  
A: Nothing - migration only reads from Polar.sh. Original data remains unchanged.

---

## Support

- **Documentation**: [Dodo Payments Docs](https://docs.dodopayments.com)
- **Polar.sh API**: [Polar.sh API Docs](https://docs.polar.sh)
- **Issues**: [GitHub Issues](https://github.com/yourusername/dodo-migrate/issues)

---

## Next Steps

After successful migration:

1. ✅ Verify all products in Dodo Payments dashboard
2. ✅ Check discount codes are active and correct
3. ✅ Validate customer data completeness
4. ✅ Configure benefits manually (if needed)
5. ✅ Test checkout flows with migrated products
6. ✅ Update your application to use Dodo Payments API
7. ✅ Monitor for any missing data or issues

Happy migrating! 🎉
