import axios from 'axios';
import { input, select, checkbox } from '@inquirer/prompts';
import DodoPayments from 'dodopayments';

export default {
    command: 'razorpay [arguments]',
    describe: 'Migrate from Razorpay to Dodo Payments',
    builder: (yargs: any) => {
        return yargs
            .option('provider-api-key', {
                describe: 'Razorpay Key ID',
                type: 'string',
                demandOption: false
            })
            .option('razorpay-key-secret', {
                describe: 'Razorpay Key Secret',
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
            message: 'Enter your Razorpay Key ID:',
            required: true
        });
        const RAZORPAY_KEY_SECRET = argv['razorpay-key-secret'] || await input({
            message: 'Enter your Razorpay Key Secret:',
            required: true,
            transformer: (input: string) => '*'.repeat(input.length) // Hide password
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

        // Create Razorpay API client
        const razorpayClient = axios.create({
            baseURL: 'https://api.razorpay.com/v1',
            auth: {
                username: PROVIDER_API_KEY,
                password: RAZORPAY_KEY_SECRET
            }
        });

        // Test Razorpay connection
        try {
            await razorpayClient.get('/customers', { params: { count: 1 } });
            console.log('[LOG] Successfully connected to Razorpay');
        } catch (error: any) {
            console.log("[ERROR] Failed to connect to Razorpay!\n", error.message);
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
            await migrateProducts(razorpayClient, client, brand_id);
        }

        if (migrateTypes.includes('discounts')) {
            await migrateDiscounts(razorpayClient, client, brand_id);
        }

        if (migrateTypes.includes('customers')) {
            await migrateCustomers(razorpayClient, client, brand_id);
        }

        console.log('\n[LOG] Migration completed successfully!');
    }
};

async function migrateProducts(razorpayClient: any, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting products migration...');

    try {
        // Define interfaces for Razorpay plan and item
        interface RazorpayPlan {
            id: string;
            name?: string;
            description?: string;
            amount: number;
            currency: string;
            period: 'daily' | 'weekly' | 'monthly' | 'yearly';
            interval: number;
            item: {
                id: string;
                name: string;
                description?: string;
                amount: number;
                currency: string;
            };
            [key: string]: any;
        }

        interface RazorpayItem {
            id: string;
            name: string;
            description?: string;
            amount: number;
            currency: string;
            [key: string]: any;
        }

        // Fetch subscription plans
        let plans: RazorpayPlan[] = [];
        let skip = 0;
        const count = 100;
        let hasMore = true;

        while (hasMore) {
            const response = await razorpayClient.get('/plans', {
                params: {
                    skip: skip,
                    count: count
                }
            });

            if (!response.data || !response.data.items) {
                console.log("[ERROR] Unexpected response format from Razorpay Plans API");
                break;
            }

            const pagePlans = response.data.items as RazorpayPlan[];
            plans = [...plans, ...pagePlans];

            if (pagePlans.length < count) {
                hasMore = false;
            } else {
                skip += count;
            }
        }

        // Fetch standalone items (one-time products)
        let items: RazorpayItem[] = [];
        skip = 0;
        hasMore = true;

        while (hasMore) {
            try {
                const response = await razorpayClient.get('/items', {
                    params: {
                        skip: skip,
                        count: count
                    }
                });

                if (response.data && response.data.items) {
                    const pageItems = response.data.items as RazorpayItem[];
                    items = [...items, ...pageItems];

                    if (pageItems.length < count) {
                        hasMore = false;
                    } else {
                        skip += count;
                    }
                } else {
                    hasMore = false;
                }
            } catch (error) {
                // Items API might not be available or accessible
                console.log('[WARN] Could not fetch items from Razorpay - focusing on subscription plans');
                hasMore = false;
            }
        }

        const totalProducts = plans.length + items.length;

        if (totalProducts === 0) {
            console.log('[LOG] No products found in Razorpay');
            return;
        }

        console.log(`[LOG] Found ${plans.length} subscription plans and ${items.length} standalone items in Razorpay (total: ${totalProducts})`);

        const ProductsToMigrate: any[] = [];

        // Process subscription plans
        for (const plan of plans) {
            const productName = `${plan.name || plan.item.name}_plan_${plan.id}`;

            // Map Razorpay period to Dodo Payments interval
            const getTimeInterval = (period: string): 'Day' | 'Week' | 'Month' | 'Year' => {
                switch (period.toLowerCase()) {
                    case 'daily': return 'Day';
                    case 'weekly': return 'Week';
                    case 'monthly': return 'Month';
                    case 'yearly': return 'Year';
                    default: return 'Month';
                }
            };

            const timeInterval = getTimeInterval(plan.period);

            // Create recurring price configuration
            const priceConfig = {
                type: 'recurring_price' as const,
                currency: plan.currency.toLowerCase() as any,
                price: plan.amount, // Razorpay amounts are already in paise (cents)
                discount: 0,
                purchasing_power_parity: false,
                payment_frequency_count: plan.interval,
                payment_frequency_interval: timeInterval,
                subscription_period_count: plan.interval,
                subscription_period_interval: timeInterval,
            };

            ProductsToMigrate.push({
                name: productName,
                description: `${plan.description || plan.item.description || plan.item.name} - Recurring ${plan.currency.toUpperCase()} ${(plan.amount / 100).toFixed(2)} per ${plan.interval > 1 ? `${plan.interval} ${plan.period}s` : plan.period}`,
                brand_id: brand_id,
                price: priceConfig,
                tax_category: 'saas' as any,
                metadata: {
                    razorpay_plan_id: plan.id,
                    razorpay_item_id: plan.item.id,
                    amount: (plan.amount / 100).toString(),
                    currency: plan.currency,
                    recurring: 'true',
                    period: plan.period,
                    interval: plan.interval.toString()
                }
            });
        }

        // Process standalone items
        for (const item of items) {
            const productName = `${item.name}_item_${item.id}`;

            // Create one-time price configuration
            const priceConfig = {
                type: 'one_time_price' as const,
                currency: item.currency.toLowerCase() as any,
                price: item.amount, // Razorpay amounts are already in paise (cents)
                discount: 0,
                purchasing_power_parity: false,
            };

            ProductsToMigrate.push({
                name: productName,
                description: `${item.description || item.name} - One-time ${item.currency.toUpperCase()} ${(item.amount / 100).toFixed(2)}`,
                brand_id: brand_id,
                price: priceConfig,
                tax_category: 'saas' as any,
                metadata: {
                    razorpay_item_id: item.id,
                    amount: (item.amount / 100).toString(),
                    currency: item.currency,
                    recurring: 'false'
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
            const billing = product.price.type === 'recurring_price' ? ` (${product.price.payment_frequency_count} ${product.price.payment_frequency_interval}${product.price.payment_frequency_count > 1 ? 's' : ''})` : '';
            console.log(`${index + 1}. ${product.name} - ${product.price.currency.toUpperCase()} ${price.toFixed(2)} (${type}${billing})`);
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

async function migrateDiscounts(razorpayClient: any, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting discounts migration...');

    try {
        // Define interface for Razorpay coupon
        interface RazorpayCoupon {
            id: string;
            code: string;
            name?: string;
            description?: string;
            type: 'percentage' | 'amount';
            value: number;
            currency?: string;
            [key: string]: any;
        }

        // Razorpay API uses pagination for coupons
        let coupons: RazorpayCoupon[] = [];
        let skip = 0;
        const count = 100;
        let hasMore = true;

        while (hasMore) {
            try {
                const response = await razorpayClient.get('/coupons', {
                    params: {
                        skip: skip,
                        count: count
                    }
                });

                if (!response.data || !response.data.items) {
                    console.log("[WARN] No coupons found or unexpected response format from Razorpay API");
                    break;
                }

                const pageCoupons = response.data.items as RazorpayCoupon[];
                coupons = [...coupons, ...pageCoupons];

                if (pageCoupons.length < count) {
                    hasMore = false;
                } else {
                    skip += count;
                }
            } catch (error) {
                console.log('[WARN] Could not fetch coupons from Razorpay - coupons API might not be available');
                hasMore = false;
            }
        }

        if (coupons.length === 0) {
            console.log('[LOG] No coupons found in Razorpay');
            return;
        }

        console.log(`[LOG] Found ${coupons.length} coupons in Razorpay`);

        const DiscountsToMigrate: any[] = [];

        for (const coupon of coupons) {
            // Dodo Payments only supports percentage discounts
            if (coupon.type !== 'percentage') {
                console.log(`[WARN] Skipping fixed amount coupon: ${coupon.code} - Dodo Payments only supports percentage discounts`);
                continue;
            }

            // Convert percentage to basis points (multiply by 100)
            const amount = coupon.value * 100;

            DiscountsToMigrate.push({
                name: coupon.name || `Coupon ${coupon.code}`,
                code: coupon.code,
                type: 'percentage' as const,
                amount: amount,
                metadata: {
                    razorpay_coupon_id: coupon.id,
                    razorpay_description: coupon.description || ''
                }
            });
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

async function migrateCustomers(razorpayClient: any, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting customers migration...');

    try {
        // Define interface for Razorpay customer
        interface RazorpayCustomer {
            id: string;
            email: string;
            name?: string;
            contact?: string;
            gstin?: string;
            [key: string]: any; // Allow other properties
        }

        // Razorpay API uses pagination, so we need to handle it
        let customers: RazorpayCustomer[] = [];
        let skip = 0;
        const count = 100; // Max items per page
        let hasMore = true;

        while (hasMore) {
            const response = await razorpayClient.get('/customers', {
                params: {
                    skip: skip,
                    count: count
                }
            });

            if (!response.data || !response.data.items) {
                console.log("[ERROR] Unexpected response format from Razorpay API");
                return;
            }

            const pageCustomers = response.data.items as RazorpayCustomer[];
            customers = [...customers, ...pageCustomers];

            // Check if there are more pages
            if (pageCustomers.length < count) {
                hasMore = false;
            } else {
                skip += count;
            }
        }

        if (customers.length === 0) {
            console.log('[LOG] No customers found in Razorpay');
            return;
        }

        console.log(`[LOG] Found ${customers.length} customers in Razorpay`);

        const CustomersToMigrate: any[] = [];

        for (const customer of customers) {
            CustomersToMigrate.push({
                email: customer.email,
                name: customer.name || customer.email.split('@')[0],
                brand_id: brand_id,
                metadata: {
                    razorpay_customer_id: customer.id,
                    razorpay_contact: customer.contact || '',
                    razorpay_gstin: customer.gstin || '',
                    migrated_from: 'razorpay'
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
