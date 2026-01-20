export const logger = {
    log: (message: string) => console.log(`[LOG] ${message}`),
    error: (message: string, error?: any) => {
        console.log(`[ERROR] ${message}`);
        if (error) {
            console.error(typeof error === 'object' && error.message ? error.message : error);
        }
    },
    warn: (message: string) => console.log(`[WARNING] ${message}`),
    info: (message: string) => console.log(`\n[LOG] ${message}`),
    success: (message: string) => console.log(`[SUCCESS] ${message}`)
};
