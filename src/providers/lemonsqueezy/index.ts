import { input, select } from '@inquirer/prompts';
import { DodoPaymentsService } from '../../destinations/dodopayments/dodo-payments-service.js';
import { LemonSqueezyProvider } from '../lemonsqueezy-provider.js';

const dodoService = new DodoPaymentsService();

export default {
    // Format: dodo-migrate [provider] [arguments]
    command: 'lemonsqueezy [arguments]',
    describe: 'Migrate from LemonSqueezy to DodoPayments',
    builder: (yargs: any) => {
        return yargs
            .option('provider-api-key', {
                describe: 'LemonSqueezy API Key',
                type: 'string',
                demandOption: false
            })
            // Add DodoPayments options
            .options(dodoService.getDodoYargsOptions());
    },
    handler: async (argv: any) => {
        // Store the details of the API keys and mode, and prompt the user if they fail to provide it in the CLI
        const PROVIDER_API_KEY = argv['provider-api-key'] || await input({
            message: 'Enter your LemonSqueezy API Key:',
            required: true
        });

        // Process DodoPayments arguments
        const dodoConfig = await dodoService.processDodoArguments(argv);

        // Initialize services
        const lemonSqueezyProvider = new LemonSqueezyProvider(PROVIDER_API_KEY);

        // Initialize DodoPayments service
        await dodoService.initialize(dodoConfig.apiKey, dodoConfig.mode, dodoConfig.brandId);

        // Fetch products from source provider
        const sourceProducts = await lemonSqueezyProvider.fetchProducts();

        // Transform products for DodoPayments
        const transformedProducts = sourceProducts.map(product =>
            lemonSqueezyProvider.transformProduct(product, dodoConfig.brandId)
        );

        // Display products and migrate
        dodoService.displayProductsPreview(transformedProducts);
        await dodoService.migrateProducts(transformedProducts);
    }
}
