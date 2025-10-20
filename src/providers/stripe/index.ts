import Stripe from 'stripe';
import DodoPayments from 'dodopayments';
import { input, select, checkbox } from '@inquirer/prompts';

export default {
    command: 'stripe [arguments]',
    describe: 'Migrate from Stripe to Dodo Payments',
    builder: (yargs: any) => {
        return yargs
            .option('provider-api-key', {
                describe: 'Stripe Secret API Key',
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
                describe: 'Types of data to migrate (comma-separated: products,coupons,customers)',
                type: 'string',
                demandOption: false
            });
    },
    handler: async (argv: any) => {
        const PROVIDER_API_KEY = argv['provider-api-key'] || await input({ 
            message: 'Enter your Stripe Secret API Key (sk_...):', 
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

        const stripe = new Stripe(PROVIDER_API_KEY, {
            apiVersion: '2025-02-24.acacia',
        });

        try {
            await stripe.accounts.retrieve();
            console.log('[LOG] Successfully connected to Stripe');
        } catch (error: any) {
            console.log("[ERROR] Failed to connect to Stripe!\n", error.message);
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
                    { name: 'Coupons', value: 'coupons', checked: true },
                    { name: 'Customers', value: 'customers', checked: false }
                ],
                required: true
            });
        }

        console.log(`[LOG] Will migrate: ${migrateTypes.join(', ')}`);

        if (migrateTypes.includes('products')) {
            await migrateProducts(stripe, client, brand_id);
        }

        if (migrateTypes.includes('coupons')) {
            await migrateCoupons(stripe, client, brand_id);
        }

        if (migrateTypes.includes('customers')) {
            await migrateCustomers(stripe, client, brand_id);
        }

        console.log('\n[LOG] Migration completed successfully!');
    }
};

async function migrateProducts(stripe: Stripe, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting products migration...');
    
    try {
        // Paginate through all products
        const allProducts: Stripe.Product[] = [];
        await stripe.products.list({
            limit: 100,
            active: true
        }).autoPagingEach((product) => {
            allProducts.push(product);
        });

        if (allProducts.length === 0) {
            console.log('[LOG] No active products found in Stripe');
            return;
        }

        console.log(`[LOG] Found ${allProducts.length} active products in Stripe`);

        const ProductsToMigrate: { type: 'one_time_product' | 'subscription_product', data: any }[] = [];

        for (const product of allProducts) {
            // Paginate through all prices for this product
            const allPrices: Stripe.Price[] = [];
            await stripe.prices.list({
                product: product.id,
                active: true
            }).autoPagingEach((price) => {
                allPrices.push(price);
            });

            if (allPrices.length === 0) {
                console.log(`[LOG] Skipping product ${product.name} - no active prices found`);
                continue;
            }

            for (const price of allPrices) {
                const isRecurring = price.type === 'recurring';
                if (price.unit_amount == null) {
                    console.log(`[LOG] Skipping price ${price.id} with null unit_amount (tiered/custom)`);
                    continue;
                }
                
                if (isRecurring) {
                    ProductsToMigrate.push({
                        type: 'subscription_product',
                        data: {
                            name: product.name || 'Unnamed Product',
                            description: product.description || '',
                            tax_category: 'saas',
                            price: {
                                currency: price.currency.toUpperCase(),
                                price: price.unit_amount || 0,
                                discount: 0,
                                purchasing_power_parity: false,
                                type: 'recurring_price',
                                billing_period: price.recurring?.interval === 'month' ? 'monthly' : 
                                               price.recurring?.interval === 'year' ? 'yearly' : 'monthly'
                            },
                            brand_id: brand_id
                        }
                    });
                } else {
                    ProductsToMigrate.push({
                        type: 'one_time_product',
                        data: {
                            name: product.name || 'Unnamed Product',
                            description: product.description || '',
                            tax_category: 'saas',
                            price: {
                                currency: price.currency.toUpperCase(),
                                price: price.unit_amount || 0,
                                discount: 0,
                                purchasing_power_parity: false,
                                type: 'one_time_price'
                            },
                            brand_id: brand_id
                        }
                    });
                }
            }
        }

        if (ProductsToMigrate.length === 0) {
            console.log('[LOG] No products to migrate');
            return;
        }

        console.log('\n[LOG] These are the products to be migrated:');
        ProductsToMigrate.forEach((product, index) => {
            const price = product.data.price.price / 100;
            const type = product.type === 'one_time_product' ? 'One Time' : 'Subscription';
            const billing = product.type === 'subscription_product' ? ` (${product.data.price.billing_period})` : '';
            console.log(`${index + 1}. ${product.data.name} - ${product.data.price.currency} ${price.toFixed(2)} (${type}${billing})`);
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
                console.log(`[LOG] Migrating product: ${product.data.name}`);
                try {
                    const createdProduct = await client.products.create(product.data);
                    console.log(`[LOG] Migration for product: ${createdProduct.name} completed (Dodo Payments product ID: ${createdProduct.product_id})`);
                } catch (error: any) {
                    console.log(`[ERROR] Failed to migrate product: ${product.data.name} - ${error.message}`);
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

async function migrateCoupons(stripe: Stripe, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting coupons migration...');
    
    try {
        // Paginate through all coupons
        const allCoupons: Stripe.Coupon[] = [];
        await stripe.coupons.list({
            limit: 100
        }).autoPagingEach((coupon) => {
            allCoupons.push(coupon);
        });

        if (allCoupons.length === 0) {
            console.log('[LOG] No coupons found in Stripe');
            return;
        }

        console.log(`[LOG] Found ${allCoupons.length} coupons in Stripe`);

        const CouponsToMigrate: any[] = [];

        for (const coupon of allCoupons) {
            if (!coupon.valid) {
                console.log(`[LOG] Skipping invalid coupon: ${coupon.id}`);
                continue;
            }

            // Fetch promotion codes for this coupon
            const promotionCodes = await stripe.promotionCodes.list({
                coupon: coupon.id,
                limit: 100
            });

            // If no promotion codes exist, create one using the coupon ID as the code
            if (promotionCodes.data.length === 0) {
                let discountType: 'percentage' | 'fixed_amount';
                let discountValue: number;

                if (coupon.percent_off) {
                    discountType = 'percentage';
                    discountValue = coupon.percent_off;
                } else if (coupon.amount_off) {
                    discountType = 'fixed_amount';
                    discountValue = coupon.amount_off;
                } else {
                    console.log(`[LOG] Skipping coupon ${coupon.id} - no discount value found`);
                    continue;
                }

                // Only set currency for fixed amount coupons
                const currency = coupon.amount_off ? coupon.currency?.toUpperCase() : undefined;

                CouponsToMigrate.push({
                    code: coupon.id,
                    name: coupon.name || coupon.id,
                    discount_type: discountType,
                    amount: discountValue,
                    currency: currency,
                    usage_limit: coupon.max_redemptions || null,
                    expires_at: coupon.redeem_by ? new Date(coupon.redeem_by * 1000).toISOString() : null,
                    brand_id: brand_id
                });
            } else {
                // Process each promotion code
                for (const promotionCode of promotionCodes.data) {
                    let discountType: 'percentage' | 'fixed_amount';
                    let discountValue: number;

                    if (coupon.percent_off) {
                        discountType = 'percentage';
                        discountValue = coupon.percent_off;
                    } else if (coupon.amount_off) {
                        discountType = 'fixed_amount';
                        discountValue = coupon.amount_off;
                    } else {
                        console.log(`[LOG] Skipping promotion code ${promotionCode.code} - no discount value found`);
                        continue;
                    }

                    // Only set currency for fixed amount coupons
                    const currency = coupon.amount_off ? coupon.currency?.toUpperCase() : undefined;

                    CouponsToMigrate.push({
                        code: promotionCode.code,
                        name: coupon.name || coupon.id,
                        discount_type: discountType,
                        amount: discountValue,
                        currency: currency,
                        usage_limit: coupon.max_redemptions || null,
                        expires_at: coupon.redeem_by ? new Date(coupon.redeem_by * 1000).toISOString() : null,
                        brand_id: brand_id
                    });
                }
            }
        }

        if (CouponsToMigrate.length === 0) {
            console.log('[LOG] No valid coupons to migrate');
            return;
        }

        console.log('\n[LOG] These are the coupons to be migrated:');
        CouponsToMigrate.forEach((coupon, index) => {
            const discount = coupon.discount_type === 'percentage' 
                ? `${coupon.amount}%` 
                : `${coupon.currency} ${(coupon.amount / 100).toFixed(2)}`;
            console.log(`${index + 1}. ${coupon.name} (${coupon.code}) - ${discount} discount`);
        });

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
            
            for (const coupon of CouponsToMigrate) {
                console.log(`[LOG] Migrating coupon: ${coupon.name} (${coupon.code})`);
                try {
                    const createdCoupon = await client.discounts.create(coupon);
                    console.log(`[LOG] Migration for coupon: ${createdCoupon.name} completed (Dodo Payments discount ID: ${createdCoupon.discount_id})`);
                    successCount++;
                } catch (error: any) {
                    console.log(`[ERROR] Failed to migrate coupon: ${coupon.name} - ${error.message}`);
                    failureCount++;
                }
            }
            
            // Report results based on actual success/failure
            if (failureCount === 0) {
                console.log('[LOG] All coupons migrated successfully!');
            } else if (successCount === 0) {
                console.log('[ERROR] All coupon migrations failed!');
            } else {
                console.log(`[LOG] Coupon migration completed with ${successCount} successful and ${failureCount} failed migrations.`);
            }
        } else {
            console.log('[LOG] Coupons migration skipped by user');
        }

    } catch (error: any) {
        console.log("[ERROR] Failed to migrate coupons!\n", error.message);
    }
}

async function migrateCustomers(stripe: Stripe, client: DodoPayments, brand_id: string) {
    console.log('\n[LOG] Starting customers migration...');
    
    try {
        // Paginate through all customers
        const allCustomers: Stripe.Customer[] = [];
        await stripe.customers.list({
            limit: 100
        }).autoPagingEach((customer) => {
            allCustomers.push(customer);
        });

        if (allCustomers.length === 0) {
            console.log('[LOG] No customers found in Stripe');
            return;
        }

        console.log(`[LOG] Found ${allCustomers.length} customers in Stripe`);

        const CustomersToMigrate: any[] = [];

        for (const customer of allCustomers) {
            if (customer.deleted) {
                console.log(`[LOG] Skipping deleted customer: ${customer.id}`);
                continue;
            }

            // Clean up address fields - remove address object if all fields are empty
                const address = {
                    line1: customer.address?.line1 || '',
                    line2: customer.address?.line2 || '',
                    city: customer.address?.city || '',
                    state: customer.address?.state || '',
                    postal_code: customer.address?.postal_code || '',
                    country: customer.address?.country || ''
                };

                // Check if all address fields are empty or only whitespace
                const isAddressEmpty = Object.values(address).every(field => !field || field.trim() === '');

                const customerData: any = {
                    email: customer.email || '',
                    name: customer.name || '',
                    phone: customer.phone || '',
                    brand_id: brand_id,
                    metadata: {
                        stripe_customer_id: customer.id,
                        migrated_from: 'stripe'
                    }
                };

                // Only add address if it's not empty
                if (!isAddressEmpty) {
                    customerData.address = address;
                }

                CustomersToMigrate.push(customerData);
        }

        if (CustomersToMigrate.length === 0) {
            console.log('[LOG] No valid customers to migrate');
            return;
        }

        console.log('\n[LOG] These are the customers to be migrated:');
        CustomersToMigrate.forEach((customer, index) => {
            console.log(`${index + 1}. ${customer.name || 'Unnamed'} (${customer.email || 'No email'})`);
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
                console.log(`[LOG] Migrating customer: ${customer.name || customer.email || 'Unnamed'}`);
                try {
                    const createdCustomer = await client.customers.create(customer);
                    console.log(`[LOG] Migration for customer: ${createdCustomer.name || createdCustomer.email} completed (Dodo Payments customer ID: ${createdCustomer.customer_id})`);
                } catch (error: any) {
                    console.log(`[ERROR] Failed to migrate customer: ${customer.name || customer.email} - ${error.message}`);
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

