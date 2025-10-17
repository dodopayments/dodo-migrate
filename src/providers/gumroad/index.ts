import axios from 'axios';
import { input, select, checkbox } from '@inquirer/prompts';
import DodoPayments from 'dodopayments';

export default {
    command: 'gumroad [arguments]',
    describe: 'Migrate from Gumroad to Dodo Payments',
    builder: (yargs: any) => {
        return yargs
            .option('provider-api-key', {
                describe: 'Gumroad API Token',
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
            .option('migrate-types', {
                describe: 'Types of data to migrate (comma-separated: products,discounts,customers)',
                type: 'string',
                demandOption: false
            });
    },
    handler: async (argv: any) => {
        const PROVIDER_API_KEY = argv['provider-api-key'] || await input({
            message: 'Enter your Gumroad API Token:',
            required: true
        });
        const DODO_API_KEY = argv['dodo-api-key'] || await input({
            message: 'Enter your Dodo Payments API Key:',
            required: true
        });
        const MODE = argv['mode'] || await select({
            message: 'Select Dodo Payments environment:',
            choices: [
                { name: 'Test Mode', value: 'test_mode' },
                { name: 'Live Mode', value: 'live_mode' }
            ],
            default: 'test_mode'
        });

        // Create Gumroad API client
        const gumroadClient = axios.create({
            baseURL: 'https://api.gumroad.com/v2',
            headers: {
                'Authorization': `Bearer ${PROVIDER_API_KEY}`
            }
        });

        // Test Gumroad connection
        try {
            await gumroadClient.get('/user');
            console.log('[LOG] Successfully connected to Gumroad');
        } catch (error: any) {
            console.log("[ERROR] Failed to connect to Gumroad!\n", error.message);
            process.exit(1);
        }

        const client = new DodoPayments({
            bearerToken: DODO_API_KEY,
            environment: MODE,
        });

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

        let migrateTypes: string[] = [];
        if (argv['migrate-types']) {
            migrateTypes = argv['migrate-types'].split(',').map((type: string) => type.trim());
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

        console.log(`[LOG] Will migrate: ${migrateTypes.join(', ')}`);

        if (migrateTypes.includes('products')) {
            await migrateProducts(gumroadClient, client, brand_id);
        }

        if (migrateTypes.includes('discounts')) {
            await migrateDiscounts(gumroadClient, client, brand_id);
        }

        if (migrateTypes.includes('customers')) {
            await migrateCustomers(gumroadClient, client, brand_id);
        }

        console.log('\n[LOG] Migration completed successfully!');
    }
};

async function migrateProducts(gumroadClient: any, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting products migration...');

    try {
        // Define interface for Gumroad product
        interface GumroadProduct {
            id: string;
            name: string;
            description?: string;
            price: number;
            currency_code: string;
            recurring?: boolean;
            [key: string]: any; // Allow other properties
        }

        // Fetch products
        const response = await gumroadClient.get('/products');

        if (!response.data || !response.data.products) {
            console.log("[ERROR] Unexpected response format from Gumroad API");
            return;
        }

        const products = response.data.products as GumroadProduct[];

        if (products.length === 0) {
            console.log('[LOG] No products found in Gumroad');
            return;
        }

        console.log(`[LOG] Found ${products.length} products in Gumroad`);

        const ProductsToMigrate: any[] = [];

        for (const product of products) {
            // Convert price to cents (assuming Gumroad price is in dollars)
            const priceInCents = Math.round(product.price * 100);

            // In Dodo Payments, we need to create separate products for each price
            const priceType = product.recurring ? 'subscription' : 'one-time';
            const priceAmount = product.price.toString().replace('.', '_');
            const priceCurrency = product.currency_code.toLowerCase();
            const productName = `${product.name}_${priceAmount}_${priceCurrency}_${priceType}`;

            // Create price configuration based on product type
            const priceConfig = product.recurring
                ? {
                    type: 'recurring_price' as const,
                    currency: product.currency_code.toLowerCase() as any,
                    price: priceInCents,
                    discount: 0,
                    purchasing_power_parity: false,
                    payment_frequency_count: 1,
                    payment_frequency_interval: 'Month' as const,
                    subscription_period_count: 1,
                    subscription_period_interval: 'Month' as const,
                }
                : {
                    type: 'one_time_price' as const,
                    currency: product.currency_code.toLowerCase() as any,
                    price: priceInCents,
                    discount: 0,
                    purchasing_power_parity: false,
                };

            ProductsToMigrate.push({
                name: productName,
                description: `${product.description || product.name} - ${product.price} ${product.currency_code} ${priceType}`,
                brand_id: brand_id,
                price: priceConfig,
                tax_category: 'saas' as any, // Using 'saas' as tax category
                metadata: {
                    gumroad_product_id: product.id,
                    amount: product.price.toString(),
                    currency: product.currency_code,
                    recurring: product.recurring ? 'true' : 'false'
                }
            });
        }

        if (ProductsToMigrate.length === 0) {
            console.log('[LOG] No products to migrate');
            return;
        }

        console.log('\n[LOG] These are the products to be migrated:');
        ProductsToMigrate.forEach((product, index) => {
            const price = product.price.price / 100;
            const type = product.price.type === 'one_time_price' ? 'One Time' : 'Subscription';
            console.log(`${index + 1}. ${product.name} - ${product.price.currency.toUpperCase()} ${price.toFixed(2)} (${type})`);
        });

        const migrateProducts = await select({
            message: 'Proceed to create these products in Dodo Payments?',
            choices: [
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            ],
        });

        if (migrateProducts === 'yes') {
            for (const product of ProductsToMigrate) {
                console.log(`[LOG] Migrating product: ${product.name}`);
                try {
                    const createdProduct = await client.products.create(product);
                    console.log(`[LOG] Migration for product: ${createdProduct.name} completed (Dodo Payments product ID: ${createdProduct.product_id})`);
                } catch (error: any) {
                    console.log(`[ERROR] Failed to migrate product: ${product.name} - ${error.message}`);
                }
            }
            console.log('[LOG] Products migration completed!');
        } else {
            console.log('[LOG] Products migration skipped by user');
        }

    } catch (error: any) {
        console.log("[ERROR] Failed to migrate products!\n", error.message);
    }
}

async function migrateDiscounts(gumroadClient: any, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting discounts migration...');

    try {
        // Define interface for Gumroad offer code
        interface GumroadOfferCode {
            id: string;
            name: string;
            offer_code: string;
            amount_off: number;
            percent_off: number;
            [key: string]: any; // Allow other properties
        }

        // Fetch offer codes
        const response = await gumroadClient.get('/offer_codes');

        if (!response.data || !response.data.offer_codes) {
            console.log("[ERROR] Unexpected response format from Gumroad API");
            return;
        }

        const offerCodes = response.data.offer_codes as GumroadOfferCode[];

        if (offerCodes.length === 0) {
            console.log('[LOG] No offer codes found in Gumroad');
            return;
        }

        console.log(`[LOG] Found ${offerCodes.length} offer codes in Gumroad`);

        const DiscountsToMigrate: any[] = [];

        for (const offerCode of offerCodes) {
            // Determine discount type and amount - Dodo only supports percentage discounts
            if (offerCode.percent_off > 0) {
                // Convert percentage to basis points (multiply by 100)
                const amount = offerCode.percent_off * 100;

                DiscountsToMigrate.push({
                    name: offerCode.name,
                    code: offerCode.offer_code,
                    type: 'percentage' as const,
                    amount: amount,
                    metadata: {
                        gumroad_offer_code_id: offerCode.id
                    }
                });
            } else if (offerCode.amount_off > 0) {
                // Skip fixed amount discounts since Dodo only supports percentage
                console.log(`[WARN] Skipping fixed amount offer code: ${offerCode.offer_code} - Dodo Payments only supports percentage discounts`);
                continue;
            } else {
                console.log(`[WARN] Skipping offer code with no discount: ${offerCode.offer_code}`);
                continue;
            }
        }

        if (DiscountsToMigrate.length === 0) {
            console.log('[LOG] No valid discounts to migrate');
            return;
        }

        console.log('\n[LOG] These are the discounts to be migrated:');
        DiscountsToMigrate.forEach((discount, index) => {
            const discountValue = `${discount.amount / 100}%`;
            console.log(`${index + 1}. ${discount.name} (${discount.code}) - ${discountValue} discount`);
        });

        const migrateDiscounts = await select({
            message: 'Proceed to create these discounts in Dodo Payments?',
            choices: [
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            ],
        });

        if (migrateDiscounts === 'yes') {
            for (const discount of DiscountsToMigrate) {
                console.log(`[LOG] Migrating discount: ${discount.name} (${discount.code})`);
                try {
                    const createdDiscount = await client.discounts.create(discount);
                    console.log(`[LOG] Migration for discount: ${createdDiscount.name} completed (Dodo Payments discount ID: ${createdDiscount.discount_id})`);
                } catch (error: any) {
                    console.log(`[ERROR] Failed to migrate discount: ${discount.name} - ${error.message}`);
                }
            }
            console.log('[LOG] Discounts migration completed!');
        } else {
            console.log('[LOG] Discounts migration skipped by user');
        }

    } catch (error: any) {
        console.log("[ERROR] Failed to migrate discounts!\n", error.message);
    }
}

async function migrateCustomers(gumroadClient: any, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting customers migration...');

    try {
        // Define interface for Gumroad customer
        interface GumroadCustomer {
            id: string;
            email: string;
            full_name?: string;
            [key: string]: any; // Allow other properties
        }

        // Gumroad API uses pagination, so we need to handle it
        let customers: GumroadCustomer[] = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const response = await gumroadClient.get('/customers', {
                params: {
                    page: page
                }
            });

            if (!response.data || !response.data.customers) {
                console.log("[ERROR] Unexpected response format from Gumroad API");
                return;
            }

            const pageCustomers = response.data.customers as GumroadCustomer[];
            customers = [...customers, ...pageCustomers];

            // Check if there are more pages
            if (pageCustomers.length < 10) { // Gumroad default page size
                hasMore = false;
            } else {
                page++;
            }
        }

        if (customers.length === 0) {
            console.log('[LOG] No customers found in Gumroad');
            return;
        }

        console.log(`[LOG] Found ${customers.length} customers in Gumroad`);

        const CustomersToMigrate: any[] = [];

        for (const customer of customers) {
            CustomersToMigrate.push({
                email: customer.email,
                name: customer.full_name || customer.email.split('@')[0],
                brand_id: brand_id,
                metadata: {
                    gumroad_customer_id: customer.id,
                    migrated_from: 'gumroad'
                }
            });
        }

        if (CustomersToMigrate.length === 0) {
            console.log('[LOG] No valid customers to migrate');
            return;
        }

        console.log('\n[LOG] These are the customers to be migrated:');
        CustomersToMigrate.forEach((customer, index) => {
            console.log(`${index + 1}. ${customer.name || 'Unnamed Customer'} (${customer.email})`);
        });

        const migrateCustomers = await select({
            message: 'Proceed to create these customers in Dodo Payments?',
            choices: [
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            ],
        });

        if (migrateCustomers === 'yes') {
            for (const customer of CustomersToMigrate) {
                console.log(`[LOG] Migrating customer: ${customer.name} (${customer.email})`);
                try {
                    const createdCustomer = await client.customers.create(customer);
                    console.log(`[LOG] Migration for customer: ${createdCustomer.name || createdCustomer.email} completed (Dodo Payments customer ID: ${createdCustomer.customer_id})`);
                } catch (error: any) {
                    console.log(`[ERROR] Failed to migrate customer: ${customer.name} - ${error.message}`);
                }
            }
            console.log('[LOG] Customers migration completed!');
        } else {
            console.log('[LOG] Customers migration skipped by user');
        }

    } catch (error: any) {
        console.log("[ERROR] Failed to migrate customers!\n", error.message);
    }
}
