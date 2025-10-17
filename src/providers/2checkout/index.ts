import axios from 'axios';
import { input, select, checkbox } from '@inquirer/prompts';
import DodoPayments from 'dodopayments';

export default {
    command: '2checkout [arguments]',
    describe: 'Migrate from 2Checkout to Dodo Payments',
    builder: (yargs: any) => {
        return yargs
            .option('provider-seller-id', {
                describe: '2Checkout Seller ID',
                type: 'string',
                demandOption: false
            })
            .option('provider-api-key', {
                describe: '2Checkout API Key',
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
        const PROVIDER_SELLER_ID = argv['provider-seller-id'] || await input({
            message: 'Enter your 2Checkout Seller ID:',
            required: true
        });
        const PROVIDER_API_KEY = argv['provider-api-key'] || await input({
            message: 'Enter your 2Checkout API Key:',
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

        // Set up the 2Checkout API client
        const twoCheckoutClient = axios.create({
            baseURL: 'https://api.2checkout.com/rest/6.0',
            auth: {
                username: PROVIDER_SELLER_ID,
                password: PROVIDER_API_KEY
            },
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        // Test 2Checkout connection
        try {
            await twoCheckoutClient.get('/customers', { params: { limit: 1 } });
            console.log('[LOG] Successfully connected to 2Checkout');
        } catch (error: any) {
            console.log("[ERROR] Failed to connect to 2Checkout!\n", error.message);
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
                    { name: 'Discounts', value: 'discounts', checked: true },
                    { name: 'Customers', value: 'customers', checked: false }
                ],
                required: true
            });
        }

        console.log(`[LOG] Will migrate: ${migrateTypes.join(', ')}`);

        if (migrateTypes.includes('discounts')) {
            await migrateDiscounts(twoCheckoutClient, client, brand_id);
        }

        if (migrateTypes.includes('customers')) {
            await migrateCustomers(twoCheckoutClient, client, brand_id);
        }

        console.log('\n[LOG] Migration completed successfully!');
    }
};

async function migrateDiscounts(twoCheckoutClient: any, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting discounts migration...');

    try {
        // Define interface for 2Checkout coupon
        interface TwoCheckoutCoupon {
            name: string;
            code: string;
            discount_type: string;
            value: number;
            currency?: string;
            [key: string]: any; // Allow other properties
        }

        // 2Checkout API uses pagination, so we need to handle it
        let coupons: TwoCheckoutCoupon[] = [];
        let page = 1;
        const pageSize = 100;
        let hasMore = true;

        while (hasMore) {
            const response = await twoCheckoutClient.get('/coupons', {
                params: {
                    page: page,
                    limit: pageSize
                }
            });

            if (!response.data || !response.data.coupons) {
                console.log("[ERROR] Unexpected response format from 2Checkout API");
                return;
            }

            const pageCoupons = response.data.coupons as TwoCheckoutCoupon[];
            coupons = [...coupons, ...pageCoupons];

            // Check if there are more pages
            if (pageCoupons.length < pageSize) {
                hasMore = false;
            } else {
                page++;
            }
        }

        if (coupons.length === 0) {
            console.log('[LOG] No coupons found in 2Checkout');
            return;
        }

        console.log(`[LOG] Found ${coupons.length} coupons in 2Checkout`);

        const DiscountsToMigrate: any[] = [];

        for (const coupon of coupons) {
            // Dodo Payments only supports percentage discounts
            if (coupon.discount_type !== 'percentage') {
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
                    twocheckout_coupon_code: coupon.code
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

async function migrateCustomers(twoCheckoutClient: any, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting customers migration...');

    try {
        // Define interface for 2Checkout customer
        interface TwoCheckoutCustomer {
            name: string;
            email: string;
            [key: string]: any; // Allow other properties
        }

        // 2Checkout API uses pagination, so we need to handle it
        let customers: TwoCheckoutCustomer[] = [];
        let page = 1;
        const pageSize = 100;
        let hasMore = true;

        while (hasMore) {
            const response = await twoCheckoutClient.get('/customers', {
                params: {
                    page: page,
                    limit: pageSize
                }
            });

            if (!response.data || !response.data.customers) {
                console.log("[ERROR] Unexpected response format from 2Checkout API");
                return;
            }

            const pageCustomers = response.data.customers as TwoCheckoutCustomer[];
            customers = [...customers, ...pageCustomers];

            // Check if there are more pages
            if (pageCustomers.length < pageSize) {
                hasMore = false;
            } else {
                page++;
            }
        }

        if (customers.length === 0) {
            console.log('[LOG] No customers found in 2Checkout');
            return;
        }

        console.log(`[LOG] Found ${customers.length} customers in 2Checkout`);

        const CustomersToMigrate: any[] = [];

        for (const customer of customers) {
            // Skip customers without email as it's required for Dodo Payments
            if (!customer.email) {
                console.log(`[WARN] Skipping customer: ${customer.name || 'Unnamed Customer'} - No email address provided`);
                continue;
            }

            CustomersToMigrate.push({
                name: customer.name || 'Customer',
                email: customer.email,
                brand_id: brand_id,
                metadata: {
                    migrated_from: '2checkout'
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
