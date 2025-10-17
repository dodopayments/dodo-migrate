
import { listProducts, lemonSqueezySetup, getProduct, getStore, Store, listCustomers, listDiscounts } from '@lemonsqueezy/lemonsqueezy.js';
import DodoPayments from 'dodopayments';
import { input, select, confirm } from '@inquirer/prompts';

/**
 * Migrate discounts/coupons from Lemon Squeezy to Dodo Payments
 */
async function migrateDiscounts(argv: any) {
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

    // This variable will store the brand ID to be used for creating discounts in a specific Dodo Payments brand
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

    // Fetch discounts from Lemon Squeezy
    console.log('[LOG] Fetching discounts from Lemon Squeezy...');

    try {
        const discountsResponse = await listDiscounts();

        // Handle the response structure - check if it has error or if it's successful
        if ('error' in discountsResponse && discountsResponse.error) {
            console.log("[ERROR] Failed to fetch discounts from Lemon Squeezy!\n", discountsResponse.error);
            process.exit(1);
        }

        // Extract the discounts data - the structure may vary based on the API response
        const discountsData = 'data' in discountsResponse && discountsResponse.data ?
            (Array.isArray(discountsResponse.data) ? discountsResponse.data : discountsResponse.data.data) :
            [];

        if (!discountsData || discountsData.length === 0) {
            console.log("[LOG] No discounts found in Lemon Squeezy");
            process.exit(0);
        }

        console.log(`[LOG] Found ${discountsData.length} discounts in Lemon Squeezy`);

        // Display discounts to be migrated
        console.log('\n[LOG] These are the discounts to be migrated:');
        discountsData.forEach((discount: any, index: number) => {
            const { name, code, amount, amount_type } = discount.attributes;
            console.log(`${index + 1}. ${name} (${code}) - ${amount}${amount_type === 'percent' ? '%' : ' USD'}`);
        });

        // Ask for confirmation before migration
        const migrateConfirm = await select({
            message: 'Proceed to migrate these discounts to Dodo Payments?',
            choices: [
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            ],
        });

        if (migrateConfirm === 'yes') {
            console.log('\n[LOG] Starting discount migration...');

            // Track migration statistics
            let successCount = 0;
            let failCount = 0;

            // Migrate each discount
            for (const discount of discountsData) {
                try {
                    const { name, code, amount, amount_type, expires_at, is_limited_redemptions, max_redemptions } = discount.attributes;

                    console.log(`[LOG] Migrating discount: ${name} (${code})`);

                    // Convert amount from Lemon Squeezy format to Dodo Payments format
                    // For percentage discounts, Dodo uses basis points (e.g., 540 => 5.4%)
                    // For fixed discounts, Dodo uses USD cents (e.g., 100 => $1.00)
                    let dodoAmount = amount;
                    if (amount_type === 'percent') {
                        // Convert percentage to basis points (multiply by 100)
                        dodoAmount = amount * 100;
                    }

                    // Create discount in Dodo Payments
                    const dodoDiscount = await client.discounts.create({
                        amount: dodoAmount,
                        type: 'percentage', // Dodo only supports percentage discounts currently
                        code: code,
                        name: name,
                        expires_at: expires_at,
                        usage_limit: is_limited_redemptions ? max_redemptions : undefined
                    });

                    console.log(`[LOG] Successfully migrated discount: ${name} (Dodo Payments discount ID: ${dodoDiscount.discount_id})`);
                    successCount++;
                } catch (error) {
                    console.log(`[ERROR] Failed to migrate discount: ${discount.attributes.name} (${discount.attributes.code})`);
                    console.log(error);
                    failCount++;
                }
            }

            console.log(`\n[LOG] Discount migration completed: ${successCount} successful, ${failCount} failed`);
        } else {
            console.log('[LOG] Migration aborted by user');
            process.exit(0);
        }
    } catch (error) {
        console.log("[ERROR] Failed to fetch discounts from Lemon Squeezy!\n", error);
        process.exit(1);
    }
}

async function migrateCustomers(argv: any) {
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

    // This variable will store the brand ID to be used for creating customers in a specific Dodo Payments brand
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

    // Fetch customers from Lemon Squeezy
    console.log('[LOG] Fetching customers from Lemon Squeezy...');

    const lsCustomers = await listCustomers();

    if (lsCustomers.error || lsCustomers.statusCode !== 200) {
        console.log("[ERROR] Failed to fetch customers from Lemon Squeezy!\n", lsCustomers.error);
        process.exit(1);
    }

    const customers = lsCustomers.data.data;
    console.log(`[LOG] Found ${customers.length} customers in Lemon Squeezy`);

    // Display customers to be migrated
    console.log('\n[LOG] These are the customers to be migrated:');
    customers.forEach((customer, index) => {
        console.log(`${index + 1}. ${customer.attributes.name || 'Unnamed Customer'} - ${customer.attributes.email}`);
    });

    // Ask for confirmation before migration
    const migrateConfirm = await select({
        message: 'Proceed to migrate these customers to Dodo Payments?',
        choices: [
            { name: 'Yes', value: 'yes' },
            { name: 'No', value: 'no' }
        ],
    });

    if (migrateConfirm === 'yes') {
        console.log('\n[LOG] Starting customer migration...');

        // Track migration statistics
        let successCount = 0;
        let failCount = 0;

        // Migrate each customer
        for (const customer of customers) {
            try {
                console.log(`[LOG] Migrating customer: ${customer.attributes.name || 'Unnamed Customer'} (${customer.attributes.email})`);

                // Create customer in Dodo Payments
                const dodoCustomer = await client.customers.create({
                    name: customer.attributes.name || 'Customer',
                    email: customer.attributes.email
                });

                console.log(`[LOG] Successfully migrated customer: ${dodoCustomer.name} (Dodo Payments customer ID: ${dodoCustomer.customer_id})`);
                successCount++;
            } catch (error) {
                console.log(`[ERROR] Failed to migrate customer: ${customer.attributes.name || 'Unnamed Customer'} (${customer.attributes.email})`);
                console.log(error);
                failCount++;
            }
        }

        console.log(`\n[LOG] Customer migration completed: ${successCount} successful, ${failCount} failed`);
    } else {
        console.log('[LOG] Migration aborted by user');
        process.exit(0);
    }
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
                // defaults to 'test_mode'
                choices: ['test_mode', 'live_mode'],
                demandOption: false,
                default: 'test_mode'
            })
            .command('customers', 'Migrate customers from Lemon Squeezy to Dodo Payments', {}, async (argv) => {
                await migrateCustomers(argv);
            })
            .command('discounts', 'Migrate discounts/coupons from Lemon Squeezy to Dodo Payments', {}, async (argv) => {
                await migrateDiscounts(argv);
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
        const Products: { type: 'one_time_product', data: any }[] = [];

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
        } else {
            console.log('[LOG] Migration aborted by user');
            process.exit(0);
        }

        // -----------------------------
        // Coupons (Discounts) Migration
        // -----------------------------

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
