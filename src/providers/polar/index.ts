import DodoPayments from 'dodopayments';
import { input, select, checkbox } from '@inquirer/prompts';

// Polar Core API integration
// - Base URLs: https://api.polar.sh/v1 | https://sandbox-api.polar.sh/v1
// - Amounts: minor units (cents)
// - Products: price from product.prices[0], recurring via product.recurring_interval
// - Discounts: fetched from /discounts/ (temporarily migrating percentage only)
// - Customers: fetched from /customers/

export default {
    command: 'polar [arguments]',
    describe: 'Migrate from Polar.sh to Dodo Payments',
    builder: (yargs: any) => {
        return yargs
            .option('provider-api-key', {
                describe: 'Polar.sh API Key (Bearer token)',
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
            .option('server', {
                describe: 'Polar API server: production | sandbox',
                type: 'string',
                choices: ['production', 'sandbox'],
                default: 'production',
                demandOption: false
            })
            .option('polar-base-url', {
                describe: 'Override Polar API base URL (advanced)',
                type: 'string',
                demandOption: false
            });
    },
    handler: async (argv: any) => {
        const PROVIDER_API_KEY = argv['provider-api-key'] || await input({
            message: 'Enter your Polar.sh API Key (Bearer):',
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
                const brandsArray = (brands as any)?.data ?? (brands as any)?.items ?? [];
                brand_id = await select({
                    message: 'Select your Dodo Payments brand:',
                    choices: (Array.isArray(brandsArray) ? brandsArray : []).map((brand: any) => ({
                        name: brand?.name || 'Unnamed Brand',
                        value: brand?.brand_id,
                    })),
                });
            } catch (e) {
                console.log('[ERROR] Failed to fetch brands from Dodo Payments!\n', e);
                process.exit(1);
            }
        }

        let migrateTypes: string[] = [];
        if (argv['migrate-types']) {
            migrateTypes = argv['migrate-types'].split(',').map((t: string) => t.trim());
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

        const SERVER: 'production' | 'sandbox' = argv['server'] || 'production';
        const DEFAULT_BASE = SERVER === 'sandbox' ? 'https://sandbox-api.polar.sh/v1' : 'https://api.polar.sh/v1';
        const BASE_URL: string = argv['polar-base-url'] || DEFAULT_BASE;
        console.log(`[LOG] Will migrate: ${migrateTypes.join(', ')} [server=${SERVER}] [base=${BASE_URL}]`);

        // Light connectivity check against products list
        try {
            const ping = await fetch(`${BASE_URL}/products/`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${PROVIDER_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            } as any);
            if (ping.status === 401 || ping.status === 403) {
                throw new Error('Polar API key is invalid or lacks permissions');
            }
            console.log('[LOG] Polar API connectivity check passed (status: ' + ping.status + ')');
        } catch (err: any) {
            console.log('[WARN] Polar connectivity check encountered an issue: ' + (err?.message || String(err)));
        }

        if (migrateTypes.includes('products')) {
            await migrateProducts({ client, brand_id, baseUrl: BASE_URL, token: PROVIDER_API_KEY });
        }
        if (migrateTypes.includes('coupons')) {
            await migrateCoupons({ client, brand_id, baseUrl: BASE_URL, token: PROVIDER_API_KEY });
        }
        if (migrateTypes.includes('customers')) {
            await migrateCustomers({ client, brand_id, baseUrl: BASE_URL, token: PROVIDER_API_KEY });
        }

        console.log('\n[LOG] Polar migration flow completed.');
    }
}

// Types and helpers
interface PolarContext {
    client: DodoPayments;
    brand_id: string;
    baseUrl: string;
    token: string; // Bearer
}

function authHeaders(ctx: PolarContext): Record<string, string> {
    return {
        'Authorization': `Bearer ${ctx.token}`,
        'Content-Type': 'application/json'
    };
}

// Polar fetch + mapping
async function migrateProducts(ctx: PolarContext) {
    console.log('\n[LOG] Starting products migration from Polar...');
    try {
        // Paginated fetch for products
        const pageSize = 50;
        let page = 1;
        const allProducts: any[] = [];
        while (true) {
            let attempts = 0;
            let resp: any;
            while (attempts < 3) {
                resp = await fetch(`${ctx.baseUrl}/products/?limit=${pageSize}&page=${page}`, {
                    method: 'GET',
                    headers: authHeaders(ctx)
                } as any);
                if (resp.status === 429) {
                    await new Promise(r => setTimeout(r, 1000 * (attempts + 1)));
                    attempts++;
                    continue;
                }
                break;
            }
            if (!resp?.ok) {
                const text = await resp?.text?.() || '';
                console.log(`[WARN] Failed to list Polar products (page ${page}): HTTP ${resp?.status} - ${text}`);
                break;
            }
            const json: any = await resp.json().catch(() => ({}));
            const items: any[] = json?.items || json?.data || [];
            if (!items.length) break;
            allProducts.push(...items);
            if (items.length < pageSize) break; // likely last page
            page++;
        }
        if (!allProducts.length) {
            console.log('[LOG] No products found in Polar');
            return;
        }

        const ProductsToMigrate: { type: 'one_time_product' | 'subscription_product', data: any }[] = [];
        for (const p of allProducts) {
            // Resolve primary price from Polar product
            const priceObj = Array.isArray(p?.prices) && p.prices.length > 0 ? p.prices[0] : null;
            const name = p?.name || p?.title || 'Unnamed Product';
            const currency = ((priceObj?.price_currency || p?.price_currency || p?.currency || 'usd') + '').toUpperCase();
            // Amounts are in minor units (cents)
            const unitAmount = Number(priceObj?.price_amount ?? p?.price_amount ?? p?.amount ?? p?.price ?? 0);
            // Interval is product-level per Polar model
            const interval = (p?.recurring_interval || '').toString().toLowerCase();
            const recurringIntervals = ['day','week','month','year'];
            const isRecurring = recurringIntervals.includes(interval) || p?.is_recurring === true;

            if (isRecurring) {
                ProductsToMigrate.push({
                    type: 'subscription_product',
                    data: {
                        name,
                        description: p?.description || '',
                        tax_category: 'saas',
                        price: {
                            currency,
                            price: unitAmount,
                            discount: 0,
                            purchasing_power_parity: false,
                            type: 'recurring_price',
                            billing_period: ((): 'daily' | 'weekly' | 'monthly' | 'yearly' => {
                                switch (interval) {
                                    case 'day': return 'daily';
                                    case 'week': return 'weekly';
                                    case 'month': return 'monthly';
                                    case 'year': return 'yearly';
                                    default: return 'monthly';
                                }
                            })(),
                            payment_frequency_count: 1,
                            payment_frequency_interval: ((): 'Day' | 'Week' | 'Month' | 'Year' => {
                                switch (interval) {
                                    case 'day': return 'Day';
                                    case 'week': return 'Week';
                                    case 'month': return 'Month';
                                    case 'year': return 'Year';
                                    default: return 'Month';
                                }
                            })(),
                            subscription_period_count: 1,
                            subscription_period_interval: ((): 'Day' | 'Week' | 'Month' | 'Year' => {
                                switch (interval) {
                                    case 'day': return 'Day';
                                    case 'week': return 'Week';
                                    case 'month': return 'Month';
                                    case 'year': return 'Year';
                                    default: return 'Month';
                                }
                            })()
                        },
                        brand_id: ctx.brand_id
                    }
                });
            } else {
                ProductsToMigrate.push({
                    type: 'one_time_product',
                    data: {
                        name,
                        description: p?.description || '',
                        tax_category: 'saas',
                        price: {
                            currency,
                            price: unitAmount,
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
            const price = product.data.price.price / 100; // display in major units only for logs
            const type = product.type === 'one_time_product' ? 'One Time' : 'Subscription';
            const billing = product.type === 'subscription_product' ? ` (${product.data.price.billing_period})` : '';
            console.log(`${index + 1}. ${product.data.name} - ${product.data.price.currency} ${price.toFixed(2)} (${type}${billing})`);
        });

        const proceed = await select({
            message: 'Proceed to create these products in Dodo Payments?',
            choices: [
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            ],
        });

        if (proceed === 'yes') {
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
        console.log('[ERROR] Failed to migrate products from Polar\n', error.message);
    }
}

async function migrateCoupons(ctx: PolarContext) {
    console.log('\n[LOG] Starting coupons migration from Polar...');
    try {
        // Paginated fetch for discounts
        const pageSize = 50;
        let page = 1;
        const allCoupons: any[] = [];
        while (true) {
            let attempts = 0;
            let resp: any;
            while (attempts < 3) {
                resp = await fetch(`${ctx.baseUrl}/discounts/?limit=${pageSize}&page=${page}`, {
                    method: 'GET',
                    headers: authHeaders(ctx)
                } as any);
                if (resp.status === 429) {
                    await new Promise(r => setTimeout(r, 1000 * (attempts + 1)));
                    attempts++;
                    continue;
                }
                break;
            }
            if (!resp?.ok) {
                const text = await resp?.text?.() || '';
                console.log(`[WARN] Failed to list Polar coupons (page ${page}): HTTP ${resp?.status} - ${text}`);
                break;
            }
            const json: any = await resp.json().catch(() => ({}));
            const items: any[] = json?.items || json?.data || [];
            if (!items.length) break;
            allCoupons.push(...items);
            if (items.length < pageSize) break;
            page++;
        }
        if (!allCoupons.length) {
            console.log('[LOG] No coupons found in Polar');
            return;
        }

        const CouponsToMigrate: any[] = [];
        for (const c of allCoupons) {
            const discountType = (c?.type || c?.discount_type || '').toString().toLowerCase();
            const isPercentage = discountType === 'percentage' || discountType.includes('percent');
            // Percentage represented in basis_points (1/100th of a percent)
            const basisPoints = Number(c?.basis_points ?? 0);
            // Fixed amount in minor units, currency lower-case `usd` in Polar
            const amount = Number(c?.amount ?? c?.amount_off ?? 0);
            const currency = ((c?.currency || c?.amount_currency || 'usd') + '').toUpperCase();

            if (isPercentage && basisPoints <= 0) {
                console.log(`[WARN] Skipping percentage discount ${c?.code || c?.name || c?.id}: missing or non-positive basis_points.`);
                continue;
            }
            if (!isPercentage) {
                console.log(`[WARN] Skipping non-percentage discount ${c?.code || c?.name || c?.id}: Dodo environment currently accepts only 'percentage'.`);
                continue;
            }

            // Dodo expects amount in basis points for percentage type
            const bp = basisPoints;
            CouponsToMigrate.push({
                code: (c?.code || c?.id || c?.name || '').toString().toUpperCase(),
                name: c?.name || c?.code || null,
                type: 'percentage',
                amount: bp,
                brand_id: ctx.brand_id
            });
        }

        console.log('\n[LOG] These are the coupons to be migrated:');
        CouponsToMigrate.forEach((coupon, index) => {
            const discount = coupon.type === 'percentage'
                ? `${(coupon.amount / 100).toFixed(2)}%`
                : `USD ${(coupon.amount / 100).toFixed(2)}`;
            console.log(`${index + 1}. ${coupon.name || 'Unnamed'} (${coupon.code}) - ${discount} discount`);
        });

        const proceed = await select({
            message: 'Proceed to create these coupons in Dodo Payments?',
            choices: [
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            ],
        });

        if (proceed === 'yes') {
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
        console.log('[ERROR] Failed to migrate coupons from Polar\n', error.message);
    }
}

async function migrateCustomers(ctx: PolarContext) {
    console.log('\n[LOG] Starting customers migration from Polar...');
    try {
        // Paginated fetch for customers
        const pageSize = 50;
        let page = 1;
        const allCustomers: any[] = [];
        while (true) {
            let attempts = 0;
            let resp: any;
            while (attempts < 3) {
                resp = await fetch(`${ctx.baseUrl}/customers/?limit=${pageSize}&page=${page}`, {
                    method: 'GET',
                    headers: authHeaders(ctx)
                } as any);
                if (resp.status === 429) {
                    await new Promise(r => setTimeout(r, 1000 * (attempts + 1)));
                    attempts++;
                    continue;
                }
                break;
            }
            if (!resp?.ok) {
                const text = await resp?.text?.() || '';
                console.log(`[WARN] Failed to list Polar customers (page ${page}): HTTP ${resp?.status} - ${text}`);
                break;
            }
            const json: any = await resp.json().catch(() => ({}));
            const items: any[] = json?.items || json?.data || [];
            if (!items.length) break;
            allCustomers.push(...items);
            if (items.length < pageSize) break;
            page++;
        }
        if (!allCustomers.length) {
            console.log('[LOG] No customers found in Polar');
            return;
        }

        const CustomersToMigrate: any[] = [];
        for (const c of allCustomers) {
            CustomersToMigrate.push({
                email: c?.email || '',
                name: c?.name || '',
                phone: c?.phone || '',
                address: {
                    line1: c?.address?.line1 || '',
                    line2: c?.address?.line2 || '',
                    city: c?.address?.city || '',
                    state: c?.address?.state || '',
                    postal_code: c?.address?.postal_code || '',
                    country: c?.address?.country || ''
                },
                brand_id: ctx.brand_id,
                metadata: {
                    polar_customer_id: c?.id,
                    migrated_from: 'polar'
                }
            });
        }

        console.log('\n[LOG] These are the customers to be migrated:');
        CustomersToMigrate.forEach((customer, index) => {
            console.log(`${index + 1}. ${customer.name || 'Unnamed'} (${customer.email || 'No email'})`);
        });

        const proceed = await select({
            message: 'Proceed to create these customers in Dodo Payments?',
            choices: [
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            ],
        });

        if (proceed === 'yes') {
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
        console.log('[ERROR] Failed to migrate customers from Polar\n', error.message);
    }
}
