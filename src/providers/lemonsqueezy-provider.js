import { listProducts, lemonSqueezySetup, getStore } from '@lemonsqueezy/lemonsqueezy.js';

export class LemonSqueezyProvider {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.storesCache = {};
        this.setupSDK();
    }

    // Set up the LemonSqueezy SDK
    setupSDK() {
        lemonSqueezySetup({
            apiKey: this.apiKey,
            onError: (error) => {
                console.log("[ERROR] Failed to set up LemonSqueezy!\n", error.cause);
                process.exit(1);
            },
        });
    }

    async getStoreData(storeId) {
        if (!this.storesCache[storeId]) {
            console.log(`[LOG] Fetching store data for store ID ${storeId}`);
            const fetchStoreData = await getStore(storeId);

            if (fetchStoreData.error || fetchStoreData.statusCode !== 200) {
                console.log(`[ERROR] Failed to fetch store data for store ID ${storeId}\n`, fetchStoreData.error);
                process.exit(1);
            }

            this.storesCache[storeId] = fetchStoreData.data;
        } else {
            console.log(`[LOG] Using cached store data for store ID ${storeId}`);
        }

        return this.storesCache[storeId];
    }

    async fetchProducts() {
        const listProducts = await listProducts();

        if (listProducts.error || listProducts.statusCode !== 200) {
            console.log("[ERROR] Failed to fetch products from LemonSqueezy!\n", listProducts.error);
            process.exit(1);
        }

        console.log('[LOG] Found ' + listProducts.data.data.length + ' products in LemonSqueezy');

        const products = [];

        for (let product of listProducts.data.data) {
            const storeData = await this.getStoreData(product.attributes.store_id);

            products.push({
                name: product.attributes.name,
                price: product.attributes.price,
                currency: storeData.data.attributes.currency,
                type: 'one_time' // You can extend this based on LemonSqueezy product types
            });
        }

        return products;
    }

    transformProduct(productData, brandId) {
        return {
            type: 'one_time_product',
            data: {
                name: productData.name,
                tax_category: 'saas',
                price: {
                    currency: productData.currency,
                    price: productData.price,
                    discount: 0,
                    purchasing_power_parity: false,
                    type: 'one_time_price'
                },
                brand_id: brandId
            }
        };
    }
}
