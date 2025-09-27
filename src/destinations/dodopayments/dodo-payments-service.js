const { input, select } = require('@inquirer/prompts');
import DodoPayments from 'dodopayments';

export class DodoPaymentsService {
    constructor() {
        this.client = null;
        this.brandId = null;
    }

    getDodoYargsOptions() {
        return {
            'dodo-api-key': {
                describe: 'DodoPayments API Key',
                type: 'string',
                demandOption: false
            },
            'dodo-brand-id': {
                describe: 'DodoPayments Brand ID',
                type: 'string',
                demandOption: false
            },
            'mode': {
                describe: 'DodoPayments environment',
                type: 'string',
                choices: ['test_mode', 'live_mode'],
                demandOption: false,
                default: 'test_mode'
            }
        };
    }

    // Handler logic for DodoPayments arguments
    async processDodoArguments(argv) {
        const DODO_API_KEY = argv['dodo-api-key'] || await input({
            message: 'Enter your DodoPayments API Key:',
            required: true
        });

        const DODO_BRAND_ID = argv['dodo-brand-id'] || await input({
            message: 'Enter your DodoPayments Brand ID:',
            required: true
        });

        const MODE = argv['mode'] || await select({
            message: 'Select DodoPayments environment:',
            choices: [
                { name: 'Test Mode', value: 'test_mode' },
                { name: 'Live Mode', value: 'live_mode' }
            ],
            default: 'test_mode'
        });

        return {
            apiKey: DODO_API_KEY,
            brandId: DODO_BRAND_ID,
            mode: MODE
        };
    }

    async initialize(apiKey, mode, brandId = null) {
        // Set up the DodoPayments SDK
        this.client = new DodoPayments({
            bearerToken: apiKey,
            environment: mode,
        });

        // Handle brand selection
        this.brandId = brandId || await this.selectBrand();
        return this.brandId;
    }

    async selectBrand() {
        try {
            // List the brands for the current account from the DodoPayments SDK
            const brands = await this.client.brands.list();

            // Give the user an option to select their preferred brand in their DodoPayments account
            return await select({
                message: 'Select your DodoPayments brand:',
                choices: brands.items.map((brand) => ({
                    name: brand.name || 'Unnamed Brand',
                    value: brand.brand_id,
                })),
            });
        } catch (e) {
            console.log("[ERROR] Failed to fetch brands from DodoPayments!\n", e);
            process.exit(1);
        }
    }

    displayProductsPreview(products) {
        console.log('\n[LOG] These are the products to be migrated:');
        products.forEach((product, index) => {
            console.log(`${index + 1}. ${product.data.name} - ${product.data.price.currency} ${(product.data.price.price / 100).toFixed(2)} (${product.type === 'one_time_product' ? 'One Time' : 'Unknown'})`);
        });
    }

    async confirmMigration() {
        return select({
            message: 'Proceed to create these products in DodoPayments?',
            choices: [
                {name: 'Yes', value: 'yes'},
                {name: 'No', value: 'no'}
            ],
        });
    }

    async migrateProducts(products) {
        const confirmation = await this.confirmMigration();

        if (confirmation !== 'yes') {
            console.log('[LOG] Migration aborted by user');
            return false;
        }

        for (let product of products) {
            console.log();
            if (product.type === 'one_time_product') {
                console.log(`[LOG] Migrating product: ${product.data.name}`);
                try {
                    const createdProduct = await this.client.products.create(product.data);
                    console.log(`[LOG] Migration for product: ${createdProduct.name} completed (DodoPayments product ID: ${createdProduct.product_id})`);
                } catch (error) {
                    console.log(`[ERROR] Failed to migrate product: ${product.data.name}\n`, error);
                }
            } else {
                console.log(`[LOG] Skipping product: ${product.data.name} for unknown product type`);
            }
        }

        console.log('\n[LOG] All products migrated successfully!');
        return true;
    }
}
