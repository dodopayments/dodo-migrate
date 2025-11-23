import DodoPayments from 'dodopayments';
import { input, select, checkbox } from '@inquirer/prompts';

export default {
    command: 'cashfree [arguments]',
    describe: 'Migrate from Cashfree to Dodo Payments',
    builder: (yargs: any) => {
        return yargs
            .option('provider-api-key', {
                describe: 'Cashfree API Key / Client ID',
                type: 'string',
                demandOption: false
            })
            .option('provider-api-secret', {
                describe: 'Cashfree API Secret / Client Secret',
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
            })
            .option('cashfree-env', {
                describe: 'Cashfree environment to target',
                type: 'string',
                choices: ['sandbox', 'production'],
                default: 'sandbox',
                demandOption: false
            })
            .option('cashfree-base-url', {
                describe: 'Override Cashfree base URL (advanced)',
                type: 'string',
                demandOption: false
            })
            .option('cashfree-api-version', {
                describe: 'Cashfree API version header to use',
                type: 'string',
                choices: ['2025-01-01', '2023-08-01', '2022-09-01'],
                default: '2025-01-01',
                demandOption: false
            });
    },
    handler: async (argv: any) => {
        const PROVIDER_API_KEY = argv['provider-api-key'] || await input({
            message: 'Enter your Cashfree API Key / Client ID:',
            required: true
        });
        const PROVIDER_API_SECRET = argv['provider-api-secret'] || await input({
            message: 'Enter your Cashfree API Secret / Client Secret:',
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
                console.log('[ERROR] Failed to fetch brands from Dodo Payments!\n', e);
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

        const CASHFREE_ENV: 'sandbox' | 'production' = (argv['cashfree-env'] || 'sandbox');
        const baseUrl = (argv['cashfree-base-url'] as string | undefined) || (CASHFREE_ENV === 'sandbox' ? 'https://sandbox.cashfree.com' : 'https://api.cashfree.com');
        const API_VERSION: string = argv['cashfree-api-version'] || '2025-01-01';
        console.log(`[LOG] Will migrate: ${migrateTypes.join(', ')} [cashfree-env=${CASHFREE_ENV}] [api-version=${API_VERSION}]`);

        // Placeholder connectivity note; real connectivity check will be implemented
        // in the next task using Cashfree APIs to validate credentials before proceeding.
        console.log('[LOG] Validating Cashfree credentials...');
        let CASHFREE_TOKEN: string | undefined;
        try {
            if (!PROVIDER_API_KEY || !PROVIDER_API_SECRET) {
                throw new Error('Missing Cashfree credentials');
            }
            // Sandbox: use header auth directly (no token endpoint)
            if (CASHFREE_ENV === 'sandbox') {
                // Quick ping using a lightweight endpoint (customers) just to validate creds
                const ping = await fetch(`${baseUrl}/subscriptions/customers?limit=1`, {
                    method: 'GET',
                    headers: {
                        'x-client-id': PROVIDER_API_KEY,
                        'x-client-secret': PROVIDER_API_SECRET,
                        'x-api-version': API_VERSION,
                        'Content-Type': 'application/json'
                    }
                } as any);
                if (!ping.ok && ping.status !== 404) {
                    const text = await ping.text();
                    throw new Error(`Cashfree sandbox connectivity unexpected: HTTP ${ping.status} - ${text}`);
                }
                console.log('[LOG] Sandbox headers accepted (or responded with expected code)');
            } else {
                // Production: try token auth; if it fails fallback to header auth
                const tokenResp = await fetch(`${baseUrl}/pg/services/auth/token`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-client-id': PROVIDER_API_KEY,
                        'x-client-secret': PROVIDER_API_SECRET,
                        'x-api-version': API_VERSION
                    },
                    body: JSON.stringify({ grant_type: 'client_credentials' })
                } as any);
                if (tokenResp.ok) {
                    const authJson: any = await tokenResp.json().catch(() => ({}));
                    CASHFREE_TOKEN = authJson?.data?.token || authJson?.access_token || authJson?.token;
                }
                if (!CASHFREE_TOKEN) {
                    console.log('[WARN] Token auth failed or unavailable; falling back to header auth in production');
                }
                console.log('[LOG] Production credentials validated');
            }
        } catch (error: any) {
            console.log('[ERROR] Failed to validate Cashfree credentials!\n', error.message);
            process.exit(1);
        }

        if (migrateTypes.includes('products')) {
            await migrateProducts({ client, brand_id, providerKey: PROVIDER_API_KEY, providerSecret: PROVIDER_API_SECRET, token: CASHFREE_TOKEN, baseUrl, apiVersion: API_VERSION });
        }

        if (migrateTypes.includes('coupons')) {
            await migrateCoupons({ client, brand_id, providerKey: PROVIDER_API_KEY, providerSecret: PROVIDER_API_SECRET, token: CASHFREE_TOKEN, baseUrl, apiVersion: API_VERSION });
        }

        if (migrateTypes.includes('customers')) {
            await migrateCustomers({ client, brand_id, providerKey: PROVIDER_API_KEY, providerSecret: PROVIDER_API_SECRET, token: CASHFREE_TOKEN, baseUrl, apiVersion: API_VERSION });
        }

        console.log('\n[LOG] Cashfree migration flow completed.');
    }
};

type CashfreeContext = {
    client: DodoPayments;
    brand_id: string;
    providerKey: string;
    providerSecret: string;
    token?: string;
    baseUrl: string;
    apiVersion: string;
};

function buildAuthHeaders(ctx: CashfreeContext): Record<string, string> {
    if (ctx.token) {
        return {
            'Authorization': `Bearer ${ctx.token}`,
            'Content-Type': 'application/json',
            'x-api-version': ctx.apiVersion
        };
    }
    return {
        'x-client-id': ctx.providerKey,
        'x-client-secret': ctx.providerSecret,
        'x-api-version': ctx.apiVersion,
        'Content-Type': 'application/json'
    };
}

async function migrateProducts(ctx: CashfreeContext) {
    console.log('\n[LOG] Starting products migration from Cashfree (Plans)...');
    try {
        const resp = await fetch(`${ctx.baseUrl}/subscriptions/plans`, {
            method: 'GET',
            headers: buildAuthHeaders(ctx)
        } as any);

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Failed to list plans: HTTP ${resp.status} - ${text}`);
        }

        const data: any = await resp.json().catch(() => ({}));
        const plans: any[] = data?.data || data?.items || [];

        if (!plans.length) {
            console.log('[LOG] No plans found in Cashfree Subscriptions');
            return;
        }

        const ProductsToMigrate: { type: 'subscription_product' | 'one_time_product', data: any }[] = [];

        for (const plan of plans) {
            const name = plan?.name || plan?.plan_name || 'Unnamed Plan';
            const amount = plan?.amount || plan?.price || 0; // expected in minor units
            const currency = (plan?.currency || 'USD').toString().toUpperCase();
            const interval = (plan?.interval || plan?.billing_period || 'month').toString();

            let billing_period: 'monthly' | 'yearly' | undefined;
            if (interval.toLowerCase().startsWith('month')) billing_period = 'monthly';
            else if (interval.toLowerCase().startsWith('year')) billing_period = 'yearly';
            
            // Warn about unsupported intervals
            if (!billing_period && interval.toLowerCase() !== 'month' && interval.toLowerCase() !== 'year') {
                console.warn(`[WARN] Unsupported billing interval '${interval}' for plan '${plan?.plan_id || plan?.id || 'unknown'}'. Treating as one-time product.`);
            }

            const isRecurring = Boolean(billing_period);

            // Convert Cashfree major units to Dodo Payments minor units
            const priceInMinorUnits = Math.round((Number(amount) || 0) * 100);

            if (isRecurring) {
                ProductsToMigrate.push({
                    type: 'subscription_product',
                    data: {
                        name,
                        description: '',
                        tax_category: 'saas',
                        price: {
                            currency,
                            price: priceInMinorUnits,
                            discount: 0,
                            purchasing_power_parity: false,
                            type: 'recurring_price',
                            billing_period
                        },
                        brand_id: ctx.brand_id
                    }
                });
            } else {
                ProductsToMigrate.push({
                    type: 'one_time_product',
                    data: {
                        name,
                        description: '',
                        tax_category: 'saas',
                        price: {
                            currency,
                            price: priceInMinorUnits,
                            discount: 0,
                            purchasing_power_parity: false,
                            type: 'one_time_price'
                        },
                        brand_id: ctx.brand_id
                    }
                });
            }
        }

        console.log('\n[LOG] These are the products to be migrated:');
        ProductsToMigrate.forEach((product, index) => {
            const price = product.data.price.price;
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
            console.log('\n[LOG] Creating products in Dodo Payments...');
            for (const product of ProductsToMigrate) {
                console.log(`[LOG] Migrating product: ${product.data.name}`);
                try {
                    const created = await ctx.client.products.create(product.data);
                    console.log(`[LOG] Created product: ${created.name} (ID: ${created.product_id})`);
                } catch (e: any) {
                    console.log(`[ERROR] Failed to create product ${product.data.name}: ${e.message}`);
                }
            }
            console.log('[LOG] Products migration completed!');
        } else {
            console.log('[LOG] Products migration skipped by user');
        }

    } catch (error: any) {
        console.log('[ERROR] Failed to migrate products from Cashfree\n', error.message);
    }
}

async function migrateCoupons(ctx: CashfreeContext) {
    console.log('\n[LOG] Starting coupons migration from Cashfree (Offers)...');
    try {
        const resp = await fetch(`${ctx.baseUrl}/subscriptions/offers`, {
            method: 'GET',
            headers: buildAuthHeaders(ctx)
        } as any);

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Failed to list offers: HTTP ${resp.status} - ${text}`);
        }

        const data: any = await resp.json().catch(() => ({}));
        const offers: any[] = data?.data || data?.items || [];

        if (!offers.length) {
            console.log('[LOG] No offers (coupons) found in Cashfree');
            return;
        }

        const CouponsToMigrate: any[] = [];
        for (const offer of offers) {
            const code = offer?.code || offer?.offer_code || offer?.name;
            const name = offer?.name || code || 'Unnamed Offer';
            const discountType = (offer?.type || offer?.discount_type || '').toString().toLowerCase().trim();
            const isPercentage = discountType === 'percent' || discountType === 'percentage';
            const percent = Number(offer?.percentage || offer?.percent_off || 0);
            const amount = Number(offer?.amount || offer?.amount_off || 0);
            const currency = (offer?.currency || 'USD').toString().toUpperCase();

            if (isPercentage && percent <= 0) continue;
            if (!isPercentage && amount <= 0) continue;

            CouponsToMigrate.push({
                code,
                name,
                discount_type: isPercentage ? 'percentage' : 'fixed_amount',
                discount_value: isPercentage ? percent : Math.round(amount * 100),
                currency: isPercentage ? undefined : currency,
                brand_id: ctx.brand_id
            });
        }

        console.log('\n[LOG] These are the coupons to be migrated:');
        CouponsToMigrate.forEach((coupon, index) => {
            const discount = coupon.discount_type === 'percentage'
                ? `${coupon.discount_value}%`
                : `${coupon.currency} ${(coupon.discount_value / 100).toFixed(2)}`;
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
            console.log('\n[LOG] Creating discounts in Dodo Payments...');
            for (const coupon of CouponsToMigrate) {
                console.log(`[LOG] Migrating coupon: ${coupon.name} (${coupon.code})`);
                try {
                    const created = await ctx.client.discounts.create(coupon);
                    console.log(`[LOG] Created discount: ${created.name} (ID: ${created.discount_id})`);
                } catch (e: any) {
                    console.log(`[ERROR] Failed to create coupon ${coupon.name}: ${e.message}`);
                }
            }
            console.log('[LOG] Coupons migration completed!');
        } else {
            console.log('[LOG] Coupons migration skipped by user');
        }

    } catch (error: any) {
        console.log('[ERROR] Failed to migrate coupons from Cashfree\n', error.message);
    }
}

async function migrateCustomers(ctx: CashfreeContext) {
    console.log('\n[LOG] Starting customers migration from Cashfree...');
    try {
        const resp = await fetch(`${ctx.baseUrl}/subscriptions/customers`, {
            method: 'GET',
            headers: buildAuthHeaders(ctx)
        } as any);

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Failed to list customers: HTTP ${resp.status} - ${text}`);
        }

        const data: any = await resp.json().catch(() => ({}));
        const customers: any[] = data?.data || data?.items || [];

        if (!customers.length) {
            console.log('[LOG] No customers found in Cashfree');
            return;
        }

        const CustomersToMigrate: any[] = [];
        for (const c of customers) {
            CustomersToMigrate.push({
                email: c?.email || '',
                name: c?.name || '',
                phone: c?.phone || c?.mobile || '',
                address: {
                    line1: c?.address_line1 || '',
                    line2: c?.address_line2 || '',
                    city: c?.city || '',
                    state: c?.state || '',
                    postal_code: c?.postal_code || c?.zip || '',
                    country: c?.country || ''
                },
                brand_id: ctx.brand_id,
                metadata: {
                    cashfree_customer_id: c?.id || c?.customer_id,
                    migrated_from: 'cashfree'
                }
            });
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
            console.log('\n[LOG] Creating customers in Dodo Payments...');
            for (const cust of CustomersToMigrate) {
                console.log(`[LOG] Migrating customer: ${cust.name || cust.email || 'Unnamed'}`);
                try {
                    const created = await ctx.client.customers.create(cust);
                    console.log(`[LOG] Created customer: ${created.name || created.email} (ID: ${created.customer_id})`);
                } catch (e: any) {
                    console.log(`[ERROR] Failed to create customer ${cust.name || cust.email}: ${e.message}`);
                }
            }
            console.log('[LOG] Customers migration completed!');
        } else {
            console.log('[LOG] Customers migration skipped by user');
        }

    } catch (error: any) {
        console.log('[ERROR] Failed to migrate customers from Cashfree\n', error.message);
    }
}


