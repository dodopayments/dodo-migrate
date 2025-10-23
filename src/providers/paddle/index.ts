import DodoPayments from 'dodopayments';
import { input, select, checkbox, password } from '@inquirer/prompts';

// Paddle API types based on their API documentation
interface PaddleProduct {
    id: string;
    name: string;
    description: string | null;
    type: string;
    tax_category: string;
    image_url: string | null;
    custom_data: object | null;
    status: string;
    created_at: string;
    updated_at: string;
}

interface PaddlePrice {
    id: string;
    product_id: string;
    description: string | null;
    type: string;
    billing_cycle: {
        interval: string;
        frequency: number;
    } | null;
    trial_period: {
        interval: string;
        frequency: number;
    } | null;
    tax_mode: string;
    unit_price: {
        amount: string;
        currency_code: string;
    };
    unit_price_overrides: any[];
    quantity: {
        minimum: number;
        maximum: number | null;
    };
    status: string;
    custom_data: object | null;
    import_meta: object | null;
    created_at: string;
    updated_at: string;
}

interface PaddleCustomer {
    id: string;
    name: string | null;
    email: string;
    marketing_consent: boolean;
    status: string;
    custom_data: object | null;
    locale: string;
    created_at: string;
    updated_at: string;
    import_meta: object | null;
}

interface PaddleDiscount {
    id: string;
    name: string;
    description: string | null;
    type: string;
    amount: string;
    currency_code: string | null;
    status: string;
    usage_limit: number | null;
    used: number;
    starts_at: string | null;
    expires_at: string | null;
    created_at: string;
    updated_at: string;
}

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
                    console.log(`[LOG] Fetched ${response.data.length} items from ${endpoint} (page ${pageIndex + 1})`);
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
            console.log(`[WARN] Error fetching page ${pageIndex + 1} from ${endpoint}: ${error.message}`);
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
                demandOption: false,
                default: 'test_mode'
            })
            .option('migrate-types', {
                describe: 'Types of data to migrate (comma-separated: products,discounts,customers)',
                type: 'string',
                demandOption: false
            });
    },
    handler: async (argv: any) => {
        console.log('[LOG] Starting Paddle to Dodo Payments migration...\n');

        // Detect if we're in non-interactive mode (CI/CD, automated scripts)
        const isInteractive = process.stdin.isTTY;

        // Get credentials - either from CLI arguments or interactive prompts
        let PROVIDER_API_KEY = argv['provider-api-key'];
        let PADDLE_ENV: 'production' | 'sandbox' = argv['paddle-environment'] || 'production';
        let DODO_API_KEY = argv['dodo-api-key'];
        let MODE = argv['mode'] || 'test_mode';

        // Validate that all required credentials are provided in non-interactive mode
        if (!PROVIDER_API_KEY) {
            if (!isInteractive) {
                console.log('[ERROR] --provider-api-key required in non-interactive mode');
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

        if (!DODO_API_KEY) {
            if (!isInteractive) {
                console.log('[ERROR] --dodo-api-key required in non-interactive mode');
                process.exit(1);
            }
            DODO_API_KEY = (await password({
                message: 'Enter your Dodo Payments API key:',
                mask: '*'
            })).trim();
        }

        if (!MODE || MODE === 'select') {
            if (!isInteractive) {
                MODE = 'test_mode'; // Default to test mode in non-interactive
            } else {
                MODE = await select({
                    message: 'Select Dodo Payments environment:',
                    choices: [
                        { name: 'Test Mode', value: 'test_mode' },
                        { name: 'Live Mode', value: 'live_mode' }
                    ],
                });
            }
        }

        // Test Paddle API connection
        try {
            await makePaddleRequest('/products?per_page=1', PROVIDER_API_KEY, {}, PADDLE_ENV);
            console.log('[LOG] Successfully connected to Paddle');
        } catch (error: any) {
            console.log('[ERROR] Failed to connect to Paddle!');
            console.log('[ERROR] Please check your Paddle API key');
            console.log(`[ERROR] Error details: ${error.message}`);
            process.exit(1);
        }

        // Initialize Dodo Payments SDK
        const client = new DodoPayments({
            bearerToken: DODO_API_KEY,
            environment: MODE,
        });

        // Select the Dodo Payments brand to migrate to
        let brand_id = argv['dodo-brand-id'];
        if (!brand_id) {
            if (!isInteractive) {
                console.log('[ERROR] --dodo-brand-id required in non-interactive mode');
                process.exit(1);
            }
            
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

        // Determine which data types to migrate (products, discounts, customers)
        let migrateTypes: string[] = [];
        if (argv['migrate-types']) {
            migrateTypes = argv['migrate-types'].split(',').map((type: string) => type.trim());
        } else {
            if (!isInteractive) {
                // In non-interactive mode, default to products only (safest option)
                migrateTypes = ['products'];
                console.log(`[LOG] Non-interactive mode: defaulting to migrate products only`);
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

        console.log(`[LOG] Will migrate: ${migrateTypes.join(', ')}`);

        // Execute the selected migrations
        let hasFailures = false;
        
        if (migrateTypes.includes('products')) {
            const productResult = await migrateProducts(PROVIDER_API_KEY, client, brand_id, PADDLE_ENV);
            if (productResult && productResult.errorCount > 0) {
                hasFailures = true;
            }
        }

        if (migrateTypes.includes('discounts')) {
            const discountResult = await migrateDiscounts(PROVIDER_API_KEY, client, brand_id, PADDLE_ENV);
            if (discountResult && discountResult.errorCount > 0) {
                hasFailures = true;
            }
        }

        if (migrateTypes.includes('customers')) {
            const customerResult = await migrateCustomers(PROVIDER_API_KEY, client, brand_id, PADDLE_ENV);
            if (customerResult && customerResult.errorCount > 0) {
                hasFailures = true;
            }
        }

        if (hasFailures) {
            console.log('\n[LOG] Migration completed with some failures. Check the logs above for details.');
            process.exit(1);
        } else {
            console.log('\n[LOG] Migration completed successfully!');
            process.exit(0);
        }
    }
};

// Product migration implementation
interface ProductToMigrate {
    type: 'one_time_product' | 'subscription_product';
    paddle_id: string;
    data: any;
}

async function migrateProducts(apiKey: string, client: DodoPayments, brand_id: string, environment: 'production' | 'sandbox') {
    console.log('\n[LOG] === Starting Products Migration ===');
    
    try {
        console.log('[LOG] Fetching products from Paddle...');
        const products = await fetchAllPages('/products', apiKey, environment);
        
        if (products.length === 0) {
            console.log('[LOG] No products found in Paddle. Skipping products migration.');
            return;
        }
        
        console.log(`[LOG] Found ${products.length} products to migrate`);
        
        // Fetch all prices to associate with products
        console.log('[LOG] Fetching prices from Paddle...');
        const prices = await fetchAllPages('/prices', apiKey, environment);
        console.log(`[LOG] Found ${prices.length} prices`);
        
        
        // Transform Paddle products to Dodo format
        const productsToMigrate: ProductToMigrate[] = [];
        
        for (const product of products) {
            // Skip archived products
            if (product.status !== 'active') {
                console.log(`[LOG] Skipping archived product: ${product.name}`);
                continue;
            }
            
            // Find prices for this product
            const productPrices = prices.filter(price => price.product_id === product.id);
            
            if (productPrices.length === 0) {
                console.log(`[LOG] Skipping product ${product.name} - no prices found`);
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
                    console.log(`[WARN] Invalid price amount "${price.unit_price.amount}" for product "${product.name}", skipping.`);
                    continue;
                }
                
                const currency = price.unit_price.currency_code.toUpperCase();
                
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
                        console.log(`[WARN] Unsupported billing interval "${interval}" for product "${product.name}", skipping.`);
                        continue;
                    }
                    
                    productsToMigrate.push({
                        type: 'subscription_product',
                        paddle_id: product.id,
                        data: {
                            name: product.name,
                            description: product.description || '',
                            tax_category: 'saas',
                            price: {
                                currency: currency,
                                price: unitPrice,
                                discount: 0,
                                purchasing_power_parity: false,
                                type: 'recurring_price',
                                billing_period: billingPeriod,
                                payment_frequency_interval: intervalUnit,
                                payment_frequency_count: frequency,
                                subscription_period_interval: intervalUnit,
                                subscription_period_count: frequency
                            },
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
                    productsToMigrate.push({
                        type: 'one_time_product',
                        paddle_id: product.id,
                        data: {
                            name: product.name,
                            description: product.description || '',
                            tax_category: 'saas',
                            price: {
                                currency: currency,
                                price: unitPrice,
                                discount: 0,
                                purchasing_power_parity: false,
                                type: 'one_time_price'
                            },
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
            console.log('[LOG] No compatible products found to migrate.');
            return;
        }
        
        // Show preview of products that will be migrated
        console.log('\n[PREVIEW] Products to be migrated:');
        console.log('=====================================');
        
        productsToMigrate.forEach((product, index) => {
            const price = product.data.price.price / 100;
            const type = product.type === 'one_time_product' ? 'One Time' : 'Subscription';
            const billing = product.type === 'subscription_product' ? ` (${product.data.price.billing_period})` : '';
            
            console.log(`\n${index + 1}. ${product.data.name}`);
            console.log(`   Type: ${type}${billing}`);
            console.log(`   Price: ${product.data.price.currency} ${price.toFixed(2)}`);
            console.log(`   Paddle ID: ${product.paddle_id}`);
        });
        
        console.log('\n=====================================');
        
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
            console.log('[LOG] Non-interactive mode: proceeding with products migration automatically');
        }
        
        if (shouldProceed !== 'yes') {
            console.log('[LOG] Products migration cancelled by user.');
            return;
        }
        
        // Create products in Dodo Payments
        console.log('\n[LOG] Starting products migration...');
        let successCount = 0;
        let errorCount = 0;
        
        for (const product of productsToMigrate) {
            try {
                const createdProduct = await client.products.create(product.data);
                console.log(`[SUCCESS] Migrated: ${product.data.name} (Dodo ID: ${createdProduct.product_id})`);
                successCount++;
            } catch (error: any) {
                console.error(`[ERROR] Failed to migrate product "${product.data.name}": ${error.message}`);
                errorCount++;
            }
        }
        
        // Display migration summary
        console.log('\n[LOG] === Products Migration Complete ===');
        console.log(`[LOG] Successfully migrated: ${successCount} products`);
        if (errorCount > 0) {
            console.log(`[WARN] Errors encountered: ${errorCount}`);
        }
        
        return { successCount, errorCount };
    } catch (error: any) {
        console.error('[ERROR] Failed to migrate products!', error.message);
        return { successCount: 0, errorCount: 1 };
    }
}

// Discount migration implementation
interface DiscountToMigrate {
    [key: string]: any;
}

async function migrateDiscounts(apiKey: string, client: DodoPayments, brand_id: string, environment: 'production' | 'sandbox') {
    console.log('\n[LOG] === Starting Discounts Migration ===');
    
    try {
        console.log('[LOG] Fetching discounts from Paddle...');
        const discounts = await fetchAllPages('/discounts', apiKey, environment);
        
        if (discounts.length === 0) {
            console.log('[LOG] No discounts found in Paddle. Skipping discounts migration.');
            return;
        }
        
        console.log(`[LOG] Found ${discounts.length} discounts to process`);
        
        // Transform Paddle discounts to Dodo format
        const discountsToMigrate: DiscountToMigrate[] = [];
        
        for (const discount of discounts) {
            // Skip inactive discounts
            if (discount.status !== 'active') {
                console.log(`[LOG] Skipping inactive discount: ${discount.code || discount.id}`);
                continue;
            }
            
            // Skip expired discounts
            if (discount.expires_at && new Date(discount.expires_at) < new Date()) {
                console.log(`[LOG] Skipping expired discount: ${discount.code || discount.id}`);
                continue;
            }
            
            // Skip discounts without a code (required for Dodo Payments)
            if (!discount.code) {
                console.log(`[LOG] Skipping discount "${discount.id}" - no code found (required for Dodo Payments)`);
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
                    console.log(`[WARN] Invalid discount amount "${discount.amount}" for discount "${discount.code}", skipping.`);
                    continue;
                }
                
                discountValue = Math.round(parsedAmount * 100);
            } else if (discount.type === 'flat') {
                // Dodo Payments API currently only supports percentage discounts
                console.log(`[WARN] Skipping flat-amount discount "${discount.code}" - Dodo Payments only supports percentage discounts`);
                continue;
            } else {
                console.log(`[WARN] Skipping discount "${discount.code}" - unsupported type: ${discount.type}`);
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
            console.log('[LOG] No compatible discounts found to migrate.');
            return;
        }
        
        // Show preview of discounts that will be migrated
        console.log('\n[PREVIEW] Discounts to be migrated:');
        console.log('=====================================');
        
        discountsToMigrate.forEach((discount, index) => {
            const value = `${(discount.amount / 100).toFixed(0)}%`;
            
            const usageLimit = discount.usage_limit 
                ? `${discount.usage_limit} uses` 
                : 'Unlimited';
            
            const expiration = discount.expires_at 
                ? new Date(discount.expires_at).toLocaleDateString() 
                : 'No expiration';
            
            console.log(`\n${index + 1}. ${discount.name} (${discount.code})`);
            console.log(`   Type: ${discount.type}`);
            console.log(`   Value: ${value}`);
            console.log(`   Usage Limit: ${usageLimit}`);
            console.log(`   Expires: ${expiration}`);
        });
        
        console.log('\n=====================================');
        
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
            console.log('[LOG] Non-interactive mode: proceeding with discounts migration automatically');
        }
        
        if (shouldProceed !== 'yes') {
            console.log('[LOG] Discounts migration cancelled by user.');
            return;
        }
        
        // Create discounts in Dodo Payments
        console.log('\n[LOG] Starting discounts migration...');
        let successCount = 0;
        let errorCount = 0;
        
        for (const discount of discountsToMigrate) {
            try {
                const createdDiscount = await client.discounts.create(discount as any);
                console.log(`[SUCCESS] Migrated: ${discount.name} (${discount.code}) (Dodo ID: ${createdDiscount.discount_id})`);
                successCount++;
            } catch (error: any) {
                console.error(`[ERROR] Failed to migrate discount "${discount.name}" (${discount.code}): ${error.message}`);
                errorCount++;
            }
        }
        
        // Display migration summary
        console.log('\n[LOG] === Discounts Migration Complete ===');
        console.log(`[LOG] Successfully migrated: ${successCount} discounts`);
        if (errorCount > 0) {
            console.log(`[WARN] Errors encountered: ${errorCount}`);
        }
        
        return { successCount, errorCount };
    } catch (error: any) {
        console.error('[ERROR] Failed to migrate discounts!', error.message);
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
    console.log('\n[LOG] === Starting Customers Migration ===');
    
    try {
        console.log('[LOG] Fetching customers from Paddle...');
        const customers = await fetchAllPages('/customers', apiKey, environment);
        
        if (customers.length === 0) {
            console.log('[LOG] No customers found in Paddle. Skipping customers migration.');
            return;
        }
        
        console.log(`[LOG] Found ${customers.length} customers to process`);
        
        // Fetch all addresses in bulk to avoid N+1 query pattern
        console.log('[LOG] Fetching customer addresses...');
        const allAddresses = await fetchAllPages('/addresses', apiKey, environment);
        console.log(`[LOG] Found ${allAddresses.length} addresses`);
        
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
                console.log(`[LOG] Skipping customer ${customer.id} - no email address`);
                continue;
            }
            
            // Skip inactive customers
            if (customer.status !== 'active') {
                console.log(`[LOG] Skipping inactive customer: ${customer.id}`);
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
            console.log('[LOG] No valid customers found to migrate.');
            return;
        }
        
        // Show preview of customers that will be migrated
        console.log('\n[PREVIEW] Customers to be migrated:');
        console.log('=====================================');
        
        customersToMigrate.forEach((customer, index) => {
            console.log(`\n${index + 1}. ${customer.name || 'Unnamed'}`);
            console.log(`   Email: ${customer.email}`);
        });
        
        console.log('\n=====================================');
        
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
            console.log('[LOG] Non-interactive mode: proceeding with customers migration automatically');
        }
        
        if (shouldProceed !== 'yes') {
            console.log('[LOG] Customers migration cancelled by user.');
            return;
        }
        
        // Create customers in Dodo Payments
        console.log('\n[LOG] Starting customers migration...');
        let successCount = 0;
        let errorCount = 0;
        
        for (const customer of customersToMigrate) {
            try {
                const createdCustomer = await client.customers.create(customer as any);
                console.log(`[SUCCESS] Migrated: ${customer.name || customer.email} (Dodo ID: ${createdCustomer.customer_id})`);
                successCount++;
            } catch (error: any) {
                console.error(`[ERROR] Failed to migrate customer "${customer.name || customer.email}": ${error.message}`);
                errorCount++;
            }
        }
        
        // Display migration summary
        console.log('\n[LOG] === Customers Migration Complete ===');
        console.log(`[LOG] Successfully migrated: ${successCount} customers`);
        if (errorCount > 0) {
            console.log(`[WARN] Errors encountered: ${errorCount}`);
        }
        
        return { successCount, errorCount };
    } catch (error: any) {
        console.error('[ERROR] Failed to migrate customers!', error.message);
        return { successCount: 0, errorCount: 1 };
    }
}
