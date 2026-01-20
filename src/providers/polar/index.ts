import { Polar } from '@polar-sh/sdk';
import DodoPayments from 'dodopayments';
import { select, checkbox, password } from '@inquirer/prompts';
import { logger } from '../../utils/logger';
import { getDodoCredentials, setupDodoClient, selectDodoBrand } from '../../utils/dodo';

export default {
    command: 'polar [arguments]',
    describe: 'Migrate from Polar.sh to Dodo Payments',
    builder: (yargs: any) => {
        return yargs
            .option('provider-api-key', {
                describe: 'Polar.sh Organization Access Token',
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
            .option('migrate-types', {
                describe: 'Types of data to migrate (comma-separated: products,discounts,customers)',
                type: 'string',
                demandOption: false,
            })
            .option('polar-organization-id', {
                describe: 'Polar.sh Organization ID (if user has multiple orgs)',
                type: 'string',
                demandOption: false
            });
    },
    handler: async (argv: any) => {
        logger.log('Starting Polar.sh to Dodo Payments migration...\n');

        // Detect if we're in non-interactive mode (CI/CD, automated scripts)
        const isInteractive = process.stdin.isTTY;

        // Get credentials - either from CLI arguments or interactive prompts
        let PROVIDER_API_KEY = argv['provider-api-key'];
        // Validate that all required credentials are provided in non-interactive mode
        if (!PROVIDER_API_KEY) {
            if (!isInteractive) {
                logger.error('--provider-api-key required in non-interactive mode');
                process.exit(1);
            }
            PROVIDER_API_KEY = (await password({
                message: 'Enter your Polar.sh Organization Access Token:',
                mask: '*',
                validate: (value: string) => {
                    if (value.length < 10) {
                        return 'Invalid Polar.sh Organization Access Token';
                    }
                    return true;
                },
            })).trim();
        }

        const { apiKey: DODO_API_KEY, mode: MODE } = await getDodoCredentials(argv);

        // Initialize Polar SDK with the access token
        const polar = new Polar({
            accessToken: PROVIDER_API_KEY
        });

        // Verify Polar.sh connection and fetch available organizations
        const organizations: any[] = [];
        try {
            let page = 1;
            let hasMore = true;
            while (hasMore) {
                const response = await polar.organizations.list({ page });
                if (response.result?.items?.length) {
                    organizations.push(...response.result.items);
                }
                // Check if there are more pages based on pagination metadata
                const pagination = response.result?.pagination;
                hasMore = pagination ? page < pagination.maxPage : false;
                page++;
            }
            logger.log('Successfully connected to Polar.sh');

            if (organizations.length === 0) {
                logger.error('No organizations found for this access token');
                logger.error('Please check your Organization Access Token at https://polar.sh/settings/tokens');
                process.exit(1);
            }
        } catch (error: any) {
            // Check for rate limiting (429 Too Many Requests)
            if (error.statusCode === 429 || error.status === 429) {
                const retryAfter = error.headers?.['retry-after'] || error.response?.headers?.['retry-after'] || 'unknown';
                logger.error(`Polar.sh API rate limit exceeded (300 requests/minute). Retry after ${retryAfter} seconds.`);
                process.exit(1);
            }
            logger.error('Failed to connect to Polar.sh');
            logger.error('Please check your Organization Access Token at https://polar.sh/settings/tokens');
            process.exit(1);
        }

        // Initialize Dodo Payments SDK
        const client = setupDodoClient(DODO_API_KEY, MODE);

        // Select the Polar.sh organization to migrate from
        let organization_id = argv['polar-organization-id'];
        if (!organization_id) {
            if (organizations.length === 1) {
                organization_id = organizations[0].id;
                logger.log(`Using organization: ${organizations[0].name}`);
            } else {
                if (!isInteractive) {
                    logger.error('Multiple Polar.sh organizations detected. Please provide --polar-organization-id flag.');
                    process.exit(1);
                }
                organization_id = await select({
                    message: 'Select your Polar.sh organization:',
                    choices: organizations.map((org: any) => ({
                        name: org.name || 'Unnamed Organization',
                        value: org.id,
                    })),
                });
            }
        }

        // Select the Dodo Payments brand to migrate to
        const brand_id = await selectDodoBrand(client, argv);

        // Determine which data types to migrate (products, discounts, customers)
        let migrateTypes: string[] = [];
        if (argv['migrate-types']) {
            migrateTypes = argv['migrate-types'].split(',').map((type: string) => type.trim());
        } else {
            if (!isInteractive) {
                // In non-interactive mode, default to products and discounts (safest option)

                migrateTypes = ['products', 'discounts'];
                logger.log(`Non-interactive mode: defaulting to migrate products and discounts`);
            } else {
                migrateTypes = await checkbox({
                    message: 'Select what you want to migrate:',
                    choices: [
                        { name: 'Products', value: 'products', checked: true },
                        { name: 'Discounts', value: 'discounts', checked: true },
                        { name: 'Customers', value: 'customers', checked: false }
                    ],
                    required: true
                });
            }
        }

        logger.log(`Will migrate: ${migrateTypes.join(', ')}`);

        // Execute the selected migrations
        const completedMigrations: string[] = [];

        if (migrateTypes.includes('products')) {
            const completed = await migrateProducts(polar, client, organization_id, brand_id);
            if (completed) completedMigrations.push('products');
        }

        if (migrateTypes.includes('discounts')) {
            const completed = await migrateDiscounts(polar, client, organization_id, brand_id);
            if (completed) completedMigrations.push('discounts');
        }

        if (migrateTypes.includes('customers')) {
            const completed = await migrateCustomers(polar, client, organization_id, brand_id);
            if (completed) completedMigrations.push('customers');
        }

        if (completedMigrations.length > 0) {
            logger.success(`Migration completed for: ${completedMigrations.join(', ')}`);
        }

        // Exit with success code (important for CI/CD pipelines)
        process.exit(0);
    }
};

// Product migration implementation
interface ProductToMigrate {
    type: 'one_time_product' | 'subscription_product';
    polar_id: string;
    data: any; // Using any to match Stripe provider pattern
    benefits: Array<{ description: string }>;
}

async function migrateProducts(polar: Polar, client: any, organization_id: string, brand_id: string): Promise<boolean> {
    logger.log('\n=== Starting Products Migration ===');

    try {
        logger.log('Fetching products from Polar.sh...');
        const products: any[] = [];
        try {
            let page = 1;
            let hasMore = true;
            while (hasMore) {
                const response = await polar.products.list({ organizationId: organization_id, page });
                if (response.result?.items?.length) {
                    products.push(...response.result.items);
                }
                const pagination = response.result?.pagination;
                hasMore = pagination ? page < pagination.maxPage : false;
                page++;
            }
        } catch (error: any) {
            // Check for rate limiting (429 Too Many Requests)
            if (error.statusCode === 429 || error.status === 429) {
                const retryAfter = error.headers?.['retry-after'] || error.response?.headers?.['retry-after'] || 'unknown';
                logger.error(`Polar.sh API rate limit exceeded (300 requests/minute). Retry after ${retryAfter} seconds.`);
                process.exit(1);
            }
            throw error;
        }

        if (products.length === 0) {
            logger.log('No products found in Polar.sh. Skipping products migration.');
            return false;
        }

        logger.log(`Found ${products.length} products to migrate`);

        // Transform Polar products to Dodo format
        const productsToMigrate: ProductToMigrate[] = [];

        for (const product of products) {
            // Warn if product has benefits (license keys, GitHub access, etc.) that can't be migrated
            if (product.benefits && product.benefits.length > 0) {
                logger.warn(`Product "${product.name}" has ${product.benefits.length} benefits that require manual setup.`);
            }

            // Process each price variant in the product
            const prices = product.prices || [];

            if (prices.length === 0) {
                logger.warn(`Product "${product.name}" has no prices, skipping.`);
                continue;
            }

            // IMPORTANT: Polar products can have multiple price variants, but Dodo doesn't support
            // multiple prices per product. Solution: Create one Dodo product per Polar price variant.
            // Example: Polar product "Pro Plan" with $10 USD and €9 EUR → 2 Dodo products
            for (const price of prices) {
                // Skip archived prices
                if (price.isArchived) {
                    continue;
                }

                // Determine if this is a subscription or one-time purchase
                const isRecurring = price.type === 'recurring';
                const recurringInterval = isRecurring ? price.recurringInterval : null;

                // Filter: Only migrate fixed-amount prices (skip pay-what-you-want and metered)
                // Polar supports 'fixed', 'custom' (PWYW), 'free', 'metered_unit' pricing
                if (price.amountType !== 'fixed') {
                    logger.warn(`Skipping non-fixed price (${price.amountType}) for product "${product.name}"`);
                    continue;
                }

                // Type narrowing: Extract price amount and currency from Polar's discriminated union
                // TypeScript needs runtime checks to access properties of union types
                const priceAmount = typeof price.priceAmount === 'number' ? price.priceAmount : 0;
                const priceCurrency = price.priceCurrency || 'usd';

                // Create descriptive product names when splitting variants
                // Single price: "Pro Plan"
                // Multiple prices: "Pro Plan (USD 10.00)", "Pro Plan (EUR 9.00)"
                const variantName = prices.length > 1
                    ? `${product.name} (${priceCurrency.toUpperCase()} ${priceAmount / 100})`
                    : product.name;

                if (isRecurring && recurringInterval) {
                    // Transform recurring intervals: Polar uses 'month'/'year', Dodo uses 'monthly'/'yearly'
                    // Polar supports: month, year (and potentially week, day but not in scope)
                    // Dodo supports: monthly, yearly
                    // Unsupported intervals (week, day) are skipped with warning
                    let billingPeriod: 'monthly' | 'yearly';
                    if (recurringInterval === 'month') {
                        billingPeriod = 'monthly';
                    } else if (recurringInterval === 'year') {
                        billingPeriod = 'yearly';
                    } else {
                        logger.warn(`Unsupported recurring interval "${recurringInterval}" for product "${product.name}", skipping.`);
                        continue;
                    }

                    // Map billing period to payment/subscription intervals
                    // Dodo expects capitalized values: Day, Week, Month, Year
                    // For standard subscriptions, payment frequency = subscription period
                    const intervalUnit = billingPeriod === 'monthly' ? 'Month' : 'Year';

                    productsToMigrate.push({
                        type: 'subscription_product',
                        polar_id: product.id,
                        data: {
                            name: variantName,
                            description: product.description || '',
                            tax_category: 'saas',
                            price: {
                                currency: priceCurrency.toUpperCase(),
                                price: priceAmount,
                                discount: 0,
                                purchasing_power_parity: false,
                                type: 'recurring_price',
                                billing_period: billingPeriod,
                                payment_frequency_count: 1,
                                payment_frequency_interval: intervalUnit,
                                subscription_period_count: 240, // 20 years max subscription period
                                subscription_period_interval: intervalUnit
                            },
                            brand_id: brand_id
                        },
                        benefits: (product.benefits || []).map((b: any) => ({ description: b.description }))
                    });
                } else {
                    // One-time product
                    productsToMigrate.push({
                        type: 'one_time_product',
                        polar_id: product.id,
                        data: {
                            name: variantName,
                            description: product.description || '',
                            tax_category: 'saas',
                            price: {
                                currency: priceCurrency.toUpperCase(),
                                price: priceAmount,
                                discount: 0,
                                purchasing_power_parity: false,
                                type: 'one_time_price'
                            },
                            brand_id: brand_id
                        },
                        benefits: (product.benefits || []).map((b: any) => ({ description: b.description }))
                    });
                }
            }
        }

        if (productsToMigrate.length === 0) {
            logger.log('No compatible products found to migrate.');
            return false;
        }

        // Show preview of products that will be migrated
        logger.log('\n[PREVIEW] Products to be migrated:');
        logger.log('=====================================');

        productsToMigrate.forEach((product, index) => {
            const price = product.data.price.price / 100;
            const type = product.type === 'one_time_product' ? 'One Time' : 'Subscription';
            const billing = product.type === 'subscription_product' ? ` (${product.data.price.billing_period})` : '';

            logger.log(`\n${index + 1}. ${product.data.name}`);
            logger.log(`   Type: ${type}${billing}`);
            logger.log(`   Price: ${product.data.price.currency} ${price.toFixed(2)}`);
            logger.log(`   Polar ID: ${product.polar_id}`);

            if (product.benefits.length > 0) {
                logger.log(`   ⚠️  Benefits (${product.benefits.length}): Requires manual setup`);
                product.benefits.forEach((benefit, idx) => {
                    logger.log(`     ${idx + 1}. ${benefit.description}`);
                });
            }
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
            return false;
        }

        // Create products in Dodo Payments
        logger.log('\n[LOG] Starting products migration...');
        let successCount = 0;
        let errorCount = 0;

        for (const product of productsToMigrate) {
            try {
                const createdProduct = await client.products.create(product.data);
                logger.success(`Migrated: ${product.data.name} (Dodo ID: ${createdProduct.product_id})`);
                successCount++;
            } catch (error: any) {
                // Continue migrating other products even if one fails
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
        return true;
    } catch (error: any) {
        logger.error('Failed to migrate products!', error.message);
        return false;
    }
}

// Discount migration implementation  
interface DiscountToMigrate {
    [key: string]: any; // Using any to match Stripe provider pattern
}

async function migrateDiscounts(polar: Polar, client: DodoPayments, organization_id: string, brand_id: string): Promise<boolean> {
    logger.log('\n[LOG] === Starting Discounts Migration ===');

    try {
        logger.log('Fetching discounts from Polar.sh...');
        const discounts: any[] = [];
        try {
            let page = 1;
            let hasMore = true;
            while (hasMore) {
                const response = await polar.discounts.list({ organizationId: organization_id, page });
                if (response.result?.items?.length) {
                    discounts.push(...response.result.items);
                }
                const pagination = response.result?.pagination;
                hasMore = pagination ? page < pagination.maxPage : false;
                page++;
            }
        } catch (error: any) {
            // Check for rate limiting (429 Too Many Requests)
            if (error.statusCode === 429 || error.status === 429) {
                const retryAfter = error.headers?.['retry-after'] || error.response?.headers?.['retry-after'] || 'unknown';
                logger.error(`Polar.sh API rate limit exceeded (300 requests/minute). Retry after ${retryAfter} seconds.`);
                process.exit(1);
            }
            throw error;
        }

        if (discounts.length === 0) {
            logger.log('No discounts found in Polar.sh. Skipping discounts migration.');
            return false;
        }

        logger.log(`Found ${discounts.length} discounts to process`);

        // Transform Polar discounts to Dodo format
        const discountsToMigrate: DiscountToMigrate[] = [];

        for (const discount of discounts) {
            // Skip discounts that have already expired
            if (discount.endsAt && new Date(discount.endsAt) < new Date()) {
                logger.log(`Skipping expired discount: ${discount.code}`);
                continue;
            }

            // Warn if discount is restricted to specific products (not supported in Dodo)
            if ('products' in discount && discount.products && discount.products.length > 0) {
                logger.warn(`Discount "${discount.code}" is restricted to ${discount.products.length} specific products. Product restrictions cannot be migrated to Dodo Payments.`);
            }

            // Skip discounts without code
            if (!discount.code) {
                logger.warn(`Skipping discount without code`);
                continue;
            }

            // Determine discount type and value
            // NOTE: Dodo Payments currently only supports percentage discounts
            let discountType: 'percentage';
            let discountValue: number;

            if (discount.type === 'percentage') {
                discountType = 'percentage';
                // Both Polar and Dodo use basis points (e.g., 2000 basis points = 20%)
                const basisPoints = 'basisPoints' in discount ? discount.basisPoints : 0;
                discountValue = basisPoints; // Keep as basis points
            } else if (discount.type === 'fixed') {
                // Dodo Payments API currently only supports percentage discounts
                // Fixed-amount discounts cannot be migrated
                logger.warn(`Skipping fixed-amount discount "${discount.code}" - Dodo Payments only supports percentage discounts`);
                continue;
            } else {
                logger.warn(`Skipping discount "${discount.code}" - unsupported type: ${discount.type}`);
                continue;
            }

            // Handle expiration date conversion
            let expiresAt: string | null = null;
            if (discount.endsAt) {
                expiresAt = discount.endsAt instanceof Date ? discount.endsAt.toISOString() : String(discount.endsAt);
            }

            const transformedDiscount: DiscountToMigrate = {
                code: discount.code,
                name: discount.name || discount.code,
                type: discountType,
                amount: discountValue,
                usage_limit: discount.maxRedemptions || null,
                expires_at: expiresAt,
                brand_id: brand_id
            };

            discountsToMigrate.push(transformedDiscount);
        }

        if (discountsToMigrate.length === 0) {
            logger.log('No compatible discounts found to migrate.');
            return false;
        }

        // Show preview of discounts that will be migrated
        logger.log('\n[PREVIEW] Discounts to be migrated:');
        logger.log('=====================================');

        discountsToMigrate.forEach((discount, index) => {
            // Display percentage value (discount.amount is already in basis points from conversion)
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
            return false;
        }

        // Create discounts in Dodo Payments
        logger.log('\n[LOG] Starting discounts migration...');
        let successCount = 0;
        let errorCount = 0;

        for (const discount of discountsToMigrate) {
            try {
                const createdDiscount = await client.discounts.create(discount as any);
                logger.success(`Migrated: ${discount.name} (${discount.code}) (Dodo ID: ${createdDiscount.discount_id})`);
                successCount++;
            } catch (error: any) {
                // Continue migrating other discounts even if one fails
                logger.error(`Failed to migrate discount "${discount.name}" (${discount.code}): ${error.message}`);
                errorCount++;
            }
        }

        // Display migration summary
        logger.log('\n[LOG] === Discounts Migration Complete ===');
        logger.log(`Successfully migrated: ${successCount} discounts`);
        if (errorCount > 0) {
            logger.warn(`Errors encountered: ${errorCount}`);
        }
        return true;
    } catch (error: any) {
        logger.error('Failed to migrate discounts!', error.message);
        return false;
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
        polar_customer_id: string;
        polar_external_id?: string;
        polar_metadata?: Record<string, any>;
        migrated_from: string;
        migrated_at: string;
    };
}

async function migrateCustomers(polar: Polar, client: DodoPayments, organization_id: string, brand_id: string): Promise<boolean> {
    logger.log('\n[LOG] === Starting Customers Migration ===');

    try {
        logger.log('Fetching customers from Polar.sh...');
        const customers: any[] = [];
        try {
            let page = 1;
            let hasMore = true;
            while (hasMore) {
                const response = await polar.customers.list({ organizationId: organization_id, page });
                if (response.result?.items?.length) {
                    customers.push(...response.result.items);
                }
                const pagination = response.result?.pagination;
                hasMore = pagination ? page < pagination.maxPage : false;
                page++;
            }
        } catch (error: any) {
            // Check for rate limiting (429 Too Many Requests)
            if (error.statusCode === 429 || error.status === 429) {
                const retryAfter = error.headers?.['retry-after'] || error.response?.headers?.['retry-after'] || 'unknown';
                logger.error(`Polar.sh API rate limit exceeded (300 requests/minute). Retry after ${retryAfter} seconds.`);
                process.exit(1);
            }
            throw error;
        }

        if (customers.length === 0) {
            logger.log('No customers found in Polar.sh. Skipping customers migration.');
            return false;
        }

        logger.log(`Found ${customers.length} customers to process`);

        // Transform Polar customers to Dodo format
        const customersToMigrate: CustomerToMigrate[] = [];

        for (const customer of customers) {
            // Skip customers without email (required field in Dodo)
            if (!customer.email) {
                logger.log(`Skipping customer ${customer.id} - no email address`);
                continue;
            }

            // Skip customers that have been deleted in Polar
            if (customer.deletedAt) {
                logger.log(`Skipping deleted customer: ${customer.id}`);
                continue;
            }

            const transformedCustomer: CustomerToMigrate = {
                email: customer.email,
                ...(customer.name ? { name: customer.name } : {}),
                ...(customer.phone ? { phone: customer.phone } : {}),
                ...((customer.billingAddress && (
                    customer.billingAddress.line1 ||
                    customer.billingAddress.line2 ||
                    customer.billingAddress.city ||
                    customer.billingAddress.state ||
                    customer.billingAddress.postalCode ||
                    customer.billingAddress.country
                )) ? {
                    address: {
                        ...(customer.billingAddress.line1 ? { line1: customer.billingAddress.line1 } : {}),
                        ...(customer.billingAddress.line2 ? { line2: customer.billingAddress.line2 } : {}),
                        ...(customer.billingAddress.city ? { city: customer.billingAddress.city } : {}),
                        ...(customer.billingAddress.state ? { state: customer.billingAddress.state } : {}),
                        ...(customer.billingAddress.postalCode ? { postal_code: customer.billingAddress.postalCode } : {}),
                        ...(customer.billingAddress.country ? { country: customer.billingAddress.country } : {})
                    }
                } : {}),
                brand_id: brand_id,
                // Metadata structure for data reconciliation and audit trail
                // This enables linking migrated Dodo customers back to Polar records
                // Example query: dodoClient.customers.list({ metadata: { polar_customer_id: "cus_xyz" }})
                metadata: {
                    polar_customer_id: customer.id,              // Original Polar customer ID for reconciliation
                    polar_external_id: customer.externalId || undefined, // Merchant's own system ID (if set in Polar)
                    migrated_from: 'polar',                      // Source system identifier
                    migrated_at: new Date().toISOString()        // Migration timestamp in ISO 8601 format
                }
            };

            customersToMigrate.push(transformedCustomer);
        }

        if (customersToMigrate.length === 0) {
            logger.log('No valid customers found to migrate.');
            return false;
        }

        // Show preview of customers that will be migrated
        logger.log('\n[PREVIEW] Customers to be migrated:');
        logger.log('=====================================');

        customersToMigrate.forEach((customer, index) => {
            logger.log(`\n${index + 1}. ${customer.name || 'Unnamed'}`);
            logger.log(`   Email: ${customer.email}`);
            if (customer.address && customer.address.country) {
                logger.log(`   Location: ${customer.address.city || ''}${customer.address.city && customer.address.country ? ', ' : ''}${customer.address.country || ''}`);
            }
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
            return false;
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
        logger.log('\n[LOG] === Customers Migration Complete ===');
        logger.log(`Successfully migrated: ${successCount} customers`);
        if (errorCount > 0) {
            logger.warn(`Errors encountered: ${errorCount}`);
        }
        return true;
    } catch (error: any) {
        logger.error('Failed to migrate customers!', error.message);
        return false;
    }
}