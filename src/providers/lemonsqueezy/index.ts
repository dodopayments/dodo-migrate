import { listProducts, lemonSqueezySetup, getStore, Store, listDiscounts, listCustomers, listLicenseKeys } from '@lemonsqueezy/lemonsqueezy.js';
import { input, select, checkbox } from '@inquirer/prompts';
import { logger } from '../../utils/logger';
import { delay, type LicenseKeyToMigrate } from '../../utils/common';
import { getDodoCredentials, setupDodoClient, selectDodoBrand } from '../../utils/dodo';

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
                    { name: 'License Keys', value: 'license_keys', checked: false }
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

        const Products: { type: 'one_time_product', data: any, ls_product_id: string }[] = [];
        const Coupons: { data: any }[] = [];

        let completedProducts = false;
        let completedCoupons = false;
        let completedCustomers = false;
        let completedLicenseKeys = false;

        const productIdMap = new Map<string, string>();
        const customerIdMap = new Map<string, string>();

        // Migrate products if selected
        if (migrationTypes.includes('products')) {
            logger.log('\nStarting products migration...');

            // List the products from the Lemon Squeezy SDK
            const ListProducts = await listProducts();
            if (ListProducts.error || ListProducts.statusCode !== 200) {
                logger.error("Failed to fetch products from Lemon Squeezy!", ListProducts.error);
                process.exit(1);
            }

            logger.log('Found ' + ListProducts.data.data.length + ' products in Lemon Squeezy');

            // Iterate the products
            for (let product of ListProducts.data.data) {
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
                        }
                    }
                });
            }

            logger.log('These are the products to be migrated:');
            Products.forEach((product, index) => {
                logger.log(`${index + 1}. ${product.data.name} - ${product.data.price.currency} ${(product.data.price.price / 100).toFixed(2)} (${product.type === 'one_time_product' ? 'One Time' : 'Unknown'})`);
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
                for (let product of Products) {
                    logger.log('');
                    if (product.type === 'one_time_product') {
                        logger.log(`Migrating product: ${product.data.name}`);
                        await delay(100);
                        const createdProduct = await client.products.create(product.data);
                        productIdMap.set(product.ls_product_id, createdProduct.product_id);
                        logger.success(`Migration for product: ${createdProduct.name} completed (Dodo Payments product ID: ${createdProduct.product_id})`);
                    } else {
                        logger.log(`Skipping product: ${product.data.name} for unknown product type (example one time, subscription, etc)`);
                    }
                }
                logger.success('All products migrated successfully!');
                completedProducts = true;
            } else {
                logger.log('Products migration aborted by user');
            }
        }

        // Migrate coupons if selected
        if (migrationTypes.includes('coupons')) {
            logger.log('\nStarting coupons migration...');

            // List the discounts from the Lemon Squeezy SDK
            const ListDiscounts = await listDiscounts();
            if (ListDiscounts.error || ListDiscounts.statusCode !== 200) {
                logger.error("Failed to fetch discounts from Lemon Squeezy!", ListDiscounts.error);
                process.exit(1);
            }

            logger.log('Found ' + ListDiscounts.data.data.length + ' discounts in Lemon Squeezy');

            // Filter only published discounts
            const validDiscounts = ListDiscounts.data.data.filter((discount: any) =>
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

            logger.log('Found ' + customers.data?.meta.page.total + ' customers in Lemon Squeezy');

            const proceedCustomersMigration = await select({
                message: 'Proceed to migrate customers to Dodo Payments?',
                choices: [
                    { name: 'Yes', value: 'yes' },
                    { name: 'No', value: 'no' }
                ],
            });

            if (proceedCustomersMigration === 'yes') {
                if (customers.error || customers.statusCode !== 200) {
                    logger.error("Failed to fetch customers from Lemon Squeezy!", customers.error);
                    process.exit(1);
                }

                // Iterate through all the pages of customers
                const lastPage = customers.data?.meta?.page?.lastPage ?? 1;
                while (currentPage <= lastPage) {
                    // Fetch the next page of customers
                    // 5 req/s = 200ms delay
                    await delay(200);
                    const customersNew = await listCustomers({
                        page: {
                            number: currentPage,
                            size: 100
                        }
                    });

                    if (customersNew.error || customersNew.statusCode !== 200) {
                        logger.error("Failed to fetch customers from Lemon Squeezy!", customersNew.error);
                        process.exit(1);
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
            if (productIdMap.size === 0 || customerIdMap.size === 0) {
                logger.error('License key migration requires products and customers to be migrated in the same session.');
                logger.error('Please re-run with products, customers, and license_keys selected.');
                process.exit(1);
            } else {
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
                        break;
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
                let skippedCount = 0;

                for (const lk of allLicenseKeys) {
                    const attrs = lk.attributes;

                    if (attrs.disabled === 1 || attrs.status === 'disabled') {
                        logger.log(`Skipping disabled license key: ${lk.id}`);
                        skippedCount++;
                        continue;
                    }

                    if (attrs.status === 'expired') {
                        logger.log(`Skipping expired license key: ${lk.id}`);
                        skippedCount++;
                        continue;
                    }

                    const dodoProductId = productIdMap.get(String(attrs.product_id));
                    if (!dodoProductId) {
                        logger.warn(`License key ${lk.id}: no matching Dodo product for LS product ${attrs.product_id}. Skipping.`);
                        skippedCount++;
                        continue;
                    }

                    const normalizedEmail = attrs.user_email?.trim().toLowerCase();
                    const dodoCustomerId = normalizedEmail ? customerIdMap.get(normalizedEmail) : undefined;
                    if (!dodoCustomerId) {
                        logger.warn(`License key ${lk.id}: no matching Dodo customer for email ${attrs.user_email}. Skipping.`);
                        skippedCount++;
                        continue;
                    }

                    const activationsLimit = attrs.activation_limit === 0 ? null : attrs.activation_limit;

                    licenseKeysToMigrate.push({
                        key: attrs.key,
                        dodo_customer_id: dodoCustomerId,
                        dodo_product_id: dodoProductId,
                        activations_limit: activationsLimit,
                        expires_at: attrs.expires_at || null,
                        source_key_id: String(lk.id),
                        display_key: `****${attrs.key.slice(-6)}`,
                        product_name: `Product ${attrs.product_id}`,
                        customer_email: attrs.user_email
                    });
                }

                if (licenseKeysToMigrate.length === 0) {
                    logger.log('No valid license keys found to migrate.');
                } else {
                    logger.log('\nThese are the license keys to be migrated:');
                    licenseKeysToMigrate.forEach((lk, index) => {
                        const limit = lk.activations_limit !== null ? `${lk.activations_limit} activations` : 'Unlimited';
                        const expiry = lk.expires_at ? new Date(lk.expires_at).toLocaleDateString() : 'Never';
                        logger.log(`${index + 1}. ${lk.display_key} - ${lk.customer_email} - ${limit} - Expires: ${expiry}`);
                    });

                    if (skippedCount > 0) {
                        logger.warn(`${skippedCount} license keys were skipped (disabled/expired/unmapped)`);
                    }

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
                            try {
                                const created = await client.licenseKeys.create({
                                    key: lk.key,
                                    customer_id: lk.dodo_customer_id,
                                    product_id: lk.dodo_product_id,
                                    activations_limit: lk.activations_limit,
                                    expires_at: lk.expires_at,
                                });
                                logger.success(`Migrated license key: ${lk.display_key} (Dodo ID: ${created.id})`);
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
