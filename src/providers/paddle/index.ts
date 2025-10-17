import axios from 'axios';
import { input, select, checkbox } from '@inquirer/prompts';
import DodoPayments from 'dodopayments';

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
            .option('paddle-vendor-id', {
                describe: 'Paddle Vendor ID',
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
            message: 'Enter your Paddle API Key:',
            required: true
        });
        const PADDLE_VENDOR_ID = argv['paddle-vendor-id'] || await input({
            message: 'Enter your Paddle Vendor ID:',
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

        // Create Paddle API client
        const paddleClient = axios.create({
            baseURL: 'https://vendors.paddle.com/api/2.0',
            params: {
                vendor_id: PADDLE_VENDOR_ID,
                vendor_auth_code: PROVIDER_API_KEY
            }
        });

        // Test Paddle connection
        try {
            await paddleClient.post('/user/list', { page: 1 });
            console.log('[LOG] Successfully connected to Paddle');
        } catch (error: any) {
            console.log("[ERROR] Failed to connect to Paddle!\n", error.message);
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
            await migrateProducts(paddleClient, client, brand_id);
        }

        if (migrateTypes.includes('discounts')) {
            await migrateDiscounts(paddleClient, client, brand_id);
        }

        if (migrateTypes.includes('customers')) {
            await migrateCustomers(paddleClient, client, brand_id);
        }

        console.log('\n[LOG] Migration completed successfully!');
    }
};

async function migrateProducts(paddleClient: any, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting products migration...');

    try {
        // Define interface for Paddle product
        interface PaddleProduct {
            id: string;
            name: string;
            description?: string;
            base_price: number;
            sale_price?: number;
            currency: string;
            recurring?: boolean;
            [key: string]: any; // Allow other properties
        }

        // Fetch products
        const response = await paddleClient.post('/product/get_products');

        if (!response.data || !response.data.response || !response.data.response.products) {
            console.log("[ERROR] Unexpected response format from Paddle API");
            return;
        }

        const products = response.data.response.products as PaddleProduct[];

        if (products.length === 0) {
            console.log('[LOG] No products found in Paddle');
            return;
        }

        console.log(`[LOG] Found ${products.length} products in Paddle`);

        const ProductsToMigrate: any[] = [];

        for (const product of products) {
            // Get the price to use
            const price = product.sale_price || product.base_price;
            const priceInCents = Math.round(price * 100);

            // In Dodo Payments, we need to create separate products for each price
            const priceType = product.recurring ? 'subscription' : 'one-time';
            const priceAmount = price.toString().replace('.', '_');
            const priceCurrency = product.currency.toLowerCase();
            const productName = `${product.name}_${priceAmount}_${priceCurrency}_${priceType}`;

            // Create price configuration based on product type
            const priceConfig = product.recurring
                ? {
                    type: 'recurring_price' as const,
                    currency: product.currency.toLowerCase() as any,
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
                    currency: product.currency.toLowerCase() as any,
                    price: priceInCents,
                    discount: 0,
                    purchasing_power_parity: false,
                };

            ProductsToMigrate.push({
                name: productName,
                description: `${product.description || product.name} - ${price} ${product.currency} ${priceType}`,
                brand_id: brand_id,
                price: priceConfig,
                tax_category: 'saas' as any, // Using 'saas' as tax category
                metadata: {
                    paddle_product_id: product.id,
                    amount: price.toString(),
                    currency: product.currency,
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

async function migrateDiscounts(paddleClient: any, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting discounts migration...');

    try {
        // Define interface for Paddle coupon
        interface PaddleCoupon {
            coupon_code: string;
            description: string;
            discount_type: string;
            discount_amount: number;
            currency?: string;
            [key: string]: any; // Allow other properties
        }

        // Fetch coupons
        const response = await paddleClient.post('/product/list_coupons');

        if (!response.data || !response.data.response || !response.data.response.coupons) {
            console.log("[ERROR] Unexpected response format from Paddle API");
            return;
        }

        const coupons = response.data.response.coupons as PaddleCoupon[];

        if (coupons.length === 0) {
            console.log('[LOG] No coupons found in Paddle');
            return;
        }

        console.log(`[LOG] Found ${coupons.length} coupons in Paddle`);

        const DiscountsToMigrate: any[] = [];

        for (const coupon of coupons) {
            // Determine discount type and amount
            if (coupon.discount_type === 'percentage') {
                // Convert percentage to basis points (multiply by 100)
                const amount = coupon.discount_amount * 100;

                DiscountsToMigrate.push({
                    name: coupon.description || `Discount ${coupon.coupon_code}`,
                    code: coupon.coupon_code,
                    type: 'percentage' as const,
                    amount: amount,
                    metadata: {
                        paddle_coupon_code: coupon.coupon_code
                    }
                });
            } else {
                // For fixed amounts, skip since Dodo only supports percentage
                console.log(`[WARN] Skipping fixed amount coupon: ${coupon.coupon_code} - Dodo Payments only supports percentage discounts`);
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

async function migrateCustomers(paddleClient: any, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting customers migration...');

    try {
        // Define interface for Paddle customer
        interface PaddleCustomer {
            user_id: string;
            email: string;
            name?: string;
            [key: string]: any; // Allow other properties
        }

        // Paddle API uses pagination, so we need to handle it
        let customers: PaddleCustomer[] = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const response = await paddleClient.post('/user/list', {
                page: page
            });

            if (!response.data || !response.data.response || !response.data.response.users) {
                console.log("[ERROR] Unexpected response format from Paddle API");
                return;
            }

            const pageCustomers = response.data.response.users as PaddleCustomer[];
            customers = [...customers, ...pageCustomers];

            // Check if there are more pages
            if (pageCustomers.length < 50) { // Paddle default page size is 50
                hasMore = false;
            } else {
                page++;
            }
        }

        if (customers.length === 0) {
            console.log('[LOG] No customers found in Paddle');
            return;
        }

        console.log(`[LOG] Found ${customers.length} customers in Paddle`);

        const CustomersToMigrate: any[] = [];

        for (const customer of customers) {
            CustomersToMigrate.push({
                email: customer.email,
                name: customer.name || customer.email.split('@')[0],
                brand_id: brand_id,
                metadata: {
                    paddle_user_id: customer.user_id,
                    migrated_from: 'paddle'
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
