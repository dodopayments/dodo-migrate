import { logger } from './logger';

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry async fn with exponential backoff on 429 (rate limit).
 * Reads retry-after header when available, otherwise exponential delay.
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: { maxRetries?: number; baseDelay?: number; label?: string } = {}
): Promise<T> {
    const { maxRetries = 3, baseDelay = 1000, label = 'API call' } = options;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            const status = error.statusCode ?? error.status ?? error?.response?.status;
            if (status === 429 && attempt < maxRetries) {
                const retryAfter = error.headers?.['retry-after']
                    ?? error.response?.headers?.['retry-after'];
                let waitMs = baseDelay * Math.pow(2, attempt);
                if (retryAfter) {
                    const parsed = parseInt(retryAfter, 10);
                    if (!isNaN(parsed)) {
                        waitMs = parsed * 1000;
                    } else {
                        const dateMs = Date.parse(retryAfter);
                        if (!isNaN(dateMs)) {
                            waitMs = Math.max(0, dateMs - Date.now());
                        }
                    }
                }

                logger.warn(`Rate limited on ${label} (attempt ${attempt + 1}/${maxRetries}). Retrying in ${Math.round(waitMs / 1000)}s...`);
                await delay(waitMs);
                continue;
            }
            throw error;
        }
    }

    throw new Error(`${label}: max retries exceeded`);
}

export interface LicenseKeyToMigrate {
    key: string;
    /** Dodo customer ID (mapped from source) */
    dodo_customer_id: string;
    /** Dodo product ID (mapped from source) */
    dodo_product_id: string;
    activations_limit: number | null;
    expires_at: string | null;
    source_key_id: string;
    display_key: string;
    product_name: string;
    customer_email: string;
}
