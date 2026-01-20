import DodoPayments from 'dodopayments';
import { select, password } from '@inquirer/prompts';
import { logger } from './logger';

export async function getDodoCredentials(argv: any) {
    const DODO_API_KEY = argv['dodo-api-key'] || await password({
        message: 'Enter your Dodo Payments API Key:',
        mask: '*',
        validate: (value) => value ? true : 'API Key is required'
    });

    const MODE = argv['mode'] || await select({
        message: 'Select Dodo Payments environment:',
        choices: [
            { name: 'Test Mode', value: 'test_mode' },
            { name: 'Live Mode', value: 'live_mode' }
        ],
        default: 'test_mode'
    });

    return { apiKey: DODO_API_KEY, mode: MODE };
}

export function setupDodoClient(apiKey: string, mode: 'test_mode' | 'live_mode') {
    return new DodoPayments({
        bearerToken: apiKey,
        environment: mode,
    });
}

export async function selectDodoBrand(client: DodoPayments, argv: any) {
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
        } catch (e: any) {
            logger.error("Failed to fetch brands from Dodo Payments!", e);
            process.exit(1);
        }
    }
    return brand_id;
}
