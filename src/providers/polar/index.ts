import DodoPayments from 'dodopayments';
import { input, select, checkbox } from '@inquirer/prompts';

// NOTE: Polar.sh API surface is being researched. This scaffold sets up
// auth prompts, environment selection, brand selection, and stubs for
// products/coupons/customers migration. Replace fetch calls and shapes
// once Polar endpoints are finalized.

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

        // Light connectivity check (GET /v1/health or similar once confirmed)
        try {
            // Lightweight connectivity check against products list
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

// Stubs: replace with real Polar endpoints and mapping
async function migrateProducts(ctx: PolarContext) {
    console.log('\n[LOG] Starting products migration from Polar...');
    try {
        // TODO: Replace with real endpoint once confirmed
        const resp = await fetch(`${ctx.baseUrl}/products/?limit=50`, {
            method: 'GET',
            headers: authHeaders(ctx)
        } as any);

        if (!resp.ok) {
            const text = await resp.text();
            console.log(`[WARN] Failed to list Polar products: HTTP ${resp.status} - ${text}`);
            return;
        }
        const json: any = await resp.json().catch(() => ({}));
        const products: any[] = json?.items || json?.data || [];
        if (!products.length) {
            console.log('[LOG] No products found in Polar');
            return;
        }

        const ProductsToMigrate: { type: 'one_time_product' | 'subscription_product', data: any }[] = [];
        for (const p of products) {
            // Heuristic placeholders; adjust once Polar schema is known
            const name = p?.name || p?.title || 'Unnamed Product';
            const currency = (p?.currency || p?.price_currency || 'USD').toString().toUpperCase();
            // Amounts: Polar uses minor units (cents). Prefer price_amount/amount; fall back to price if already minor.
            const unitAmount = Number(p?.price_amount ?? p?.amount ?? p?.price ?? 0);
            // Interval now lives on product (per Polar changelog). Probe multiple field names safely.
            const interval = (p?.recurring_interval || p?.interval || p?.billing_interval || '').toString().toLowerCase();
            const isRecurring = interval === 'month' || interval === 'year';

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
                            billing_period: interval === 'month' ? 'monthly' : 'yearly'
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
        // TODO: Replace with real endpoint once confirmed
        const resp = await fetch(`${ctx.baseUrl}/discounts/?limit=50`, {
            method: 'GET',
            headers: authHeaders(ctx)
        } as any);

        if (!resp.ok) {
            const text = await resp.text();
            console.log(`[WARN] Failed to list Polar coupons: HTTP ${resp.status} - ${text}`);
            return;
        }
        const json: any = await resp.json().catch(() => ({}));
        const coupons: any[] = json?.items || json?.data || [];
        if (!coupons.length) {
            console.log('[LOG] No coupons found in Polar');
            return;
        }

        const CouponsToMigrate: any[] = [];
        for (const c of coupons) {
            const discountType = (c?.type || c?.discount_type || '').toString().toLowerCase();
            const isPercentage = discountType.includes('percent');
            const percent = Number(c?.percent_off ?? c?.percentage ?? c?.value ?? 0);
            // Minor units for fixed amount
            const amount = Number(c?.amount_off ?? c?.amount ?? c?.value_amount ?? 0);
            const currency = (c?.currency || c?.amount_currency || 'USD').toString().toUpperCase();

            if (isPercentage && percent <= 0) continue;
            if (!isPercentage && amount <= 0) continue;

            CouponsToMigrate.push({
                code: c?.code || c?.id || c?.name,
                name: c?.name || c?.code || 'Unnamed Coupon',
                discount_type: isPercentage ? 'percentage' : 'fixed_amount',
                discount_value: isPercentage ? percent : amount,
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
        // TODO: Replace with real endpoint once confirmed
        const resp = await fetch(`${ctx.baseUrl}/customers/?limit=50`, {
            method: 'GET',
            headers: authHeaders(ctx)
        } as any);

        if (!resp.ok) {
            const text = await resp.text();
            console.log(`[WARN] Failed to list Polar customers: HTTP ${resp.status} - ${text}`);
            return;
        }
        const json: any = await resp.json().catch(() => ({}));
        const customers: any[] = json?.items || json?.data || [];
        if (!customers.length) {
            console.log('[LOG] No customers found in Polar');
            return;
        }

        const CustomersToMigrate: any[] = [];
        for (const c of customers) {
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
