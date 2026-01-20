import DodoPayments from 'dodopayments';
import { select, checkbox, password } from '@inquirer/prompts';
import { logger } from '../../utils/logger';
import { getDodoCredentials, setupDodoClient, selectDodoBrand } from '../../utils/dodo';

// Helper function to make Paddle API requests
async function makePaddleRequest(endpoint: string, apiKey: string, options: RequestInit = {}, environment: 'production' | 'sandbox' = 'production') {
    const baseUrl = environment === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
    const url = `${baseUrl}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Paddle-Version': '1',
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok) {
        throw new Error(`Paddle API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

// Helper function to fetch all pages of data from Paddle API (cursor-based)
async function fetchAllPages(endpoint: string, apiKey: string, environment: 'production' | 'sandbox' = 'production', params: Record<string, string | number | boolean> = {}): Promise<any[]> {
    const allItems: any[] = [];
    let after: string | null = null;
    let pageIndex = 0;
    const maxPages = 100; // Safety limit to prevent infinite loops

    while (pageIndex < maxPages) {
        try {
            const qp: Record<string, string> = { per_page: '200', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) };
            if (after) qp.after = after;
            const qs = new URLSearchParams(qp).toString();
            const url = qs ? `${endpoint}?${qs}` : endpoint;
            const response = await makePaddleRequest(url, apiKey, {}, environment);

            if (response.data && Array.isArray(response.data)) {
                allItems.push(...response.data);
                // Only log if we got items
                if (response.data.length > 0) {
                    logger.log(`Fetched ${response.data.length} items from ${endpoint} (page ${pageIndex + 1})`);
                }
            }

            // Check for next page using the response structure
            const pagination = response.meta?.pagination;
            if (pagination?.next) {
                const nextUrl = new URL(pagination.next);
                after = nextUrl.searchParams.get('after');
            } else {
                after = null;
            }

            pageIndex++;

            // Break if no more pages or if we've fetched 0 items (empty page)
            if (!after || (response.data && response.data.length === 0)) {
                break;
            }
        } catch (error: any) {
            logger.warn(`Error fetching page ${pageIndex + 1} from ${endpoint}: ${error.message}`);
            break;
        }
    }

    return allItems;
}

export default {
    command: 'paddle [arguments]',
    describe: 'Migrate from Paddle to Dodo Payments',
    builder: (yargs: any) => {
        return yargs
            .option('provider-api-key', {
                describe: 'Paddle API Key',
                type: 'string',
                demandOption: false
            })
            .option('paddle-environment', {
                describe: 'Paddle environment',
                type: 'string',
                choices: ['production', 'sandbox'],
                demandOption: false,
                default: 'production'
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
            .option('migrate-types', {
                describe: 'Types of data to migrate (comma-separated: products,discounts,customers)',
                type: 'string',
                demandOption: false
            });
    },
    handler: async (argv: any) => {
        logger.log('Starting Paddle to Dodo Payments migration...\n');

        // Detect if we're in non-interactive mode (CI/CD, automated scripts)
        const isInteractive = process.stdin.isTTY;

        // Get credentials - either from CLI arguments or interactive prompts
        let PROVIDER_API_KEY = argv['provider-api-key'];
        let PADDLE_ENV: 'production' | 'sandbox' = argv['paddle-environment'] || 'production';

        // Validate that all required credentials are provided in non-interactive mode
        if (!PROVIDER_API_KEY) {
            if (!isInteractive) {
                logger.error('--provider-api-key required in non-interactive mode');
                process.exit(1);
            }
            PROVIDER_API_KEY = (await password({
                message: 'Enter your Paddle API key:',
                mask: '*'
            })).trim();
        }

        // Default to sandbox environment for safety
        if (!argv['paddle-environment']) {
            PADDLE_ENV = 'sandbox';
        }

        const { apiKey: DODO_API_KEY, mode: MODE } = await getDodoCredentials(argv);

        // Test Paddle API connection
        try {
            await makePaddleRequest('/products?per_page=1', PROVIDER_API_KEY, {}, PADDLE_ENV);
            logger.log('Successfully connected to Paddle');
        } catch (error: any) {
            logger.error('Failed to connect to Paddle!');
            logger.error('Please check your Paddle API key');
            logger.error(`Error details: ${error.message}`);
            process.exit(1);
        }

        // Initialize Dodo Payments SDK
        const client = setupDodoClient(DODO_API_KEY, MODE);

        // Select the Dodo Payments brand to migrate to
        const brand_id = await selectDodoBrand(client, argv);

        // Determine which data types to migrate (products, discounts, customers)
        let migrateTypes: string[] = [];
        if (argv['migrate-types']) {
            migrateTypes = argv['migrate-types'].split(',').map((type: string) => type.trim());
        } else {
            if (!isInteractive) {
                // In non-interactive mode, default to products only (safest option)
                migrateTypes = ['products'];
                logger.log(`Non-interactive mode: defaulting to migrate products only`);
            } else {
                migrateTypes = await checkbox({
                    message: 'Select what you want to migrate:',
                    choices: [
                        { name: 'Products', value: 'products', checked: true },
                        { name: 'Discounts', value: 'discounts', checked: false },
                        { name: 'Customers', value: 'customers', checked: false }
                    ],
                    required: true
                });
            }
        }

        logger.log(`Will migrate: ${migrateTypes.join(', ')}`);

        // Execute the selected migrations
        let hasFailures = false;
        const completedMigrations: string[] = [];

        if (migrateTypes.includes('products')) {
            const productResult = await migrateProducts(PROVIDER_API_KEY, client, brand_id, PADDLE_ENV);
            if (productResult && productResult.errorCount > 0) {
                hasFailures = true;
            }
            if (productResult && productResult.successCount > 0) {
                completedMigrations.push('products');
            }
        }

        if (migrateTypes.includes('discounts')) {
            const discountResult = await migrateDiscounts(PROVIDER_API_KEY, client, brand_id, PADDLE_ENV);
            if (discountResult && discountResult.errorCount > 0) {
                hasFailures = true;
            }
            if (discountResult && discountResult.successCount > 0) {
                completedMigrations.push('discounts');
            }
        }

        if (migrateTypes.includes('customers')) {
            const customerResult = await migrateCustomers(PROVIDER_API_KEY, client, brand_id, PADDLE_ENV);
            if (customerResult && customerResult.errorCount > 0) {
                hasFailures = true;
            }
            if (customerResult && customerResult.successCount > 0) {
                completedMigrations.push('customers');
            }
        }

        if (hasFailures) {
            logger.log('\nMigration completed with some failures. Check the logs above for details.');
        }

        if (completedMigrations.length > 0) {
            logger.success(`Migration completed for: ${completedMigrations.join(', ')}`);
        }

        process.exit(hasFailures ? 1 : 0);
    }
};

// Product migration implementation
interface ProductToMigrate {
    type: 'one_time_product' | 'subscription_product';
    paddle_id: string;
    data: any;
}

async function migrateProducts(apiKey: string, client: DodoPayments, brand_id: string, environment: 'production' | 'sandbox') {
    logger.log('\n=== Starting Products Migration ===');

    try {
        logger.log('Fetching products from Paddle...');
        const products = await fetchAllPages('/products', apiKey, environment);

        if (products.length === 0) {
            logger.log('No products found in Paddle. Skipping products migration.');
            return;
        }

        logger.log(`Found ${products.length} products to migrate`);

        // Fetch all prices to associate with products
        logger.log('Fetching prices from Paddle...');
        const prices = await fetchAllPages('/prices', apiKey, environment);
        logger.log(`Found ${prices.length} prices`);


        // Transform Paddle products to Dodo format
        const productsToMigrate: ProductToMigrate[] = [];

        for (const product of products) {
            // Skip archived products
            if (product.status !== 'active') {
                logger.log(`Skipping archived product: ${product.name}`);
                continue;
            }

            // Find prices for this product
            const productPrices = prices.filter(price => price.product_id === product.id);

            if (productPrices.length === 0) {
                logger.log(`Skipping product ${product.name} - no prices found`);
                continue;
            }

            // Process each price for this product
            for (const price of productPrices) {
                if (price.status !== 'active') {
                    continue;
                }

                const isRecurring = price.billing_cycle !== null;
                const unitPrice = parseInt(price.unit_price.amount, 10);

                // Validate parsed price amount
                if (isNaN(unitPrice) || unitPrice < 0) {
                    logger.warn(`Invalid price amount "${price.unit_price.amount}" for product "${product.name}", skipping.`);
                    continue;
                }

                const currency = price.unit_price.currency_code.toUpperCase();

                // Check if the product/price is tax inclusive
                // tax_mode: "internal" means tax is included in price (tax-inclusive)
                // tax_mode: "external" means tax is added on top of price (tax-exclusive)
                const isTaxInclusive = price.tax_mode === 'internal';

                if (isRecurring && price.billing_cycle) {
                    // Subscription product
                    const interval = price.billing_cycle.interval;
                    const frequency = price.billing_cycle.frequency;

                    // Map Paddle intervals to Dodo format
                    let billingPeriod: 'monthly' | 'yearly';
                    let intervalUnit: string;

                    if (interval === 'month') {
                        billingPeriod = 'monthly';
                        intervalUnit = 'Month';
                    } else if (interval === 'year') {
                        billingPeriod = 'yearly';
                        intervalUnit = 'Year';
                    } else {
                        logger.warn(`Unsupported billing interval "${interval}" for product "${product.name}", skipping.`);
                        continue;
                    }

                    // Build price object, only include tax_inclusive if true
                    const priceObject: any = {
                        currency: currency,
                        price: unitPrice,
                        discount: 0,
                        purchasing_power_parity: false,
                        type: 'recurring_price',
                        billing_period: billingPeriod,
                        payment_frequency_interval: intervalUnit,
                        payment_frequency_count: frequency,
                        subscription_period_interval: 'Year',
                        subscription_period_count: 20, // 20 years max subscription period
                    };

                    // Only add tax_inclusive field if the product is tax inclusive
                    if (isTaxInclusive) {
                        priceObject.tax_inclusive = true;
                    }

                    productsToMigrate.push({
                        type: 'subscription_product',
                        paddle_id: product.id,
                        data: {
                            name: product.name,
                            description: product.description || '',
                            tax_category: 'saas',
                            price: priceObject,
                            brand_id: brand_id,
                            metadata: {
                                paddle_product_id: product.id,
                                paddle_price_id: price.id,
                                migrated_from: 'paddle'
                            }
                        }
                    });
                } else {
                    // One-time product
                    // Build price object, only include tax_inclusive if true
                    const priceObject: any = {
                        currency: currency,
                        price: unitPrice,
                        discount: 0,
                        purchasing_power_parity: false,
                        type: 'one_time_price'
                    };

                    // Only add tax_inclusive field if the product is tax inclusive
                    if (isTaxInclusive) {
                        priceObject.tax_inclusive = true;
                    }

                    productsToMigrate.push({
                        type: 'one_time_product',
                        paddle_id: product.id,
                        data: {
                            name: product.name,
                            description: product.description || '',
                            tax_category: 'saas',
                            price: priceObject,
                            brand_id: brand_id,
                            metadata: {
                                paddle_product_id: product.id,
                                paddle_price_id: price.id,
                                migrated_from: 'paddle'
                            }
                        }
                    });
                }
            }
        }

        if (productsToMigrate.length === 0) {
            logger.log('No compatible products found to migrate.');
            return;
        }

        // Show preview of products that will be migrated
        logger.log('\n[PREVIEW] Products to be migrated:');
        logger.log('=====================================');

        productsToMigrate.forEach((product, index) => {
            const price = product.data.price.price / 100;
            const type = product.type === 'one_time_product' ? 'One Time' : 'Subscription';
            const billing = product.type === 'subscription_product' ? ` (${product.data.price.billing_period})` : '';
            const taxStatus = product.data.price.tax_inclusive === true ? 'Tax Inclusive' : 'Tax Exclusive';

            logger.log(`\n${index + 1}. ${product.data.name}`);
            logger.log(`   Type: ${type}${billing}`);
            logger.log(`   Price: ${product.data.price.currency} ${price.toFixed(2)}`);
            logger.log(`   Tax Status: ${taxStatus}`);
            logger.log(`   Paddle ID: ${product.paddle_id}`);
        });

        logger.log('\n=====================================');

        // Ask for confirmation before creating products
        let shouldProceed = 'yes';
        if (process.stdin.isTTY) {
            const { select } = await import('@inquirer/prompts');
            shouldProceed = await select({
                message: `Proceed with migrating ${productsToMigrate.length} products to Dodo Payments?`,
                choices: [
                    { name: 'Yes', value: 'yes' },
                    { name: 'No', value: 'no' }
                ]
            });
        } else {
            logger.log('Non-interactive mode: proceeding with products migration automatically');
        }

        if (shouldProceed !== 'yes') {
            logger.log('Products migration cancelled by user.');
            return;
        }

        // Create products in Dodo Payments
        logger.log('\nStarting products migration...');
        let successCount = 0;
        let errorCount = 0;

        for (const product of productsToMigrate) {
            try {
                const createdProduct = await client.products.create(product.data);
                logger.success(`Migrated: ${product.data.name} (Dodo ID: ${createdProduct.product_id})`);
                successCount++;
            } catch (error: any) {
                logger.error(`Failed to migrate product "${product.data.name}": ${error.message}`);
                errorCount++;
            }
        }

        // Display migration summary
        logger.log('\n=== Products Migration Complete ===');
        logger.log(`Successfully migrated: ${successCount} products`);
        if (errorCount > 0) {
            logger.warn(`Errors encountered: ${errorCount}`);
        }

        return { successCount, errorCount };
    } catch (error: any) {
        logger.error('Failed to migrate products!', error.message);
        return { successCount: 0, errorCount: 1 };
    }
}

// Discount migration implementation
interface DiscountToMigrate {
    [key: string]: any;
}

async function migrateDiscounts(apiKey: string, client: DodoPayments, brand_id: string, environment: 'production' | 'sandbox') {
    logger.log('\n=== Starting Discounts Migration ===');

    try {
        logger.log('Fetching discounts from Paddle...');
        const discounts = await fetchAllPages('/discounts', apiKey, environment);

        if (discounts.length === 0) {
            logger.log('No discounts found in Paddle. Skipping discounts migration.');
            return;
        }

        logger.log(`Found ${discounts.length} discounts to process`);

        // Transform Paddle discounts to Dodo format
        const discountsToMigrate: DiscountToMigrate[] = [];

        for (const discount of discounts) {
            // Skip inactive discounts
            if (discount.status !== 'active') {
                logger.log(`Skipping inactive discount: ${discount.code || discount.id}`);
                continue;
            }

            // Skip expired discounts
            if (discount.expires_at && new Date(discount.expires_at) < new Date()) {
                logger.log(`Skipping expired discount: ${discount.code || discount.id}`);
                continue;
            }

            // Skip discounts without a code (required for Dodo Payments)
            if (!discount.code) {
                logger.log(`Skipping discount "${discount.id}" - no code found (required for Dodo Payments)`);
                continue;
            }

            // Determine discount type and value
            let discountType: 'percentage';
            let discountValue: number;

            if (discount.type === 'percentage') {
                discountType = 'percentage';
                // Paddle stores percentage amount as string like "20" for 20%
                // Dodo expects basis points (e.g., 20% -> 2000)
                const parsedAmount = parseFloat(discount.amount);

                // Validate parsed discount amount
                if (isNaN(parsedAmount) || parsedAmount < 0 || parsedAmount > 100) {
                    logger.warn(`Invalid discount amount "${discount.amount}" for discount "${discount.code}", skipping.`);
                    continue;
                }

                discountValue = Math.round(parsedAmount * 100);
            } else if (discount.type === 'flat') {
                // Dodo Payments API currently only supports percentage discounts
                logger.warn(`Skipping flat-amount discount "${discount.code}" - Dodo Payments only supports percentage discounts`);
                continue;
            } else {
                logger.warn(`Skipping discount "${discount.code}" - unsupported type: ${discount.type}`);
                continue;
            }

            // Handle expiration date conversion
            let expiresAt: string | null = null;
            if (discount.expires_at) {
                expiresAt = new Date(discount.expires_at).toISOString();
            }

            const transformedDiscount: DiscountToMigrate = {
                code: discount.code,
                name: discount.description || discount.code,
                type: discountType,
                amount: discountValue,
                usage_limit: discount.usage_limit || null,
                expires_at: expiresAt,
                brand_id: brand_id
            };

            discountsToMigrate.push(transformedDiscount);
        }

        if (discountsToMigrate.length === 0) {
            logger.log('No compatible discounts found to migrate.');
            return;
        }

        // Show preview of discounts that will be migrated
        logger.log('\n[PREVIEW] Discounts to be migrated:');
        logger.log('=====================================');

        discountsToMigrate.forEach((discount, index) => {
            const value = `${(discount.amount / 100).toFixed(0)}%`;

            const usageLimit = discount.usage_limit
                ? `${discount.usage_limit} uses`
                : 'Unlimited';

            const expiration = discount.expires_at
                ? new Date(discount.expires_at).toLocaleDateString()
                : 'No expiration';

            logger.log(`\n${index + 1}. ${discount.name} (${discount.code})`);
            logger.log(`   Type: ${discount.type}`);
            logger.log(`   Value: ${value}`);
            logger.log(`   Usage Limit: ${usageLimit}`);
            logger.log(`   Expires: ${expiration}`);
        });

        logger.log('\n=====================================');

        // Ask for confirmation before creating discounts
        let shouldProceed = 'yes';
        if (process.stdin.isTTY) {
            const { select } = await import('@inquirer/prompts');
            shouldProceed = await select({
                message: `Proceed with migrating ${discountsToMigrate.length} discounts to Dodo Payments?`,
                choices: [
                    { name: 'Yes', value: 'yes' },
                    { name: 'No', value: 'no' }
                ]
            });
        } else {
            logger.log('Non-interactive mode: proceeding with discounts migration automatically');
        }

        if (shouldProceed !== 'yes') {
            logger.log('Discounts migration cancelled by user.');
            return;
        }

        // Create discounts in Dodo Payments
        logger.log('\nStarting discounts migration...');
        let successCount = 0;
        let errorCount = 0;

        for (const discount of discountsToMigrate) {
            try {
                const createdDiscount = await client.discounts.create(discount as any);
                logger.success(`Migrated: ${discount.name} (${discount.code}) (Dodo ID: ${createdDiscount.discount_id})`);
                successCount++;
            } catch (error: any) {
                logger.error(`Failed to migrate discount "${discount.name}" (${discount.code}): ${error.message}`);
                errorCount++;
            }
        }

        // Display migration summary
        logger.log('\n=== Discounts Migration Complete ===');
        logger.log(`Successfully migrated: ${successCount} discounts`);
        if (errorCount > 0) {
            logger.warn(`Errors encountered: ${errorCount}`);
        }

        return { successCount, errorCount };
    } catch (error: any) {
        logger.error('Failed to migrate discounts!', error.message);
        return { successCount: 0, errorCount: 1 };
    }
}

// Customer migration implementation
interface CustomerToMigrate {
    email: string;
    name?: string;
    phone?: string;
    address?: {
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        postal_code?: string;
        country?: string;
    };
    brand_id: string;
    metadata: {
        paddle_customer_id: string;
        migrated_from: string;
        migrated_at: string;
    };
}

async function migrateCustomers(apiKey: string, client: DodoPayments, brand_id: string, environment: 'production' | 'sandbox') {
    logger.log('\n=== Starting Customers Migration ===');

    try {
        logger.log('Fetching customers from Paddle...');
        const customers = await fetchAllPages('/customers', apiKey, environment);

        if (customers.length === 0) {
            logger.log('No customers found in Paddle. Skipping customers migration.');
            return;
        }

        logger.log(`Found ${customers.length} customers to process`);

        // Fetch all addresses in bulk to avoid N+1 query pattern
        logger.log('Fetching customer addresses...');
        const allAddresses = await fetchAllPages('/addresses', apiKey, environment);
        logger.log(`Found ${allAddresses.length} addresses`);

        // Group addresses by customer ID for efficient lookup
        const addressesByCustomer = new Map<string, any[]>();
        for (const address of allAddresses) {
            const customerId = address.customer_id;
            if (!addressesByCustomer.has(customerId)) {
                addressesByCustomer.set(customerId, []);
            }
            addressesByCustomer.get(customerId)!.push(address);
        }

        // Transform Paddle customers to Dodo format
        const customersToMigrate: CustomerToMigrate[] = [];

        for (const customer of customers) {
            // Skip customers without email (required field in Dodo)
            if (!customer.email) {
                logger.log(`Skipping customer ${customer.id} - no email address`);
                continue;
            }

            // Skip inactive customers
            if (customer.status !== 'active') {
                logger.log(`Skipping inactive customer: ${customer.id}`);
                continue;
            }

            // Get addresses for this customer from our pre-fetched data
            let addressBlock: any = null;
            const customerAddresses = addressesByCustomer.get(customer.id) || [];
            const primary = customerAddresses.find((a: any) => a.status === 'active');
            if (primary) {
                addressBlock = {
                    ...(primary.first_line ? { line1: primary.first_line } : {}),
                    ...(primary.second_line ? { line2: primary.second_line } : {}),
                    ...(primary.city ? { city: primary.city } : {}),
                    ...(primary.region ? { state: primary.region } : {}),
                    ...(primary.postal_code ? { postal_code: primary.postal_code } : {}),
                    ...(primary.country_code ? { country: primary.country_code } : {}),
                };
            }

            const transformedCustomer: CustomerToMigrate = {
                email: customer.email,
                ...(customer.name ? { name: customer.name } : {}),
                ...(addressBlock ? { address: addressBlock } : {}),
                brand_id: brand_id,
                metadata: {
                    paddle_customer_id: customer.id,
                    migrated_from: 'paddle',
                    migrated_at: new Date().toISOString()
                }
            };

            customersToMigrate.push(transformedCustomer);
        }

        if (customersToMigrate.length === 0) {
            logger.log('No valid customers found to migrate.');
            return;
        }

        // Show preview of customers that will be migrated
        logger.log('\n[PREVIEW] Customers to be migrated:');
        logger.log('=====================================');

        customersToMigrate.forEach((customer, index) => {
            logger.log(`\n${index + 1}. ${customer.name || 'Unnamed'}`);
            logger.log(`   Email: ${customer.email}`);
        });

        logger.log('\n=====================================');

        // Ask for confirmation before creating customers
        let shouldProceed = 'yes';
        if (process.stdin.isTTY) {
            const { select } = await import('@inquirer/prompts');
            shouldProceed = await select({
                message: `Proceed with migrating ${customersToMigrate.length} customers to Dodo Payments?`,
                choices: [
                    { name: 'Yes', value: 'yes' },
                    { name: 'No', value: 'no' }
                ]
            });
        } else {
            logger.log('Non-interactive mode: proceeding with customers migration automatically');
        }

        if (shouldProceed !== 'yes') {
            logger.log('Customers migration cancelled by user.');
            return;
        }

        // Create customers in Dodo Payments
        logger.log('\nStarting customers migration...');
        let successCount = 0;
        let errorCount = 0;

        for (const customer of customersToMigrate) {
            try {
                const createdCustomer = await client.customers.create(customer as any);
                logger.success(`Migrated: ${customer.name || customer.email} (Dodo ID: ${createdCustomer.customer_id})`);
                successCount++;
            } catch (error: any) {
                logger.error(`Failed to migrate customer "${customer.name || customer.email}": ${error.message}`);
                errorCount++;
            }
        }

        // Display migration summary
        logger.log('\n=== Customers Migration Complete ===');
        logger.log(`Successfully migrated: ${successCount} customers`);
        if (errorCount > 0) {
            logger.warn(`Errors encountered: ${errorCount}`);
        }

        return { successCount, errorCount };
    } catch (error: any) {
        logger.error('Failed to migrate customers!', error.message);
        return { successCount: 0, errorCount: 1 };
    }
}
