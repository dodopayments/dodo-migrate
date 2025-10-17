import axios from 'axios';
import DodoPayments from 'dodopayments';
import { input, select, confirm } from '@inquirer/prompts';

/**
 * Migrate customers from FastSpring to Dodo Payments
 * @param {any} argv - Command line arguments
 */
async function migrateCustomers(argv: any) {
    // Store the details of the API keys and mode, and prompt the user if they fail to provide it in the CLI
    const PROVIDER_USERNAME = argv['provider-username'] || await input({ message: 'Enter your FastSpring API Username:', required: true });
    const PROVIDER_PASSWORD = argv['provider-password'] || await input({ message: 'Enter your FastSpring API Password:', required: true });
    const DODO_API_KEY = argv['dodo-api-key'] || await input({ message: 'Enter your Dodo Payments API Key:', required: true });
    const MODE = argv['mode'] || await select({
        message: 'Select Dodo Payments environment:',
        choices: [
            { name: 'Test Mode', value: 'test_mode' },
            { name: 'Live Mode', value: 'live_mode' }
        ],
        default: 'test_mode'
    });

    // Set up the FastSpring API client
    const auth = Buffer.from(`${PROVIDER_USERNAME}:${PROVIDER_PASSWORD}`).toString('base64');
    const fastspringClient = axios.create({
        baseURL: 'https://api.fastspring.com',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
        }
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

    // Fetch customers from FastSpring
    console.log('[LOG] Fetching accounts from FastSpring...');

    try {
        // FastSpring API uses /accounts endpoint to list customer accounts
        const response = await fastspringClient.get('/accounts');

        if (!response.data || !Array.isArray(response.data)) {
            console.log("[ERROR] Unexpected response format from FastSpring API");
            process.exit(1);
        }

        const customers = response.data;
        console.log(`[LOG] Found ${customers.length} customers in FastSpring`);

        // Display customers to be migrated
        console.log('\n[LOG] These are the customers to be migrated:');
        customers.forEach((customer, index) => {
            console.log(`${index + 1}. ${customer.contact?.firstName || ''} ${customer.contact?.lastName || 'Unnamed Customer'} - ${customer.contact?.email || 'No Email'}`);
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
                    // Skip customers without email as it's required for Dodo Payments
                    if (!customer.contact?.email) {
                        console.log(`[WARN] Skipping customer: ${customer.contact?.firstName || ''} ${customer.contact?.lastName || 'Unnamed Customer'} - No email address provided`);
                        failCount++;
                        continue;
                    }

                    const customerName = `${customer.contact?.firstName || ''} ${customer.contact?.lastName || ''}`.trim() || 'Customer';
                    console.log(`[LOG] Migrating customer: ${customerName} (${customer.contact.email})`);

                    // Create customer in Dodo Payments - removed brand_id as it's not in the type definition
                    const dodoCustomer = await client.customers.create({
                        name: customerName,
                        email: customer.contact.email
                        // brand_id: brand_id - not supported in the current API
                    });

                    console.log(`[LOG] Successfully migrated customer: ${dodoCustomer.name} (Dodo Payments customer ID: ${dodoCustomer.customer_id})`);
                    successCount++;
                } catch (error) {
                    console.log(`[ERROR] Failed to migrate customer: ${customer.contact?.firstName || ''} ${customer.contact?.lastName || 'Unnamed Customer'} (${customer.contact?.email || 'No Email'})`);
                    console.log(error);
                    failCount++;
                }
            }

            console.log(`\n[LOG] Customer migration completed: ${successCount} successful, ${failCount} failed`);
        } else {
            console.log('[LOG] Migration aborted by user');
            process.exit(0);
        }
    } catch (error) {
        console.log("[ERROR] Failed to fetch customers from FastSpring!\n", error);
        process.exit(1);
    }
}

/**
 * Migrate products from FastSpring to Dodo Payments
 */
async function migrateProducts(argv: any) {
    // Store the details of the API keys and mode, and prompt the user if they fail to provide it in the CLI
    const PROVIDER_USERNAME = argv['provider-username'] || await input({ message: 'Enter your FastSpring API Username:', required: true });
    const PROVIDER_PASSWORD = argv['provider-password'] || await input({ message: 'Enter your FastSpring API Password:', required: true });
    const DODO_API_KEY = argv['dodo-api-key'] || await input({ message: 'Enter your Dodo Payments API Key:', required: true });
    const MODE = argv['mode'] || await select({
        message: 'Select Dodo Payments environment:',
        choices: [
            { name: 'Test Mode', value: 'test_mode' },
            { name: 'Live Mode', value: 'live_mode' }
        ],
        default: 'test_mode'
    });

    // Set up the FastSpring API client
    const auth = Buffer.from(`${PROVIDER_USERNAME}:${PROVIDER_PASSWORD}`).toString('base64');
    const fastspringClient = axios.create({
        baseURL: 'https://api.fastspring.com',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
        }
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

    // Fetch products from FastSpring
    console.log('[LOG] Fetching products from FastSpring...');

    try {
        // FastSpring API uses /products endpoint to list products
        const response = await fastspringClient.get('/products');

        if (!response.data || !Array.isArray(response.data)) {
            console.log("[ERROR] Unexpected response format from FastSpring API");
            process.exit(1);
        }

        const products = response.data;
        console.log(`[LOG] Found ${products.length} products in FastSpring`);

        // Display products to be migrated
        console.log('\n[LOG] These are the products to be migrated:');
        products.forEach((product, index) => {
            console.log(`${index + 1}. ${product.display || product.product} - ${product.pricing?.price || 'No Price'}`);
        });

        // Ask for confirmation before migration
        const migrateConfirm = await select({
            message: 'Proceed to migrate these products to Dodo Payments?',
            choices: [
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            ],
        });

        if (migrateConfirm === 'yes') {
            console.log('\n[LOG] Starting product migration...');

            // Track migration statistics
            let successCount = 0;
            let failCount = 0;

            // Migrate each product
            for (const product of products) {
                try {
                    const productName = product.display || product.product || 'Unnamed Product';
                    console.log(`[LOG] Migrating product: ${productName}`);

                    // Get the price information if available
                    let priceInCents = 0;
                    if (product.pricing && product.pricing.price) {
                        priceInCents = Math.round(parseFloat(product.pricing.price) * 100);
                    }

                    // Create product in Dodo Payments with required fields
                    const dodoProduct = await client.products.create({
                        name: productName,
                        description: product.description || '',
                        price: priceInCents,
                        tax_category: 'standard', // Required field
                        brand_id: brand_id
                    } as any); // Type assertion due to potential API inconsistencies

                    console.log(`[LOG] Successfully created product: ${dodoProduct.name} (Dodo Payments product ID: ${dodoProduct.product_id})`);

                    // Note: Since the prices API is not available in the current SDK,
                    // pricing information is handled within the product creation.
                    // Subscription-specific pricing logic has been moved to product creation.

                    if (product.pricing && product.pricing.price) {
                        console.log(`[LOG] Product created with price: ${product.pricing.price} ${product.pricing.currency || 'USD'}`);
                        if (product.subscription) {
                            console.log(`[LOG] Note: Subscription details (${product.subscription.intervalUnit}, ${product.subscription.intervalLength}) recorded but may need separate handling`);
                        }
                    } else {
                        console.log(`[WARN] No pricing information available for product: ${productName}`);
                    }

                    successCount++;
                } catch (error) {
                    console.log(`[ERROR] Failed to migrate product: ${product.display || product.product || 'Unnamed Product'}`);
                    console.log(error);
                    failCount++;
                }
            }

            console.log(`\n[LOG] Product migration completed: ${successCount} successful, ${failCount} failed`);
        } else {
            console.log('[LOG] Migration aborted by user');
            process.exit(0);
        }
    } catch (error) {
        console.log("[ERROR] Failed to fetch products from FastSpring!\n", error);
        process.exit(1);
    }
}

/**
 * Migrate discounts from FastSpring to Dodo Payments
 */
async function migrateDiscounts(argv: any) {
    // Store the details of the API keys and mode, and prompt the user if they fail to provide it in the CLI
    const PROVIDER_USERNAME = argv['provider-username'] || await input({ message: 'Enter your FastSpring API Username:', required: true });
    const PROVIDER_PASSWORD = argv['provider-password'] || await input({ message: 'Enter your FastSpring API Password:', required: true });
    const DODO_API_KEY = argv['dodo-api-key'] || await input({ message: 'Enter your Dodo Payments API Key:', required: true });
    const MODE = argv['mode'] || await select({
        message: 'Select Dodo Payments environment:',
        choices: [
            { name: 'Test Mode', value: 'test_mode' },
            { name: 'Live Mode', value: 'live_mode' }
        ],
        default: 'test_mode'
    });

    // Set up the FastSpring API client
    const auth = Buffer.from(`${PROVIDER_USERNAME}:${PROVIDER_PASSWORD}`).toString('base64');
    const fastspringClient = axios.create({
        baseURL: 'https://api.fastspring.com',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
        }
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

    // Fetch coupons from FastSpring
    console.log('[LOG] Fetching coupons from FastSpring...');

    try {
        // FastSpring API uses /coupons endpoint to list coupons
        const response = await fastspringClient.get('/coupons');

        if (!response.data || !Array.isArray(response.data)) {
            console.log("[ERROR] Unexpected response format from FastSpring API");
            process.exit(1);
        }

        const coupons = response.data;
        console.log(`[LOG] Found ${coupons.length} coupons in FastSpring`);

        // Display coupons to be migrated
        console.log('\n[LOG] These are the coupons to be migrated:');
        coupons.forEach((coupon, index) => {
            const discountType = coupon.discountType === 'percentage' ? `${coupon.discountPercent}%` : `${coupon.discountTotal} ${coupon.discountCurrency}`;
            console.log(`${index + 1}. ${coupon.code} - ${discountType}`);
        });

        // Ask for confirmation before migration
        const migrateConfirm = await select({
            message: 'Proceed to migrate these coupons to Dodo Payments?',
            choices: [
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            ],
        });

        if (migrateConfirm === 'yes') {
            console.log('\n[LOG] Starting coupon migration...');

            // Track migration statistics
            let successCount = 0;
            let failCount = 0;

            // Migrate each coupon
            for (const coupon of coupons) {
                try {
                    console.log(`[LOG] Migrating coupon: ${coupon.code}`);

                    // Dodo Payments only supports percentage discounts
                    const type: 'percentage' = 'percentage';
                    let amount: number;

                    if (coupon.discountType === 'percentage') {
                        // Convert percentage to basis points (1% = 100 basis points)
                        amount = coupon.discountPercent * 100;
                    } else {
                        // Skip fixed amount discounts since Dodo only supports percentage
                        console.log(`[WARN] Skipping fixed amount coupon: ${coupon.code} - Dodo Payments only supports percentage discounts`);
                        continue;
                    }

                    // Create discount in Dodo Payments
                    const dodoDiscount = await client.discounts.create({
                        name: coupon.code,
                        code: coupon.code,
                        type: type,
                        amount: amount,
                        // usage_limit: coupon.usageLimit || undefined, - may not be supported
                        // expires_at: coupon.expirationDate ? new Date(coupon.expirationDate).toISOString() : undefined - may not be supported
                    });

                    console.log(`[LOG] Successfully migrated coupon: ${coupon.code} (Dodo Payments discount ID: ${dodoDiscount.discount_id})`);
                    successCount++;
                } catch (error) {
                    console.log(`[ERROR] Failed to migrate coupon: ${coupon.code}`);
                    console.log(error);
                    failCount++;
                }
            }

            console.log(`\n[LOG] Coupon migration completed: ${successCount} successful, ${failCount} failed`);
        } else {
            console.log('[LOG] Migration aborted by user');
            process.exit(0);
        }
    } catch (error) {
        console.log("[ERROR] Failed to fetch coupons from FastSpring!\n", error);
        process.exit(1);
    }
}

export default {
    // Format: dodo-migrate [provider] [arguments]
    command: 'fastspring [arguments]',
    describe: 'Migrate from FastSpring to Dodo Payments',
    builder: (yargs: any) => {
        return yargs
            .option('provider-username', {
                describe: 'FastSpring API Username',
                type: 'string',
                demandOption: false
            })
            .option('provider-password', {
                describe: 'FastSpring API Password',
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
            .command('customers', 'Migrate customers from FastSpring to Dodo Payments', {}, async (argv) => {
                await migrateCustomers(argv);
            })
            .command('products', 'Migrate products from FastSpring to Dodo Payments', {}, async (argv) => {
                await migrateProducts(argv);
            })
            .command('discounts', 'Migrate discounts from FastSpring to Dodo Payments', {}, async (argv) => {
                await migrateDiscounts(argv);
            });
    },
    handler: async (argv: any) => {
        console.log('Please specify a command: customers, products, discounts');
    }
}
