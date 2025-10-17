import { listProducts, listDiscounts, lemonSqueezySetup, getStore, Store, listPrices } from '@lemonsqueezy/lemonsqueezy.js';
import DodoPayments from 'dodopayments';
import { input, select } from '@inquirer/prompts';


export default {
    // Format: dodo-migrate [provider] [arguments]
    command: 'lemonsqueezy [arguments]',
    describe: 'Migrate from Lemon Squeezy to Dodo Payments',
    builder: (yargs: any) => {
        return yargs
            .option('provider-api-key', {
                describe: 'LemonSqueezy API Key',
                type: 'string',
                demandOption: false
            })
            .option('dodo-api-key', {
                describe: 'Dodo Payments API Key',
                type: 'string',
                demandOption: false
            })
            .option('dodo-brand-id', {
                describe: 'Dodo Payments Brand ID',
                type: 'string',
                demandOption: false
            })
            .option('mode', {
                describe: 'Dodo Payments environment',
                type: 'string',
                // defaults to 'test_mode'
                choices: ['test_mode', 'live_mode'],
                demandOption: false,
                default: 'test_mode'
            });
    },
    handler: async (argv: any) => {
        // Store the details of the API keys and mode, and prompt the user if they fail to provide it in the CLI
        const PROVIDER_API_KEY = argv['provider-api-key'] || await input({ message: 'Enter your Lemon Squeezy API Key:', required: true });

        const DODO_API_KEY = argv['dodo-api-key'] || await input({ message: 'Enter your Dodo Payments API Key:', required: true });
        const MODE = argv['mode'] || await select({
            message: 'Select Dodo Payments environment:',
            choices: [
                { name: 'Test Mode', value: 'test_mode' },
                { name: 'Live Mode', value: 'live_mode' }
            ],
            default: 'test_mode'
        });

        // Set up the Lemon Squeezy SDK
        lemonSqueezySetup({
            apiKey: PROVIDER_API_KEY,
            onError: (error) => {
                console.log("[ERROR] Failed to set up Lemon Squeezy!\n", error.cause);
                process.exit(1);
            },
        });

        // Set up the Dodo Payments sdk
        const client = new DodoPayments({
            bearerToken: DODO_API_KEY,
            environment: MODE,
        });


        // This variable will store the brand ID to be used for creating products in a specific Dodo Payments brand
        let brand_id = argv['dodo-brand-id'];
        // If the brand_id variable is null (i.e., the user did not provide it in the CLI), prompt the user to select a brand from their Dodo Payments account.
        if (!brand_id) {
            try {
                // List the brands for the current account from the Dodo Payments SDK
                const brands = await client.brands.list();

                // Give the user an option to select their preferred brand in their Dodo Payments account
                brand_id = await select({
                    message: 'Select your Dodo Payments brand:',
                    choices: brands.items.map((brand) => ({
                        name: brand.name || 'Unnamed Brand',
                        value: brand.brand_id,
                    })),
                });
            } catch (e) {
                console.log("[ERROR] Failed to fetch brands from Dodo Payments!\n", e);
                process.exit(1);
            }
        }

        // This stores the data of the Lemon Squeezy stores. This is used to determine the currency.
        // I've cached this object to prevent rate limiting issues when dealing with multiple Lemon Squeezy products.
        const StoresData: Record<string, Store> = {};

        // This will be the array of products to be created in Dodo Payments
        // Supports both one-time and subscription products
        const Products: { type: 'one_time_product' | 'subscription_product', data: any }[] = [];

        // Helper function to convert Lemon Squeezy pricing to cents
        const convertToCents = (unitPrice: number | undefined, unitPriceDecimal: string | undefined): number => {
            // Prefer unit_price if present and valid
            if (unitPrice && unitPrice > 0) {
                return Math.round(unitPrice);
            }
            
            // Fall back to unit_price_decimal (string with decimal value)
            if (unitPriceDecimal) {
                const decimalValue = parseFloat(unitPriceDecimal);
                if (!isNaN(decimalValue) && decimalValue > 0) {
                    // Convert decimal to cents (multiply by 100 and round)
                    return Math.round(decimalValue * 100);
                }
            }
            
            return 0; // Invalid or missing pricing
        };

        // List the products from the Lemon Squeezy SDK
        const ListProducts = await listProducts();
        if (ListProducts.error || ListProducts.statusCode !== 200) {
            console.log("[ERROR] Failed to fetch products from Lemon Squeezy!\n", ListProducts.error);
            process.exit(1);
        }
        const RawProducts: any[] = ListProducts.data.data;
        console.log('[LOG] Found ' + RawProducts.length + ' products in Lemon Squeezy');

        // Iterate the products
        for (let product of RawProducts) {
            // This will contain the store information of the current product. This information is crucial to determine the currency of the product.
            // Do not confuse this with StoresData which is the cache of all stores
            let StoreData: null | Store = null;
            // Determine price currency for the current product
            let priceCurrency: string | undefined;

            // If the store data is not already fetched, fetch it
            if (!StoresData[product.attributes.store_id]) {
                console.log(`[LOG] Fetching store data for store ID ${product.attributes.store_id}`);
                const FetchStoreData = await getStore(product.attributes.store_id);
                if (FetchStoreData.error || FetchStoreData.statusCode !== 200) {
                    console.log(`[ERROR] Failed to fetch store data for store ID ${product.attributes.store_id}\n`, FetchStoreData.error);
                    process.exit(1);
                }
                StoresData[product.attributes.store_id] = FetchStoreData.data;
                StoreData = FetchStoreData.data;
            } else {
                console.log(`[LOG] Using cached store data for store ID ${product.attributes.store_id}`);
                StoreData = StoresData[product.attributes.store_id];
            }
            priceCurrency = StoreData.data.attributes.currency as any;

            // Fetch actual Price objects for this product
            // First get variants, then fetch prices for each variant
            let productPrices: any[] = [];
            
            try {
                // Get variants for this product
                const variants = (product as any)?.relationships?.variants?.data || [];
                console.log(`[LOG] Found ${variants.length} variants for product ${product.id}`);
                
                // Fetch prices for each variant
                for (const variant of variants) {
                    const variantId = (variant as any).id;
                    if (!variantId) continue;
                    
                    try {
                        console.log(`[LOG] Fetching prices for variant ${variantId}`);
                        const pricesResponse = await listPrices({ 
                            filter: { variantId: variantId } 
                        });
                        
                        if (pricesResponse.error || pricesResponse.statusCode !== 200) {
                            console.log(`[WARNING] Failed to fetch prices for variant ${variantId}:`, pricesResponse.error);
                            continue;
                        }
                        
                        const variantPrices = pricesResponse.data?.data || [];
                        productPrices.push(...variantPrices);
                        console.log(`[LOG] Found ${variantPrices.length} prices for variant ${variantId}`);
                        
                    } catch (variantError: any) {
                        console.log(`[WARNING] Exception while fetching prices for variant ${variantId}:`, variantError.message);
                        continue;
                    }
                }
                
                console.log(`[LOG] Total prices found for product ${product.id}: ${productPrices.length}`);
                
            } catch (error: any) {
                console.log(`[ERROR] Exception while processing variants for product ${product.id}:`, error.message);
            }
            
            // If no prices found via variants, fallback to product-level price
            if (productPrices.length === 0) {
                console.log(`[WARNING] No prices found for product ${product.id}, using product-level price as fallback`);
                if (product.attributes.price && product.attributes.price > 0) {
                    Products.push({
                        type: 'one_time_product',
                        data: {
                            name: product.attributes.name,
                            tax_category: 'saas',
                            price: {
                                currency: priceCurrency as any,
                                price: product.attributes.price,
                                discount: 0,
                                purchasing_power_parity: false,
                                type: 'one_time_price'
                            },
                            brand_id: brand_id
                        }
                    });
                }
                continue;
            }

            // Filter prices by category
            const subscriptionPrices = productPrices.filter((price: any) => 
                price?.attributes?.category === 'subscription'
            );
            
            const oneTimePrices = productPrices.filter((price: any) => 
                price?.attributes?.category === 'one_time'
            );

            // Process subscription prices
            for (const price of subscriptionPrices) {
                const priceAttrs = price?.attributes;
                if (!priceAttrs) continue;
                
                // Extract pricing data from Price object
                const unitPriceCents = convertToCents(priceAttrs.unit_price, priceAttrs.unit_price_decimal);
                const renewalIntervalQuantity = priceAttrs.renewal_interval_quantity || 1;
                const renewalIntervalUnit = priceAttrs.renewal_interval_unit || 'month';
                
                // Check if this is a fixed-term subscription
                // For now, assume evergreen (indefinite) subscriptions by default
                // TODO: Add logic to detect fixed-term subscriptions when indicators are available
                const isFixedTerm = false; // Placeholder - implement detection logic as needed

                // Validate unit price
                if (unitPriceCents <= 0) {
                    console.log(`[WARNING] Skipping subscription price ${price.id} with invalid price (${unitPriceCents} cents)`);
                    continue;
                }

                // Map Lemon Squeezy interval units to Dodo Payments format
                const mapIntervalUnit = (unit: string): string => {
                    const normalized = unit.toLowerCase();
                    if (normalized === 'month' || normalized === 'monthly') return 'Month';
                    if (normalized === 'year' || normalized === 'yearly') return 'Year';
                    if (normalized === 'day' || normalized === 'daily') return 'Day';
                    if (normalized === 'week' || normalized === 'weekly') return 'Week';
                    return 'Month'; // fallback
                };

                const dodoIntervalUnit = mapIntervalUnit(renewalIntervalUnit);

                // Normalize interval to supported billing periods (Dodo Payments supports monthly/yearly for billing_period)
                const normalizedInterval = renewalIntervalUnit.toLowerCase();
                const billingPeriod: 'monthly' | 'yearly' | null = 
                    normalizedInterval === 'month' || normalizedInterval === 'monthly'
                        ? 'monthly'
                        : normalizedInterval === 'year' || normalizedInterval === 'yearly'
                            ? 'yearly'
                            : null;

                if (!billingPeriod) {
                    console.log(`[ERROR] Unsupported billing interval "${renewalIntervalUnit}" for subscription price ${price.id}; skipping to avoid creating a wrong plan`);
                    continue;
                }

                // Create subscription product for this price
                Products.push({
                    type: 'subscription_product',
                    data: {
                        name: product.attributes.name,
                        tax_category: 'saas',
                        price: {
                            currency: priceCurrency as any,
                            price: unitPriceCents,
                            discount: 0,
                            purchasing_power_parity: false,
                            type: 'recurring_price',
                            billing_period: billingPeriod,
                            payment_frequency_interval: dodoIntervalUnit,
                            payment_frequency_count: renewalIntervalQuantity, // billing cadence
                            subscription_period_interval: dodoIntervalUnit,
                            ...(isFixedTerm ? { subscription_period_count: renewalIntervalQuantity || 1 } : {})
                        },
                        brand_id: brand_id
                    }
                });
            }

            // Process one-time prices
            for (const price of oneTimePrices) {
                const priceAttrs = price?.attributes;
                if (!priceAttrs) continue;
                
                const unitPriceCents = convertToCents(priceAttrs.unit_price, priceAttrs.unit_price_decimal);

                // Validate unit price
                if (unitPriceCents <= 0) {
                    console.log(`[WARNING] Skipping one-time price ${price.id} with invalid price (${unitPriceCents} cents)`);
                    continue;
                }

                // Create one-time product for this price
                Products.push({
                    type: 'one_time_product',
                    data: {
                        name: product.attributes.name,
                        tax_category: 'saas',
                        price: {
                            currency: priceCurrency as any,
                            price: unitPriceCents,
                            discount: 0,
                            purchasing_power_parity: false,
                            type: 'one_time_price'
                        },
                        brand_id: brand_id
                    }
                });
            }

            // Note: Fallback for no prices is handled earlier in the code (lines 171-191)
        }

        console.log('\n[LOG] These are the products to be migrated:');
        Products.forEach((product, index) => {
            const priceAmount = (product.data.price.price / 100).toFixed(2);
            const isSubscription = product.type === 'subscription_product';
            const kind = isSubscription ? 'Subscription' : 'One Time';
            const billingSuffix = isSubscription ? ` (${product.data.price.billing_period})` : '';
            console.log(`${index + 1}. ${product.data.name} - ${product.data.price.currency} ${priceAmount} (${kind}${billingSuffix})`);
        });

        // Ask the user for final confirmation before creating the products in Dodo Payments
        const migrateProducts = await select({
            message: 'Proceed to create these products in Dodo Payments?',
            choices: [
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            ],
        });

        if (migrateProducts === 'yes') {
            // Iterate all the stored products and create them in Dodo Payments
            let successCount = 0;
            let errorCount = 0;
            
            for (let product of Products) {
                // Blank line for better readability in logs
                console.log();
                // Create the product in Dodo Payments (one-time or subscription)
                try {
                if (product.type === 'one_time_product') {
                    console.log(`[LOG] Migrating product: ${product.data.name}`);
                    const createdProduct = await client.products.create(product.data);
                    console.log(`[LOG] Migration for product: ${createdProduct.name} completed (Dodo Payments product ID: ${createdProduct.product_id})`);
                        successCount++;
                    } else if (product.type === 'subscription_product') {
                        console.log(`[LOG] Migrating subscription: ${product.data.name}`);
                        const createdProduct = await client.products.create(product.data);
                        console.log(`[LOG] Migration for subscription: ${createdProduct.name} completed (Dodo Payments product ID: ${createdProduct.product_id})`);
                        successCount++;
                } else {
                    console.log(`[LOG] Skipping product: ${product.data.name} for unknown product type (example one time, subscription, etc)`);
                }
                } catch (error: any) {
                    errorCount++;
                    console.log(`[ERROR] Failed to migrate product: ${product.data.name}`);
                    console.log(`[ERROR] Error details: ${error.message || error.toString()}`);
                    
                    // Log additional error context if available
                    if (error.status) {
                        console.log(`[ERROR] HTTP Status: ${error.status}`);
                    }
                    if (error.error?.message) {
                        console.log(`[ERROR] API Error: ${error.error.message}`);
                    }
                    
                    // Continue with next product instead of crashing
                    console.log(`[LOG] Continuing with remaining products...`);
                }
            }
            
            // Summary of migration results
            console.log(`\n[LOG] Migration completed! Success: ${successCount}, Errors: ${errorCount}`);
            if (errorCount > 0) {
                console.log(`[LOG] ${errorCount} product(s) failed to migrate. Check error messages above for details.`);
            }
        } else {
            console.log('[LOG] Migration aborted by user');
            process.exit(0);
        }

        // -----------------------------
        // Coupons (Discounts) Migration
        // -----------------------------

        // Continue with coupon migration (requires a valid Lemon Squeezy API key)

        // Helper to resolve a store's currency on-demand and cache it in StoresData
        const resolveStoreCurrency = async (storeId?: string | number | null): Promise<string | undefined> => {
            if (!storeId && storeId !== 0) return undefined;
            const key = String(storeId);
            if (!StoresData[key]) {
                console.log(`[LOG] Fetching store data for store ID ${key} (for coupon currency)`);
                const fetched = await getStore(Number(storeId));
                if (fetched.error || fetched.statusCode !== 200) {
                    console.log(`[ERROR] Failed to fetch store data for store ID ${key} while resolving coupon currency\n`, fetched.error);
                    return undefined;
                }
                StoresData[key] = fetched.data;
            }
            return StoresData[key]?.data?.attributes?.currency as any;
        };

        // Fetch discounts (coupons)
        console.log('\n[LOG] Fetching discounts (coupons) from Lemon Squeezy...');
        const ListDiscounts = await listDiscounts();
        if (ListDiscounts.error || ListDiscounts.statusCode !== 200) {
            console.log('[ERROR] Failed to fetch discounts from Lemon Squeezy!\n', ListDiscounts.error);
            process.exit(1);
        }

        const RawDiscounts: any[] = ListDiscounts.data?.data || [];
        console.log(`[LOG] Found ${RawDiscounts.length} discounts in Lemon Squeezy`);

        // Filter to valid/published discounts only
        const PublishedDiscounts = RawDiscounts.filter((d: any) => {
            const status = d?.attributes?.status || d?.attributes?.state;
            return status === 'active' || status === 'published' || status === 'enabled';
        });
        console.log(`[LOG] Considering ${PublishedDiscounts.length} published/active discounts`);

        // Map to internal shape and fix currency logic for fixed-amount discounts
        const CouponsToMigrate = [] as any[];
        for (const discount of PublishedDiscounts) {
            const attrs = discount?.attributes || {};
            const discountType: string = (attrs.discount_type || attrs.type || '').toString(); // 'percent' | 'amount' (naming may vary)
            const isPercentage = discountType.includes('percent');
            const isFixedAmount = !isPercentage; // default to fixed if not clearly percentage

            let amountOff = 0;
            let percentOff = 0;
            let currency: string | undefined;

            if (isPercentage) {
                percentOff = Number(attrs.amount) || Number(attrs.percentage) || 0;
            } else if (isFixedAmount) {
                amountOff = Number(attrs.amount) || 0;
                // FIX: Prefer discount.attributes.currency; fall back to fetching/caching store currency
                currency = (attrs.currency as string) || undefined;
                if (!currency) {
                    const storeId = attrs.store_id || discount?.relationships?.store?.data?.id;
                    currency = await resolveStoreCurrency(storeId);
                }
            }

            // Skip discounts that don't have meaningful values
            if (isPercentage && percentOff <= 0) continue;
            if (isFixedAmount && amountOff <= 0) continue;

            // Build a neutral representation (logging and potential future migration)
            CouponsToMigrate.push({
                name: attrs.name || attrs.code || 'Unnamed Discount',
                code: attrs.code,
                type: isPercentage ? 'percentage' : 'fixed',
                percent_off: isPercentage ? percentOff : undefined,
                amount_off: isFixedAmount ? amountOff : undefined,
                currency: isFixedAmount ? currency : undefined,
                usage_limit: attrs.usage_limit ?? attrs.max_uses ?? null,
                expires_at: attrs.redeem_by || attrs.expires_at || null,
            });
        }

        if (CouponsToMigrate.length === 0) {
            console.log('[LOG] No eligible discounts (coupons) to migrate.');
            return;
        }

        console.log('\n[LOG] These are the coupons to be migrated:');
        CouponsToMigrate.forEach((c, index) => {
            if (c.type === 'percentage') {
                console.log(`${index + 1}. ${c.code || c.name} - ${c.percent_off}% off`);
            } else {
                console.log(`${index + 1}. ${c.code || c.name} - ${c.currency} ${(Number(c.amount_off) / 100).toFixed(2)} off`);
            }
        });

        const migrateCoupons = await select({
            message: 'Proceed to migrate these coupons to Dodo Payments?',
            choices: [
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            ],
        });

        if (migrateCoupons === 'yes') {
            // NOTE: Implement actual coupon creation with Dodo Payments SDK when endpoint is available.
            // For now, we just log the intent while ensuring currency resolution is correct.
            for (const c of CouponsToMigrate) {
                console.log();
                console.log(`[LOG] Migrating coupon: ${c.code || c.name}`);
                // Example (pseudo): await client.coupons.create({ ...c });
                console.log('[LOG] Coupon migration simulated.');
            }
            console.log('\n[LOG] All coupons processed.');
        } else {
            console.log('[LOG] Coupon migration aborted by user');
        }
    }
}