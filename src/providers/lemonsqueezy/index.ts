import { listProducts, lemonSqueezySetup, getStore, Store, listDiscounts, listCustomers, listLicenseKeys, listVariants, listPrices } from '@lemonsqueezy/lemonsqueezy.js';
import { input, select, checkbox } from '@inquirer/prompts';
import { logger } from '../../utils/logger';
import { delay, type LicenseKeyToMigrate } from '../../utils/common';
import { getDodoCredentials, setupDodoClient, selectDodoBrand } from '../../utils/dodo';
import { ProductCreateParams } from 'dodopayments/resources';
import { Product } from 'dodopayments/resources.js';

// This will be used for caching product information when required
const DodoPaymentsProductCache: Record<string, Product> = {};

// Lemon Squeezy returns only 10 items per page by default, so every list call must paginate explicitly.
const LS_PAGE_SIZE = 100;

type LemonSqueezyInterval = 'day' | 'week' | 'month' | 'year';

type LemonSqueezyPagedResponse<T> = {
    statusCode: number | null;
    error: Error | null;
    data: { data: T[]; meta?: { page?: { lastPage?: number } } } | null;
};

/**
 * Collects every page of a paginated Lemon Squeezy list endpoint.
 * Exits the process on the first failed request, matching how the rest of this provider handles fetch errors.
 */
async function fetchAllPages<T>(
    label: string,
    fetchPage: (page: { number: number; size: number }) => Promise<LemonSqueezyPagedResponse<T>>
): Promise<T[]> {
    const allItems: T[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
        // 5 req/s = 200ms delay
        await delay(200);
        const response = await fetchPage({ number: currentPage, size: LS_PAGE_SIZE });

        if (response.error || response.statusCode !== 200 || !response.data) {
            logger.error(`Failed to fetch ${label} from Lemon Squeezy!`, response.error);
            process.exit(1);
        }

        allItems.push(...response.data.data);

        const lastPage = response.data.meta?.page?.lastPage ?? currentPage;
        hasMorePages = currentPage < lastPage;
        currentPage++;
    }

    return allItems;
}

// Dodo Payments' TimeInterval values for each Lemon Squeezy interval unit
const DODO_INTERVAL_MAP: Record<LemonSqueezyInterval, 'Day' | 'Week' | 'Month' | 'Year'> = {
    day: 'Day',
    week: 'Week',
    month: 'Month',
    year: 'Year'
};

const DAYS_PER_INTERVAL: Record<LemonSqueezyInterval, number> = {
    day: 1,
    week: 7,
    month: 30,
    year: 365
};

type SubscriptionPricing = {
    unitPrice: number;
    interval: LemonSqueezyInterval;
    intervalCount: number;
    trialDays: number;
};

const DODO_PAGE_SIZE = 100;

/**
 * Finds the products in Dodo Payments that an earlier run already migrated, keyed by their Lemon Squeezy product ID.
 * The link is `metadata.ls_product_id`, which this provider stamps on every product it creates.
 *
 * If the same Lemon Squeezy product was migrated more than once (for example by an older, non-idempotent run),
 * the oldest Dodo product wins so repeated runs always resolve to the same one.
 */
async function fetchMigratedDodoProducts(client: ReturnType<typeof setupDodoClient>, brandId: string): Promise<Map<string, { productId: string; name: string }>> {
    const migrated = new Map<string, { productId: string; name: string; createdAt: string }>();
    const duplicates = new Set<string>();

    try {
        let page = await client.products.list({ brand_id: brandId, page_size: DODO_PAGE_SIZE });
        while (true) {
            for (const product of page.items) {
                const rawLsProductId = product.metadata?.ls_product_id;
                if (rawLsProductId === undefined || rawLsProductId === null || rawLsProductId === '') continue;
                const lsProductId = String(rawLsProductId);

                const existing = migrated.get(lsProductId);
                if (existing) {
                    duplicates.add(lsProductId);
                    if (product.created_at >= existing.createdAt) continue;
                }
                migrated.set(lsProductId, { productId: product.product_id, name: product.name || '', createdAt: product.created_at });
            }

            if (!page.hasNextPage()) break;
            // 10 req/s = 100ms delay
            await delay(100);
            page = await page.getNextPage();
        }
    } catch (error: any) {
        logger.error('Failed to list existing products from Dodo Payments!', error?.message ?? error);
        process.exit(1);
    }

    if (duplicates.size > 0) {
        logger.warn(`${duplicates.size} Lemon Squeezy product(s) already exist more than once in Dodo Payments (left over from earlier runs). The oldest copy of each is used; the extra copies are not touched and can be archived manually.`);
    }

    return new Map([...migrated].map(([lsId, { productId, name }]) => [lsId, { productId, name }]));
}

/**
 * Lists every customer in Dodo Payments, keyed by lowercased email, so license keys can be attached
 * to customers created by an earlier run.
 */
async function fetchDodoCustomersByEmail(client: ReturnType<typeof setupDodoClient>): Promise<Map<string, string>> {
    const customersByEmail = new Map<string, string>();

    try {
        let page = await client.customers.list({ page_size: DODO_PAGE_SIZE });
        while (true) {
            for (const customer of page.items) {
                const email = customer.email?.trim().toLowerCase();
                if (email && !customersByEmail.has(email)) {
                    customersByEmail.set(email, customer.customer_id);
                }
            }

            if (!page.hasNextPage()) break;
            // 10 req/s = 100ms delay
            await delay(100);
            page = await page.getNextPage();
        }
    } catch (error: any) {
        logger.error('Failed to list existing customers from Dodo Payments!', error?.message ?? error);
        process.exit(1);
    }

    return customersByEmail;
}

/**
 * A Lemon Squeezy product object carries no subscription information. That lives on its variants and their prices,
 * so we look at the product's default (first non-draft) variant and its price to decide whether it is a subscription.
 *
 * Returns:
 *  - `null` if the product is not a subscription (it keeps being migrated as a one-time product)
 *  - `'unsupported'` if it is a subscription that cannot be represented as a Dodo recurring price (it is skipped)
 *  - the pricing details otherwise
 */
async function getSubscriptionPricing(productId: string, productName: string): Promise<SubscriptionPricing | null | 'unsupported'> {
    // 5 req/s = 200ms delay
    await delay(200);
    const variantsResponse = await listVariants({
        filter: { productId },
        page: { number: 1, size: LS_PAGE_SIZE }
    });
    if (variantsResponse.error || variantsResponse.statusCode !== 200) {
        logger.error(`Failed to fetch variants for product ${productId}`, variantsResponse.error);
        process.exit(1);
    }

    // Variants are returned ordered by `sort`. Draft variants are not purchasable, so ignore them.
    const variants = variantsResponse.data.data.filter((variant) => variant.attributes.status !== 'draft');
    const defaultVariant = variants[0];
    if (!defaultVariant) {
        return null;
    }

    // 5 req/s = 200ms delay
    await delay(200);
    const pricesResponse = await listPrices({
        filter: { variantId: defaultVariant.id },
        page: { number: 1, size: LS_PAGE_SIZE }
    });
    if (pricesResponse.error || pricesResponse.statusCode !== 200) {
        logger.error(`Failed to fetch prices for variant ${defaultVariant.id} of product ${productId}`, pricesResponse.error);
        process.exit(1);
    }

    const price = pricesResponse.data.data.find((p) => p.attributes.category === 'subscription');
    if (!price) {
        return null;
    }

    if (variants.length > 1) {
        logger.warn(`Product "${productName}" has ${variants.length} variants. Only its default variant ("${defaultVariant.attributes.name}") will be migrated.`);
    }

    const attrs = price.attributes;
    const interval = attrs.renewal_interval_unit;
    const intervalCount = attrs.renewal_interval_quantity;

    if (!interval || !(interval in DODO_INTERVAL_MAP) || !intervalCount || intervalCount < 1) {
        logger.warn(`Subscription product "${productName}" has no usable billing interval (${interval} x ${intervalCount}) - skipping`);
        return 'unsupported';
    }

    // Usage-based and tiered prices have no single fixed amount, so they cannot be mapped to a recurring price
    if (attrs.usage_aggregation || attrs.scheme !== 'standard' || attrs.unit_price === null || attrs.unit_price === undefined) {
        logger.warn(`Subscription product "${productName}" uses usage-based or tiered pricing (${attrs.scheme}), which cannot be migrated - skipping`);
        return 'unsupported';
    }

    const trialDays = attrs.trial_interval_unit && attrs.trial_interval_quantity
        ? attrs.trial_interval_quantity * DAYS_PER_INTERVAL[attrs.trial_interval_unit]
        : 0;

    return {
        unitPrice: attrs.unit_price,
        interval,
        intervalCount,
        trialDays
    };
}

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
                choices: ['test_mode', 'live_mode'],
                demandOption: false
            })
            .option('types', {
                describe: 'Migration types (comma-separated)',
                type: 'string',
                demandOption: false
            })
            .option('include-inactive-licenses', {
                describe: 'Also migrate expired and disabled license keys (they are skipped by default). Disabled keys are created and then disabled in Dodo Payments; expired keys keep their expiry date.',
                type: 'boolean',
                default: false,
                demandOption: false
            });
    },
    handler: async (argv: any) => {
        // Store the details of the API keys and mode, and prompt the user if they fail to provide it in the CLI
        // Store the details of the API keys and mode, and prompt the user if they fail to provide it in the CLI
        const PROVIDER_API_KEY = argv['provider-api-key'] || await input({ message: 'Enter your Lemon Squeezy API Key:', required: true });

        const { apiKey: DODO_API_KEY, mode: MODE } = await getDodoCredentials(argv);

        // Determine migration types
        let migrationTypes: string[] = [];
        if (argv['types']) {
            migrationTypes = argv['types'].split(',').map((type: string) => type.trim());
        } else {
            migrationTypes = await checkbox({
                message: 'Select what you want to migrate:',
                choices: [
                    { name: 'Products', value: 'products', checked: true },
                    { name: 'Coupons/Discounts', value: 'coupons', checked: true },
                    { name: 'Customers', value: 'customers', checked: true },
                    { name: 'License Keys', value: 'license_keys', checked: true }
                ],
                required: true
            });
        }

        // Set up the Lemon Squeezy SDK
        lemonSqueezySetup({
            apiKey: PROVIDER_API_KEY,
            onError: (error) => {
                logger.error("Failed to set up Lemon Squeezy!", error.cause);
                process.exit(1);
            },
        });

        // Set up the Dodo Payments sdk
        // Set up the Dodo Payments sdk
        const client = setupDodoClient(DODO_API_KEY, MODE);

        // This variable will store the brand ID to be used for creating products in a specific Dodo Payments brand
        const brand_id = await selectDodoBrand(client, argv);

        // This stores the data of the Lemon Squeezy stores. This is used to determine the currency.
        // I've cached this object to prevent rate limiting issues when dealing with multiple Lemon Squeezy products.
        const StoresData: Record<string, Store> = {};

        const Products: { type: 'one_time_product' | 'subscription_product', data: ProductCreateParams, ls_product_id: string }[] = [];
        const Coupons: { data: any }[] = [];

        let completedProducts = false;
        let completedCoupons = false;
        let completedCustomers = false;
        let completedLicenseKeys = false;

        const productIdMap = new Map<string, string>();
        const customerIdMap = new Map<string, string>();

        // Expired and disabled license keys are skipped unless the merchant explicitly asks for them
        const includeInactiveLicenses = Boolean(argv['include-inactive-licenses']);

        // Migrate products if selected
        if (migrationTypes.includes('products')) {
            logger.log('\nStarting products migration...');

            // List every page of products from the Lemon Squeezy SDK
            const lemonSqueezyProducts = await fetchAllPages('products', (page) => listProducts({ page }));

            logger.log('Found ' + lemonSqueezyProducts.length + ' products in Lemon Squeezy');

            // Products created by an earlier run are recognised by metadata.ls_product_id, so running the tool again never creates copies
            const alreadyMigratedProducts = await fetchMigratedDodoProducts(client, brand_id);
            let alreadyMigratedCount = 0;

            // Iterate the products
            for (let product of lemonSqueezyProducts) {
                const alreadyMigrated = alreadyMigratedProducts.get(String(product.id));
                if (alreadyMigrated) {
                    logger.log(`Skipping product: ${product.attributes.name} - already migrated (Dodo Payments product ID: ${alreadyMigrated.productId})`);
                    productIdMap.set(String(product.id), alreadyMigrated.productId);
                    alreadyMigratedCount++;
                    continue;
                }

                // This will contain the store information of the current product. This information is crucial to determine the currency of the product.
                // Do not confuse this with StoresData which is the cache of all stores
                let StoreData: null | Store = null;

                // If the store data is not already fetched, fetch it
                if (!StoresData[product.attributes.store_id]) {
                    logger.log(`Fetching store data for store ID ${product.attributes.store_id}`);

                    // Fetch the store data from Lemon Squeezy
                    // 5 req/s = 200ms delay
                    await delay(200);
                    const FetchStoreData = await getStore(product.attributes.store_id);
                    if (FetchStoreData.error || FetchStoreData.statusCode !== 200) {
                        logger.error(`Failed to fetch store data for store ID ${product.attributes.store_id}`, FetchStoreData.error);
                        process.exit(1);
                    }
                    // If the store data is fetched and cached, use it
                    StoresData[product.attributes.store_id] = FetchStoreData.data;
                    // Store the currently fetched data in the local StoreData variable to access the current store information below
                    StoreData = FetchStoreData.data;
                } else {
                    logger.log(`Using cached store data for store ID ${product.attributes.store_id}`);
                    StoreData = StoresData[product.attributes.store_id];
                }

                // Work out whether this is a subscription. If it is, build a recurring price with the correct interval.
                const subscriptionPricing = await getSubscriptionPricing(String(product.id), product.attributes.name);

                if (subscriptionPricing === 'unsupported') {
                    continue;
                }

                if (subscriptionPricing) {
                    Products.push({
                        type: 'subscription_product',
                        ls_product_id: String(product.id),
                        data: {
                            name: product.attributes.name,
                            tax_category: 'saas',
                            price: {
                                currency: StoreData.data.attributes.currency as any,
                                price: subscriptionPricing.unitPrice,
                                discount: 0,
                                purchasing_power_parity: false,
                                type: 'recurring_price',
                                payment_frequency_interval: DODO_INTERVAL_MAP[subscriptionPricing.interval],
                                payment_frequency_count: subscriptionPricing.intervalCount,
                                // Dodo Payments recommends a 20 year subscription period so the subscription renews until cancelled
                                subscription_period_interval: 'Year',
                                subscription_period_count: 20,
                                ...(subscriptionPricing.trialDays > 0 ? { trial_period_days: subscriptionPricing.trialDays } : {})
                            },
                            brand_id: brand_id,
                            metadata: {
                                ls_product_id: String(product.id),
                                migrated_from: 'lemonsqueezy',
                                migrated_at: new Date().toISOString()
                            },
                        }
                    });
                    continue;
                }

                Products.push({
                    type: 'one_time_product',
                    ls_product_id: String(product.id),
                    data: {
                        name: product.attributes.name,
                        tax_category: 'saas',
                        price: {
                            currency: StoreData.data.attributes.currency as any,
                            price: product.attributes.price,
                            discount: 0,
                            purchasing_power_parity: false,
                            type: 'one_time_price'
                        },
                        brand_id: brand_id,
                        metadata: {
                            ls_product_id: String(product.id),
                            migrated_from: 'lemonsqueezy',
                            migrated_at: new Date().toISOString()
                        },
                    }
                });
            }

            if (alreadyMigratedCount > 0) {
                logger.log(`${alreadyMigratedCount} product(s) were already migrated by an earlier run and will not be created again.`);
            }

            if (Products.length > 0) {
                logger.log('These are the products to be migrated:');
            } else {
                logger.log('No new products to migrate.');
            }
            Products.forEach((product, index) => {
                let typeLabel = 'Unknown';
                if (product.type === 'one_time_product') {
                    typeLabel = 'One Time';
                } else if (product.type === 'subscription_product') {
                    const recurringPrice = product.data.price as { payment_frequency_count: number; payment_frequency_interval: string };
                    typeLabel = `Subscription, every ${recurringPrice.payment_frequency_count} ${recurringPrice.payment_frequency_interval.toLowerCase()}(s)`;
                }
                logger.log(`${index + 1}. ${product.data.name} - ${product.data.price.currency} ${((product.data.price as any).price / 100).toFixed(2)} (${typeLabel})`);
            });

            // Ask the user for final confirmation before creating the products in Dodo Payments
            // Nothing to confirm when every product already exists in Dodo Payments
            const migrateProducts = Products.length === 0 ? 'yes' : await select({
                message: 'Proceed to create these products in Dodo Payments?',
                choices: [
                    { name: 'Yes', value: 'yes' },
                    { name: 'No', value: 'no' }
                ],
            });

            if (migrateProducts === 'yes') {
                for (let product of Products) {
                    logger.log('');
                    if (product.type === 'one_time_product' || product.type === 'subscription_product') {
                        logger.log(`Migrating product: ${product.data.name}`);
                        await delay(100);
                        const createdProduct = await client.products.create(product.data);
                        productIdMap.set(product.ls_product_id, createdProduct.product_id);
                        logger.success(`Migration for product: ${createdProduct.name} completed (Dodo Payments product ID: ${createdProduct.product_id})`);
                    } else {
                        logger.log(`Skipping product: ${product.data.name} for unknown product type (example one time, subscription, etc)`);
                    }
                }
                if (Products.length > 0 || alreadyMigratedCount > 0) {
                    logger.success('All products migrated successfully!');
                    completedProducts = true;
                }
            } else {
                logger.log('Products migration aborted by user');
            }
        }

        // Migrate coupons if selected
        if (migrationTypes.includes('coupons')) {
            logger.log('\nStarting coupons migration...');

            // List every page of discounts from the Lemon Squeezy SDK
            const lemonSqueezyDiscounts = await fetchAllPages('discounts', (page) => listDiscounts({ page }));

            logger.log('Found ' + lemonSqueezyDiscounts.length + ' discounts in Lemon Squeezy');

            // Filter only published discounts
            const validDiscounts = lemonSqueezyDiscounts.filter((discount: any) =>
                discount.attributes.status === 'published'
            );

            logger.log('Found ' + validDiscounts.length + ' valid (published) discounts');

            // Process each discount
            for (let discount of validDiscounts) {
                // Only process percentage discounts - Dodo Payments SDK doesn't support fixed amount discounts
                if (discount.attributes.amount_type === 'percent') {
                    let subscriptionCycles: number | null = null;
                    const lsDuration = discount.attributes.duration;

                    if (lsDuration === 'once') {
                        // "Once" means it applies to 1 cycle
                        subscriptionCycles = 1;
                    } else if (lsDuration === 'repeating') {
                        // "Repeating" uses the specific number of months from Lemon Squeezy
                        const durationMonths = discount.attributes.duration_in_months;
                        if (typeof durationMonths !== 'number' || durationMonths <= 0) {
                            logger.warn(`Invalid duration_in_months (${durationMonths}) for discount "${discount.attributes.name}" - skipping`);
                            continue;
                        }
                        subscriptionCycles = durationMonths;
                    } else if (lsDuration === 'forever') {
                        // "Forever" is represented by null or undefined in Dodo
                        subscriptionCycles = null;
                    }
                    const discountData = {
                        name: discount.attributes.name,
                        code: discount.attributes.code,
                        type: 'percentage',
                        // * 100 to normalize the percentage value for Dodo Payments sdk
                        amount: discount.attributes.amount * 100,
                        usage_limit: discount.attributes.is_limited_redemptions ? discount.attributes.max_redemptions : null,
                        expires_at: discount.attributes.expires_at,
                        brand_id: brand_id,
                        subscription_cycles: subscriptionCycles
                    };

                    Coupons.push({ data: discountData });
                } else {
                    // Show warning for fixed amount discounts that cannot be migrated
                    logger.warn(`Skipping fixed amount discount "${discount.attributes.name}" (${discount.attributes.code}) - Dodo Payments SDK doesn't support non-percentage discounts`);
                }
            }

            if (Coupons.length > 0) {
                logger.log('\nThese are the coupons to be migrated:');
                Coupons.forEach((coupon, index) => {
                    // / 100 to normalize the percentage value for display
                    const value = `${coupon.data.amount / 100}%`;
                    const expiry = coupon.data.expires_at ? ` (expires: ${new Date(coupon.data.expires_at).toLocaleDateString()})` : '';
                    const usage = coupon.data.usage_limit ? ` (max uses: ${coupon.data.usage_limit})` : '';
                    logger.log(`${index + 1}. ${coupon.data.name} (${coupon.data.code}) - ${value}${expiry}${usage}`);
                });

                // Ask the user for final confirmation before creating the coupons in Dodo Payments
                const migrateCoupons = await select({
                    message: 'Proceed to create these coupons in Dodo Payments?',
                    choices: [
                        { name: 'Yes', value: 'yes' },
                        { name: 'No', value: 'no' }
                    ],
                });

                if (migrateCoupons === 'yes') {
                    // Track migration results
                    let successCount = 0;
                    let failureCount = 0;

                    // Iterate all the stored coupons and create them in Dodo Payments
                    for (let coupon of Coupons) {
                        logger.log('');
                        logger.log(`Migrating coupon: ${coupon.data.name} (${coupon.data.code})`);
                        try {
                            // Create the coupon in Dodo Payments
                            // 10 req/s = 100ms delay
                            await delay(100);
                            const createdCoupon = await client.discounts.create(coupon.data);
                            logger.success(`Migration for coupon: ${createdCoupon.name} completed (Dodo Payments discount ID: ${createdCoupon.discount_id})`);
                            successCount++;
                        } catch (error) {
                            logger.error(`Failed to migrate coupon: ${coupon.data.name} - ${error}`);
                            failureCount++;
                        }
                    }

                    // Report results based on actual success/failure
                    if (failureCount === 0) {
                        logger.success('All coupons migrated successfully!');
                        completedCoupons = true;
                    } else if (successCount === 0) {
                        logger.error('All coupon migrations failed!');
                    } else {
                        logger.log(`Coupon migration completed with ${successCount} successful and ${failureCount} failed migrations.`);
                    }
                } else {
                    logger.log('Coupons migration aborted by user');
                }
            } else {
                logger.log('No valid coupons found to migrate');
            }
        }

        // Check if the user wants to migrate customers
        if (migrationTypes.includes('customers')) {
            // Set the current page to 1
            let currentPage = 1;

            // Fetch the first page of customers. This will fetch all the crucial info from LemonSqueezy.
            const customers = await listCustomers({
                page: {
                    number: currentPage,
                    size: 100
                }
            });

            // Check the response before reading anything from it
            if (customers.error || customers.statusCode !== 200) {
                logger.error("Failed to fetch customers from Lemon Squeezy!", customers.error);
                process.exit(1);
            }

            logger.log('Found ' + customers.data?.meta.page.total + ' customers in Lemon Squeezy');

            const proceedCustomersMigration = await select({
                message: 'Proceed to migrate customers to Dodo Payments?',
                choices: [
                    { name: 'Yes', value: 'yes' },
                    { name: 'No', value: 'no' }
                ],
            });

            if (proceedCustomersMigration === 'yes') {
                // Iterate through all the pages of customers
                const lastPage = customers.data?.meta?.page?.lastPage ?? 1;
                // Page 1 is already fetched above, so reuse it instead of requesting it a second time
                let customersNew: Awaited<ReturnType<typeof listCustomers>> = customers;
                while (currentPage <= lastPage) {
                    if (currentPage > 1) {
                        // Fetch the next page of customers
                        // 5 req/s = 200ms delay
                        await delay(200);
                        customersNew = await listCustomers({
                            page: {
                                number: currentPage,
                                size: 100
                            }
                        });

                        if (customersNew.error || customersNew.statusCode !== 200) {
                            logger.error("Failed to fetch customers from Lemon Squeezy!", customersNew.error);
                            process.exit(1);
                        }
                    }

                    for (const user of customersNew.data.data) {
                        await delay(100);
                        const createdCustomer = await client.customers.create({
                            name: user.attributes.name!,
                            email: user.attributes.email!
                        });
                        customerIdMap.set(user.attributes.email!.trim().toLowerCase(), createdCustomer.customer_id);
                    }

                    currentPage++;
                }
                completedCustomers = true;
            } else {
                logger.log('Customers migration aborted by user');
            }
        }

        if (migrationTypes.includes('license_keys')) {
            // License keys do not need products and customers to be migrated in the same session.
            // Products and customers from earlier runs are looked up in Dodo Payments, so an interrupted or resumed migration still works.
            // Entries created or found earlier in this session take precedence over the lookup.
            logger.log('\nLooking up products and customers already in Dodo Payments...');
            const migratedDodoProducts = await fetchMigratedDodoProducts(client, brand_id);
            for (const [lsProductId, { productId }] of migratedDodoProducts) {
                if (!productIdMap.has(lsProductId)) productIdMap.set(lsProductId, productId);
            }
            const dodoCustomersByEmail = await fetchDodoCustomersByEmail(client);
            for (const [email, customerId] of dodoCustomersByEmail) {
                if (!customerIdMap.has(email)) customerIdMap.set(email, customerId);
            }

            if (productIdMap.size === 0 || customerIdMap.size === 0) {
                if (productIdMap.size === 0) {
                    logger.error('No products migrated from Lemon Squeezy were found in Dodo Payments (looked for metadata.ls_product_id in the selected brand).');
                    logger.error('Run the products migration first, and check that the same Dodo brand is selected.');
                }
                if (customerIdMap.size === 0) {
                    logger.error('No customers were found in Dodo Payments. Run the customers migration first.');
                }
                process.exit(1);
            } else {
                logger.log(`Found ${productIdMap.size} migrated product(s) and ${customerIdMap.size} customer(s) in Dodo Payments`);
                logger.log('\nStarting license keys migration...');

                let currentLicensePage = 1;
                let hasMoreLicenses = true;
                const allLicenseKeys: any[] = [];

                while (hasMoreLicenses) {
                    await delay(200);
                    const licenseKeysResponse = await listLicenseKeys({
                        page: { number: currentLicensePage, size: 100 }
                    });

                    if (licenseKeysResponse.error || licenseKeysResponse.statusCode !== 200) {
                        logger.error("Failed to fetch license keys from Lemon Squeezy!", licenseKeysResponse.error);
                        process.exit(1);
                    }

                    if (licenseKeysResponse.data?.data?.length) {
                        allLicenseKeys.push(...licenseKeysResponse.data.data);
                    }

                    const lastPage = licenseKeysResponse.data?.meta?.page?.lastPage ?? currentLicensePage;
                    hasMoreLicenses = currentLicensePage < lastPage;
                    currentLicensePage++;
                }

                logger.log(`Found ${allLicenseKeys.length} license keys in Lemon Squeezy`);

                const licenseKeysToMigrate: LicenseKeyToMigrate[] = [];
                const skippedCounts = { disabled: 0, expired: 0, noMatchingProduct: 0, noMatchingCustomer: 0 };

                let includedInactiveCount = 0;

                for (const lk of allLicenseKeys) {
                    const attrs = lk.attributes;

                    const isDisabledKey = attrs.disabled === 1 || attrs.status === 'disabled';
                    const isExpiredKey = !isDisabledKey && attrs.status === 'expired';

                    // Disabled and expired keys are skipped by default. --include-inactive-licenses opts in to migrating them.
                    if (isDisabledKey && !includeInactiveLicenses) {
                        logger.log(`Skipping disabled license key: ${lk.id}`);
                        skippedCounts.disabled++;
                        continue;
                    }

                    if (isExpiredKey && !includeInactiveLicenses) {
                        logger.log(`Skipping expired license key: ${lk.id}`);
                        skippedCounts.expired++;
                        continue;
                    }

                    const dodoProductId = productIdMap.get(String(attrs.product_id));
                    if (!dodoProductId) {
                        logger.warn(`License key ${lk.id}: no matching Dodo product for LS product ${attrs.product_id}. Skipping.`);
                        skippedCounts.noMatchingProduct++;
                        continue;
                    }

                    const normalizedEmail = attrs.user_email?.trim().toLowerCase();
                    const dodoCustomerId = normalizedEmail ? customerIdMap.get(normalizedEmail) : undefined;
                    if (!dodoCustomerId) {
                        logger.warn(`License key ${lk.id}: no matching Dodo customer for email ${attrs.user_email}. Skipping.`);
                        skippedCounts.noMatchingCustomer++;
                        continue;
                    }

                    const activationsLimit = attrs.activation_limit === 0 ? null : attrs.activation_limit;

                    if (isDisabledKey || isExpiredKey) {
                        includedInactiveCount++;
                    }

                    // An expired key with no expiry date would be created as a key that never expires, so stamp it as expired now
                    const expiresAt = attrs.expires_at || (isExpiredKey ? new Date().toISOString() : null);

                    licenseKeysToMigrate.push({
                        key: attrs.key,
                        dodo_customer_id: dodoCustomerId,
                        dodo_product_id: dodoProductId,
                        activations_limit: activationsLimit,
                        expires_at: expiresAt,
                        // Dodo Payments cannot create a key in a disabled state, so disabled keys are disabled right after creation
                        disabled: isDisabledKey,
                        source_key_id: String(lk.id),
                        display_key: `****${attrs.key.slice(-6)}`,
                        product_name: `Product ${attrs.product_id}`,
                        customer_email: attrs.user_email
                    });
                }

                // Reported before the "nothing to migrate" check so the reasons are visible even when every key was skipped
                const totalSkipped = skippedCounts.disabled + skippedCounts.expired + skippedCounts.noMatchingProduct + skippedCounts.noMatchingCustomer;
                if (totalSkipped > 0) {
                    logger.warn(`${totalSkipped} license keys were skipped:`);
                    logger.warn(`  - ${skippedCounts.disabled} disabled`);
                    logger.warn(`  - ${skippedCounts.expired} expired`);
                    logger.warn(`  - ${skippedCounts.noMatchingProduct} no matching Dodo product`);
                    logger.warn(`  - ${skippedCounts.noMatchingCustomer} no matching Dodo customer`);
                }

                if (includedInactiveCount > 0) {
                    logger.log(`${includedInactiveCount} expired/disabled license key(s) are included because --include-inactive-licenses was set`);
                }

                if (licenseKeysToMigrate.length === 0) {
                    logger.log('No valid license keys found to migrate.');
                } else {
                    logger.log('\nThese are the license keys to be migrated:');
                    licenseKeysToMigrate.forEach((lk, index) => {
                        const limit = lk.activations_limit !== null ? `${lk.activations_limit} activations` : 'Unlimited';
                        const expiry = lk.expires_at ? new Date(lk.expires_at).toLocaleDateString() : 'Never';
                        const disabledLabel = lk.disabled ? ' - DISABLED' : '';
                        logger.log(`${index + 1}. ${lk.display_key} - ${lk.customer_email} - ${limit} - Expires: ${expiry}${disabledLabel}`);
                    });

                    const migrateLicenseKeysConfirm = await select({
                        message: `Proceed to create ${licenseKeysToMigrate.length} license keys in Dodo Payments?`,
                        choices: [
                            { name: 'Yes', value: 'yes' },
                            { name: 'No', value: 'no' }
                        ],
                    });

                    if (migrateLicenseKeysConfirm === 'yes') {
                        let lkSuccessCount = 0;
                        let lkFailureCount = 0;
                        let lkDuplicateCount = 0;

                        for (const lk of licenseKeysToMigrate) {
                            await delay(100);

                            // What I'm doing here is retriving the product info and caching it to prevent more reads
                            try {
                                let product_info: Product;
                                if (DodoPaymentsProductCache[lk.dodo_product_id]) {
                                    product_info = DodoPaymentsProductCache[lk.dodo_product_id];
                                } else {
                                    const dodoProductData = await client.products.retrieve(lk.dodo_product_id);
                                    DodoPaymentsProductCache[lk.dodo_product_id] = dodoProductData;
                                    product_info = dodoProductData;
                                }

                                // Enable license key for the product so otherwise the migration will fail + update the cache
                                // The reason I'm manually updating the product here is that LemonSqueezy doesn't provide a way to check if a product generates license key or not
                                if (!product_info.license_key_enabled) {
                                    await client.products.update(lk.dodo_product_id, {
                                        license_key_enabled: true
                                    });

                                    logger.log(`Updating created product ${product_info.name} to enable license mode`);

                                    DodoPaymentsProductCache[lk.dodo_product_id].license_key_enabled = true;
                                }

                                const created = await client.licenseKeys.create({
                                    key: lk.key,
                                    customer_id: lk.dodo_customer_id,
                                    product_id: lk.dodo_product_id,
                                    activations_limit: lk.activations_limit,
                                    expires_at: lk.expires_at,
                                });
                                if (lk.disabled) {
                                    try {
                                        await delay(100);
                                        await client.licenseKeys.update(created.id, { disabled: true });
                                    } catch (disableError: any) {
                                        // The key now exists and is active in Dodo, so make this impossible to miss
                                        logger.error(`License key ${lk.display_key} was created in Dodo (ID: ${created.id}) but could NOT be disabled: ${disableError.message}. It is currently active - disable it manually.`);
                                        lkFailureCount++;
                                        continue;
                                    }
                                }
                                logger.success(`Migrated license key: ${lk.display_key} (Dodo ID: ${created.id})${lk.disabled ? ' - disabled' : ''}`);
                                lkSuccessCount++;
                            } catch (error: any) {
                                if (error.status === 409) {
                                    logger.warn(`License key ${lk.display_key} already exists in Dodo. Skipping.`);
                                    lkDuplicateCount++;
                                } else {
                                    logger.error(`Failed to migrate license key ${lk.display_key}: ${error.message}`);
                                    lkFailureCount++;
                                }
                            }
                        }

                        logger.log(`\nLicense keys migration complete: ${lkSuccessCount} succeeded, ${lkDuplicateCount} duplicates skipped, ${lkFailureCount} failed`);
                        if (lkSuccessCount > 0 || lkDuplicateCount > 0) {
                            completedLicenseKeys = true;
                        }
                    } else {
                        logger.log('License keys migration aborted by user');
                    }
                }
            }
        }

        const completedMigrations: string[] = [];
        if (completedProducts) completedMigrations.push('products');
        if (completedCoupons) completedMigrations.push('coupons');
        if (completedCustomers) completedMigrations.push('customers');
        if (completedLicenseKeys) completedMigrations.push('license_keys');

        if (completedMigrations.length > 0) {
            logger.success(`Migration completed for: ${completedMigrations.join(', ')}`);
        }
    }
}
