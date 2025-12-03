import { listProducts, lemonSqueezySetup, getProduct, getStore, Store, listDiscounts } from '@lemonsqueezy/lemonsqueezy.js';
import DodoPayments from 'dodopayments';
import { input, select, checkbox } from '@inquirer/prompts';


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
            })
            .option('types', {
                describe: 'Migration types (comma-separated)',
                type: 'string',
                demandOption: false
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

        // Determine migration types
        let migrationTypes: string[] = [];
        if (argv['types']) {
            migrationTypes = argv['types'].split(',').map((type: string) => type.trim());
        } else {
            migrationTypes = await checkbox({
                message: 'Select what you want to migrate:',
                choices: [
                    { name: 'Products', value: 'products', checked: true },
                    { name: 'Coupons/Discounts', value: 'coupons', checked: true }
                ],
                required: true
            });
        }

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
        const Products: { type: 'one_time_product', data: any }[] = [];

        // This will be the array of coupons to be created in Dodo Payments
        const Coupons: { data: any }[] = [];

        // Track actual completion state for each migration branch
        let completedProducts = false;
        let completedCoupons = false;

        // Migrate products if selected
        if (migrationTypes.includes('products')) {
            console.log('\n[LOG] Starting products migration...');

            // List the products from the Lemon Squeezy SDK
            const ListProducts = await listProducts();
            if (ListProducts.error || ListProducts.statusCode !== 200) {
                console.log("[ERROR] Failed to fetch products from Lemon Squeezy!\n", ListProducts.error);
                process.exit(1);
            }

            console.log('[LOG] Found ' + ListProducts.data.data.length + ' products in Lemon Squeezy');

            // Iterate the products
            for (let product of ListProducts.data.data) {
                // This will contain the store information of the current product. This information is crucial to determine the currency of the product.
                // Do not confuse this with StoresData which is the cache of all stores
                let StoreData: null | Store = null;

                // If the store data is not already fetched, fetch it
                if (!StoresData[product.attributes.store_id]) {
                    console.log(`[LOG] Fetching store data for store ID ${product.attributes.store_id}`);

                    // Fetch the store data from Lemon Squeezy
                    const FetchStoreData = await getStore(product.attributes.store_id);
                    if (FetchStoreData.error || FetchStoreData.statusCode !== 200) {
                        console.log(`[ERROR] Failed to fetch store data for store ID ${product.attributes.store_id}\n`, FetchStoreData.error);
                        process.exit(1);
                    }
                    // If the store data is fetched and cached, use it
                    StoresData[product.attributes.store_id] = FetchStoreData.data;
                    // Store the currently fetched data in the local StoreData variable to access the current store information below
                    StoreData = FetchStoreData.data;
                } else {
                    console.log(`[LOG] Using cached store data for store ID ${product.attributes.store_id}`);
                    StoreData = StoresData[product.attributes.store_id];
                }

                // Store the product data in the Products array to be created later in Dodo Payments
                Products.push({
                    type: 'one_time_product',
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
                        brand_id: brand_id
                    }
                });
            }

            console.log('\n[LOG] These are the products to be migrated:');
            Products.forEach((product, index) => {
                console.log(`${index + 1}. ${product.data.name} - ${product.data.price.currency} ${(product.data.price.price / 100).toFixed(2)} (${product.type === 'one_time_product' ? 'One Time' : 'Unknown'})`);
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
                for (let product of Products) {
                    // Blank line for better readability in logs
                    console.log();
                    // If the product type is one_time_product, invoke the client.products.create method
                    if (product.type === 'one_time_product') {
                        console.log(`[LOG] Migrating product: ${product.data.name}`);
                        // Create the product in Dodo Payments
                        const createdProduct = await client.products.create(product.data);
                        console.log(`[LOG] Migration for product: ${createdProduct.name} completed (Dodo Payments product ID: ${createdProduct.product_id})`);
                    } else {
                        console.log(`[LOG] Skipping product: ${product.data.name} for unknown product type (example one time, subscription, etc)`);
                    }
                }
                console.log('\n[LOG] All products migrated successfully!');
                completedProducts = true;
            } else {
                console.log('[LOG] Products migration aborted by user');
            }
        }

        // Migrate coupons if selected
        if (migrationTypes.includes('coupons')) {
            console.log('\n[LOG] Starting coupons migration...');

            // List the discounts from the Lemon Squeezy SDK
            const ListDiscounts = await listDiscounts();
            if (ListDiscounts.error || ListDiscounts.statusCode !== 200) {
                console.log("[ERROR] Failed to fetch discounts from Lemon Squeezy!\n", ListDiscounts.error);
                process.exit(1);
            }

            console.log('[LOG] Found ' + ListDiscounts.data.data.length + ' discounts in Lemon Squeezy');

            // Filter only published discounts
            const validDiscounts = ListDiscounts.data.data.filter((discount: any) =>
                discount.attributes.status === 'published'
            );

            console.log('[LOG] Found ' + validDiscounts.length + ' valid (published) discounts');

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
                    subscriptionCycles = discount.attributes.duration_in_months;
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
                    console.log(`[WARNING] Skipping fixed amount discount "${discount.attributes.name}" (${discount.attributes.code}) - Dodo Payments SDK doesn't support non-percentage discounts`);
                }
            }

            if (Coupons.length > 0) {
                console.log('\n[LOG] These are the coupons to be migrated:');
                Coupons.forEach((coupon, index) => {
                    // / 100 to normalize the percentage value for display
                    const value = `${coupon.data.amount / 100}%`;
                    const expiry = coupon.data.expires_at ? ` (expires: ${new Date(coupon.data.expires_at).toLocaleDateString()})` : '';
                    const usage = coupon.data.usage_limit ? ` (max uses: ${coupon.data.usage_limit})` : '';
                    console.log(`${index + 1}. ${coupon.data.name} (${coupon.data.code}) - ${value}${expiry}${usage}`);
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
                        console.log();
                        console.log(`[LOG] Migrating coupon: ${coupon.data.name} (${coupon.data.code})`);
                        try {
                            // Create the coupon in Dodo Payments
                            const createdCoupon = await client.discounts.create(coupon.data);
                            console.log(`[LOG] Migration for coupon: ${createdCoupon.name} completed (Dodo Payments discount ID: ${createdCoupon.discount_id})`);
                            successCount++;
                        } catch (error) {
                            console.log(`[ERROR] Failed to migrate coupon: ${coupon.data.name} - ${error}`);
                            failureCount++;
                        }
                    }

                    // Report results based on actual success/failure
                    if (failureCount === 0) {
                        console.log('\n[LOG] All coupons migrated successfully!');
                        completedCoupons = true;
                    } else if (successCount === 0) {
                        console.log('\n[ERROR] All coupon migrations failed!');
                    } else {
                        console.log(`\n[LOG] Coupon migration completed with ${successCount} successful and ${failureCount} failed migrations.`);
                    }
                } else {
                    console.log('[LOG] Coupons migration aborted by user');
                }
            } else {
                console.log('[LOG] No valid coupons found to migrate');
            }
        }

        // Final completion message
        const completedMigrations: string[] = [];
        if (completedProducts) completedMigrations.push('products');
        if (completedCoupons) completedMigrations.push('coupons');

        if (completedMigrations.length > 0) {
            console.log(`\n[LOG] Migration completed for: ${completedMigrations.join(', ')}`);
        }
    }
}
