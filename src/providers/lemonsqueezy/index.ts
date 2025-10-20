import { listProducts, listDiscounts, lemonSqueezySetup, getStore, Store, listPrices, listSubscriptions, listVariants, getCustomer } from '@lemonsqueezy/lemonsqueezy.js';
import DodoPayments from 'dodopayments';
import { input, select } from '@inquirer/prompts';

// Data Models
interface Product {
    type: "products";
    id: string;
    attributes: {
        store_id: number;
        name: string;
        slug: string;
        description: string;
        status: "draft" | "published";
        status_formatted: string;
        thumb_url: string | null;
        large_thumb_url: string | null;
        price: number;
        price_formatted: string;
        created_at: string;
        updated_at: string;
        test_mode: boolean;
    };
    relationships: {
        store: { links: { related: string } };
        variants: { links: { related: string } };
    };
}

interface Variant {
    type: "variants";
    id: string;
    attributes: {
        product_id: number;
        name: string;
        slug: string;
        description: string;
        price: number;
        is_subscription: boolean;
        interval: "day" | "week" | "month" | "year" | null;
        interval_count: number | null;
        has_free_trial: boolean;
        trial_interval: "day" | "week" | "month" | null;
        trial_interval_count: number | null;
        status: "pending" | "published" | "draft";
        created_at: string;
        updated_at: string;
        test_mode: boolean;
    };
    relationships: {
        product: { links: { related: string } };
        price: { links: { related: string } };
    };
}

interface Price {
    type: "prices";
    id: string;
    attributes: {
        variant_id: number | null;
        category: "one_time" | "subscription" | "lead_magnet" | "pwyw";
        unit_price: number | null;
        unit_price_decimal: string | null;
        renewal_interval_unit: "day" | "week" | "month" | "year" | null;
        renewal_interval_quantity: number | null;
        trial_interval_unit: "day" | "week" | "month" | null;
        trial_interval_quantity: number | null;
        created_at: string;
        updated_at: string;
    };
    relationships: {
        variant: { links: { related: string } };
    };
}

interface Subscription {
    type: "subscriptions";
    id: string;
    attributes: {
        store_id: number;
        customer_id: number;
        product_id: number;
        variant_id: number;
        product_name: string;
        variant_name: string;
        user_name: string;
        user_email: string;
        status: "on_trial" | "active" | "paused" | "past_due" | "unpaid" | "cancelled" | "expired";
        status_formatted: string;
        cancelled: boolean;
        trial_ends_at: string | null;
        billing_anchor: number;
        renews_at: string;
        ends_at: string | null;
        created_at: string;
        updated_at: string;
        test_mode: boolean;
    };
    relationships: {
        store: { links: { related: string } };
        customer: { links: { related: string } };
        product: { links: { related: string } };
        variant: { links: { related: string } };
    };
}

// Helper Functions
function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '');
}

function convertToTrialDays(interval: string, count: number): number {
    const daysMap: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
    return daysMap[interval] * count;
}

function convertToCents(unitPrice: number | undefined, unitPriceDecimal: string | undefined): number {
    // Prefer unit_price if present and valid (already in cents)
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

    return 0;
}

function mapIntervalUnit(unit: string): string {
    const normalized = unit.toLowerCase();
    if (normalized === 'month' || normalized === 'monthly') return 'Month';
    if (normalized === 'year' || normalized === 'yearly') return 'Year';
    if (normalized === 'day' || normalized === 'daily') return 'Day';
    if (normalized === 'week' || normalized === 'weekly') return 'Week';
    return 'Month';
}

export default {
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
                choices: ['test_mode', 'live_mode'],
                demandOption: false,
                default: 'test_mode'
            })
            .option('include-subscriptions', {
                describe: 'Include subscription migration',
                type: 'boolean',
                demandOption: false,
                default: false
            })
    },
    handler: async (argv: any) => {
        // Get API keys and configuration
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

        // Set up Lemon Squeezy SDK
        lemonSqueezySetup({
            apiKey: PROVIDER_API_KEY,
            onError: (error) => {
                console.log("[ERROR] Failed to set up Lemon Squeezy!\n", error.cause);
                process.exit(1);
            },
        });

        // Set up Dodo Payments SDK
        const client = new DodoPayments({
            bearerToken: DODO_API_KEY,
            environment: MODE,
        });

        // Get brand ID
        let brand_id = argv['dodo-brand-id'];
        if (!brand_id) {
            try {
                const brands = await client.brands.list();
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

        // Store currency cache
        const StoresData: Record<string, Store> = {};

        // Helper to get store currency
        const getStoreCurrency = async (storeId: number): Promise<string> => {
            if (!StoresData[storeId]) {
                const storeResponse = await getStore(storeId);
                if (storeResponse.error || storeResponse.statusCode !== 200) {
                    console.log(`[ERROR] Failed to fetch store data for store ID ${storeId}\n`, storeResponse.error);
                    throw new Error(`Cannot determine currency for store ${storeId}. Migration cannot continue without proper currency information.`);
                }
                StoresData[storeId] = storeResponse.data;
            }
            const currency = StoresData[storeId].data.attributes.currency as string;
            if (!currency) {
                throw new Error(`Store ${storeId} has no currency information. Migration cannot continue.`);
            }
            return currency;
        };

        // -----------------------------
        // Product Migration
        // -----------------------------

        console.log('[LOG] Fetching products from Lemon Squeezy...');
        const products: any[] = [];
        {
            let page = 1;
            const size = 100;
            while (true) {
                const resp = await listProducts({ page: { number: page, size } } as any);
                if (resp.error || resp.statusCode !== 200) {
                    console.log("[ERROR] Failed to fetch products from Lemon Squeezy!\n", resp.error);
                    process.exit(1);
                }
                const pageData = resp.data?.data || [];
                products.push(...pageData);
                const meta = resp.data?.meta as any;
                const current = meta?.page?.currentPage ?? meta?.page?.current_page ?? page;
                const last = meta?.page?.lastPage ?? meta?.page?.last_page ?? current;
                if (current >= last || pageData.length < size) break;
                page++;
            }
        }
        console.log(`[LOG] Found ${products.length} products in Lemon Squeezy`);

        // Fetch all prices
        console.log('[LOG] Fetching prices from Lemon Squeezy...');
        const prices: any[] = [];
        {
            let page = 1;
            const size = 100;
            while (true) {
                const resp = await listPrices({ page: { number: page, size } } as any);
                if (resp.error || resp.statusCode !== 200) {
                    console.log("[ERROR] Failed to fetch prices from Lemon Squeezy!\n", resp.error);
                    process.exit(1);
                }
                const pageData = resp.data?.data || [];
                prices.push(...pageData);
                const meta = resp.data?.meta as any;
                const current = meta?.page?.currentPage ?? meta?.page?.current_page ?? page;
                const last = meta?.page?.lastPage ?? meta?.page?.last_page ?? current;
                if (current >= last || pageData.length < size) break;
                page++;
            }
        }
        console.log(`[LOG] Found ${prices.length} prices in Lemon Squeezy`);

        // Fetch all variants (to map product -> variant -> price reliably)
        console.log('[LOG] Fetching variants from Lemon Squeezy...');
        const variants: any[] = [];
        {
            let page = 1;
            const size = 100;
            while (true) {
                const resp = await listVariants({ page: { number: page, size } } as any);
                if (resp.error || resp.statusCode !== 200) {
                    console.log("[ERROR] Failed to fetch variants from Lemon Squeezy!\n", resp.error);
                    process.exit(1);
                }
                const pageData = resp.data?.data || [];
                variants.push(...pageData);
                const meta = resp.data?.meta as any;
                const current = meta?.page?.currentPage ?? meta?.page?.current_page ?? page;
                const last = meta?.page?.lastPage ?? meta?.page?.last_page ?? current;
                if (current >= last || pageData.length < size) break;
                page++;
            }
        }
        console.log(`[LOG] Found ${variants.length} variants in Lemon Squeezy`);

        // Process products and create in Dodo
        const productsToMigrate: { type: 'one_time_product' | 'subscription_product', data: any, originalProductId: string }[] = [];
        // Store created Dodo product/price IDs for subscription mapping later
        const createdProductsMap = new Map<string, { productId: string, priceId?: string }>();

        for (const product of products) {
            const currency = await getStoreCurrency(product.attributes.store_id);
            // All variants for this product
            const variantsForProduct = variants.filter(v => v.attributes.product_id === parseInt(product.id));
            const variantIds = new Set<number>(variantsForProduct.map(v => parseInt(v.id)));
            // Prices for those variants
            const productPrices = prices.filter(p => p.attributes.variant_id !== null && variantIds.has(p.attributes.variant_id as number));

            // Group prices by category and pick the primary one for each type
            const subscriptionPrices = productPrices.filter(p => p.attributes.category === 'subscription');
            const oneTimePrices = productPrices.filter(p => p.attributes.category === 'one_time');

            // Filter for valid subscription prices (supported intervals and valid price)
            const validSubscriptionPrices = subscriptionPrices.filter(price => {
                const unitPriceCents = convertToCents(price.attributes.unit_price ?? undefined, price.attributes.unit_price_decimal ?? undefined);
                const renewalIntervalUnit = price.attributes.renewal_interval_unit || 'month';
                const billingPeriod: 'monthly' | 'yearly' | null =
                    renewalIntervalUnit.toLowerCase() === 'month' ? 'monthly' :
                        renewalIntervalUnit.toLowerCase() === 'year' ? 'yearly' : null;

                return unitPriceCents > 0 && billingPeriod !== null;
            });

            // Priority: If product has valid subscription prices, create subscription product
            // Otherwise, fall back to one-time product if available
            if (validSubscriptionPrices.length > 0) {
                // This is a valid subscription product - create subscription version
                const price = validSubscriptionPrices[0]; // Take the first valid subscription price
                const unitPriceCents = convertToCents(price.attributes.unit_price ?? undefined, price.attributes.unit_price_decimal ?? undefined);
                const renewalIntervalUnit = price.attributes.renewal_interval_unit || 'month';
                const renewalIntervalQuantity = price.attributes.renewal_interval_quantity || 1;

                const billingPeriod: 'monthly' | 'yearly' | null =
                    renewalIntervalUnit.toLowerCase() === 'month' ? 'monthly' :
                        renewalIntervalUnit.toLowerCase() === 'year' ? 'yearly' : null;

                // Determine a safe evergreen subscription term capped at Dodo's 20-year maximum
                const subscriptionIntervalUnit = mapIntervalUnit(renewalIntervalUnit);
                const maxByInterval: Record<string, number> = { Year: 20, Month: 240, Week: 1040, Day: 7300 };
                const evergreenDesiredCount = 240; // 20 years desired evergreen
                const subscriptionPeriodCount = Math.min(evergreenDesiredCount, maxByInterval[subscriptionIntervalUnit] ?? evergreenDesiredCount);

                productsToMigrate.push({
                    type: 'subscription_product',
                    data: {
                        name: product.attributes.name,
                        tax_category: 'saas',
                        price: {
                            currency: currency as any,
                            price: unitPriceCents,
                            discount: 0,
                            purchasing_power_parity: false,
                            type: 'recurring_price',
                            billing_period: billingPeriod,
                            payment_frequency_interval: mapIntervalUnit(renewalIntervalUnit),
                            payment_frequency_count: renewalIntervalQuantity,
                            subscription_period_interval: mapIntervalUnit(renewalIntervalUnit),
                            subscription_period_count: subscriptionPeriodCount
                        },
                        brand_id: brand_id
                    },
                    originalProductId: product.id
                });
                console.log(`[LOG] Created subscription product for: ${product.attributes.name} (${currency} ${(unitPriceCents / 100).toFixed(2)}/${renewalIntervalUnit})`);
            } else if (oneTimePrices.length > 0) {
                // This is a one-time product - only create one-time version
                const price = oneTimePrices[0]; // Take the first one-time price
                const unitPriceCents = convertToCents(price.attributes.unit_price ?? undefined, price.attributes.unit_price_decimal ?? undefined);

                if (unitPriceCents > 0) {
                    productsToMigrate.push({
                        type: 'one_time_product',
                        data: {
                            name: product.attributes.name,
                            tax_category: 'saas',
                            price: {
                                currency: currency as any,
                                price: unitPriceCents,
                                discount: 0,
                                purchasing_power_parity: false,
                                type: 'one_time_price'
                            },
                            brand_id: brand_id
                        },
                        originalProductId: product.id
                    });
                    console.log(`[LOG] Created one-time product for: ${product.attributes.name} (${currency} ${(unitPriceCents / 100).toFixed(2)})`);
                }
            }

            // If no valid prices found, skip this product
            if (validSubscriptionPrices.length === 0 && oneTimePrices.length === 0) {
                console.log(`[WARNING] No valid prices found for product ${product.attributes.name}, skipping`);
            } else if (subscriptionPrices.length > 0 && validSubscriptionPrices.length === 0) {
                console.log(`[WARNING] Product ${product.attributes.name} has subscription prices but none with supported intervals (monthly/yearly), falling back to one-time product`);
            }
        }

        console.log('\n[LOG] These are the products to be migrated:');
        productsToMigrate.forEach((product, index) => {
            const priceAmount = (product.data.price.price / 100).toFixed(2);
            const isSubscription = product.type === 'subscription_product';
            const kind = isSubscription ? 'Subscription' : 'One Time';
            const billingSuffix = isSubscription ? ` (${product.data.price.billing_period})` : '';
            console.log(`${index + 1}. ${product.data.name} - ${product.data.price.currency} ${priceAmount} (${kind}${billingSuffix})`);
        });

        const migrateProducts = await select({
            message: 'Proceed to create these products in Dodo Payments?',
            choices: [
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            ],
        });

        if (migrateProducts === 'yes') {
            let successCount = 0;
            let errorCount = 0;
            // Map filled as products are created

            for (let product of productsToMigrate) {
                console.log();
                try {
                    const createdProduct: any = await (client as any).products.create(product.data);
                    const productId: string = createdProduct.product_id || createdProduct.id;
                    let priceId: string | undefined =
                        createdProduct.price_id ||
                        createdProduct.default_price_id ||
                        createdProduct.price?.price_id ||
                        (createdProduct.prices && createdProduct.prices[0]?.price_id) ||
                        undefined;

                    // Store mapping for subscriptions; key uses product ID for reliable lookup
                    const key = `${product.originalProductId}_${product.type}`;
                    createdProductsMap.set(key, { productId, priceId });

                    console.log(`[LOG] Migration for product: ${createdProduct.name} completed (Dodo Payments product ID: ${productId}${priceId ? ", price ID: " + priceId : ''})`);
                    successCount++;
                } catch (error: any) {
                    errorCount++;
                    console.log(`[ERROR] Failed to migrate product: ${product.data.name}`);
                    console.log(`[ERROR] Error details: ${error.message || error.toString()}`);
                }
            }

            console.log(`\n[LOG] Migration completed! Success: ${successCount}, Errors: ${errorCount}`);
            if (errorCount > 0) {
                console.log(`[LOG] ${errorCount} product(s) failed to migrate. Check error messages above for details.`);
            }
        } else {
            console.log('[LOG] Migration aborted by user');
            process.exit(0);
        }

        // -----------------------------
        // Subscription Migration
        // -----------------------------

        const includeSubscriptions = argv['include-subscriptions'] || false;

        if (includeSubscriptions) {
            console.log('\n[LOG] Starting subscription migration...');

            try {
                console.log('[LOG] Fetching subscriptions from Lemon Squeezy...');
                const allSubscriptions: any[] = [];
                {
                    let page = 1;
                    const size = 100;
                    while (true) {
                        const resp = await listSubscriptions({ page: { number: page, size } } as any);
                        if (resp.error || resp.statusCode !== 200) {
                            console.log('[ERROR] Failed to fetch subscriptions from Lemon Squeezy!\n', resp.error);
                            process.exit(1);
                        }
                        const pageData = resp.data?.data || [];
                        allSubscriptions.push(...pageData);
                        const meta = resp.data?.meta as any;
                        const current = meta?.page?.currentPage ?? meta?.page?.current_page ?? page;
                        const last = meta?.page?.lastPage ?? meta?.page?.last_page ?? current;
                        if (current >= last || pageData.length < size) break;
                        page++;
                    }
                }
                const rawSubscriptions: any[] = allSubscriptions;
                console.log(`[LOG] Found ${rawSubscriptions.length} subscriptions in Lemon Squeezy`);

                const activeSubscriptions = rawSubscriptions.filter(sub =>
                    ['active', 'on_trial', 'paused'].includes(sub.attributes.status)
                );
                console.log(`[LOG] Found ${activeSubscriptions.length} active subscriptions to migrate`);

                if (activeSubscriptions.length === 0) {
                    console.log('[LOG] No active subscriptions to migrate');
                } else {
                    console.log('\n[LOG] These are the subscriptions to be migrated:');
                    activeSubscriptions.forEach((sub, index) => {
                        console.log(`${index + 1}. ${sub.attributes.product_name} - ${sub.attributes.user_email} (${sub.attributes.status})`);
                    });

                    const migrateSubscriptions = await select({
                        message: 'Proceed to migrate these subscriptions to Dodo Payments?',
                        choices: [
                            { name: 'Yes', value: 'yes' },
                            { name: 'No', value: 'no' }
                        ],
                    });

                    if (migrateSubscriptions === 'yes') {
                        console.log('\n[LOG] Migrating subscriptions...');

                        // Build product mapping from actually created Dodo products
                        // createdProductsMap was populated during product creation

                        let subscriptionSuccessCount = 0;
                        let subscriptionErrorCount = 0;

                        for (const subscription of activeSubscriptions) {
                            try {
                                console.log(`[LOG] Processing subscription: ${subscription.attributes.product_name} for ${subscription.attributes.user_email}`);

                                // Find matching migrated product using product ID for reliable lookup
                                const productKey = `${String(subscription.attributes.product_id)}_subscription_product`;
                                const mapped = createdProductsMap.get(productKey);
                                const mappedProductId: string | undefined = mapped?.productId;
                                const mappedPriceId: string | undefined = mapped?.priceId;

                                if (!mappedProductId) {
                                    console.log(`[WARNING] No migrated product found for subscription: ${subscription.attributes.product_name}. Skipping.`);
                                    subscriptionErrorCount++;
                                    continue;
                                }

                                // Fetch customer data for billing address
                                let customerData: any = {};
                                try {
                                    const customerResponse = await getCustomer(subscription.attributes.customer_id);
                                    if (customerResponse.error || customerResponse.statusCode !== 200) {
                                        console.log(`[WARNING] Failed to fetch customer data for ${subscription.attributes.user_email}, using fallback billing address`);
                                    } else {
                                        const attrs = customerResponse?.data?.data?.attributes || {};
                                        customerData = {
                                            city: (attrs as any).city,
                                            country: (attrs as any).country,
                                            region: (attrs as any).region,
                                            address_line_1: (attrs as any).address_line_1 || (attrs as any).address,
                                            postal_code: (attrs as any).postal_code || (attrs as any).zip
                                        };
                                    }
                                } catch (error: any) {
                                    console.log(`[WARNING] Error fetching customer data for ${subscription.attributes.user_email}: ${error.message || error}, using fallback billing address`);
                                }

                                // Transform subscription data
                                const dodoSubscription = {
                                    billing: {
                                        city: customerData.city || 'Unknown',
                                        country: customerData.country || 'US',
                                        state: customerData.region || 'Unknown',
                                        street: customerData.address_line_1 || customerData.address || 'Unknown',
                                        zipcode: customerData.postal_code || customerData.zip || '00000'
                                    },
                                    customer: {
                                        email: subscription.attributes.user_email,
                                        name: subscription.attributes.user_name || subscription.attributes.user_email
                                    },
                                    product_id: mappedProductId,
                                    quantity: 1,
                                    ...(mappedPriceId && { price_id: mappedPriceId }),
                                    metadata: {
                                        lemon_squeezy_subscription_id: subscription.id,
                                        lemon_squeezy_customer_id: String(subscription.attributes.customer_id),
                                        original_status: subscription.attributes.status,
                                        billing_anchor: String(subscription.attributes.billing_anchor)
                                    }
                                };

                                try {
                                    const created: any = await (client as any).subscriptions.create(dodoSubscription as any);
                                    console.log(`[LOG] Subscription created: ${subscription.attributes.user_email} -> product ${mappedProductId} (Dodo subscription ID: ${created.subscription_id || 'unknown'})`);
                                    subscriptionSuccessCount++;
                                } catch (e: any) {
                                    subscriptionErrorCount++;
                                    console.log(`[ERROR] Failed to create subscription in Dodo for ${subscription.attributes.user_email}: ${e?.message || e}`);
                                    continue;
                                }

                            } catch (error: any) {
                                subscriptionErrorCount++;
                                console.log(`[ERROR] Failed to migrate subscription: ${subscription.attributes.product_name}`);
                                console.log(`[ERROR] Error details: ${error.message || error.toString()}`);
                            }
                        }

                        console.log(`\n[LOG] Subscription migration completed! Success: ${subscriptionSuccessCount}, Errors: ${subscriptionErrorCount}`);
                        if (subscriptionErrorCount > 0) {
                            console.log(`[LOG] ${subscriptionErrorCount} subscription(s) failed to migrate. Check error messages above for details.`);
                        }
                    } else {
                        console.log('[LOG] Subscription migration aborted by user');
                    }
                }

            } catch (error: any) {
                console.log('[ERROR] Subscription migration failed:', error.message || error.toString());
            }
        }

        // -----------------------------
        // Coupons (Discounts) Migration
        // -----------------------------

        console.log('\n[LOG] Fetching discounts (coupons) from Lemon Squeezy...');
        const rawDiscounts: any[] = [];
        {
            let page = 1;
            const size = 100;
            while (true) {
                const resp = await listDiscounts({ page: { number: page, size } } as any);
                if (resp.error || resp.statusCode !== 200) {
                    console.log('[ERROR] Failed to fetch discounts from Lemon Squeezy!\n', resp.error);
                    process.exit(1);
                }
                const pageData = resp.data?.data || [];
                rawDiscounts.push(...pageData);
                const meta = resp.data?.meta as any;
                const current = meta?.page?.currentPage ?? meta?.page?.current_page ?? page;
                const last = meta?.page?.lastPage ?? meta?.page?.last_page ?? current;
                if (current >= last || pageData.length < size) break;
                page++;
            }
        }
        console.log(`[LOG] Found ${rawDiscounts.length} discounts in Lemon Squeezy`);

        const publishedDiscounts = rawDiscounts.filter((d: any) => {
            const status = d?.attributes?.status || d?.attributes?.state;
            return status === 'active' || status === 'published' || status === 'enabled';
        });
        console.log(`[LOG] Considering ${publishedDiscounts.length} published/active discounts`);

        if (publishedDiscounts.length === 0) {
            console.log('[LOG] No eligible discounts (coupons) to migrate.');
            return;
        }

        console.log('\n[LOG] These are the coupons to be migrated:');
        publishedDiscounts.forEach((c, index) => {
            const attrs = c?.attributes || {};
            const discountType = (attrs.discount_type || attrs.type || '').toString();
            const isPercentage = discountType.includes('percent');
            const amount = Number(attrs.amount) || 0;

            if (isPercentage) {
                console.log(`${index + 1}. ${attrs.code || attrs.name} - ${amount}% off`);
            } else {
                console.log(`${index + 1}. ${attrs.code || attrs.name} - ${(amount / 100).toFixed(2)} off`);
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
            console.log('\n[LOG] Coupon migration simulated - Dodo Payments coupon API not yet available');
            for (const c of publishedDiscounts) {
                console.log(`[LOG] Coupon migration simulated for: ${c.attributes?.code || c.attributes?.name}`);
            }
            console.log('\n[LOG] All coupons processed.');
        } else {
            console.log('[LOG] Coupon migration aborted by user');
        }
    }
}