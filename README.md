# Dodo Migrate
<p align="left">
  <a href="https://www.npmjs.com/package/dodo-migrate">
    <img src="https://img.shields.io/npm/v/dodo-migrate?color=cb3837&label=npm&logo=npm" alt="npm version" />
  </a>
  <a href="https://discord.gg/bYqAp4ayYh">
    <img src="https://img.shields.io/discord/1305511580854779984?label=Join%20Discord&logo=discord" alt="Join Discord" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-GPLv3-blue.svg" alt="License: GPLv3" />
  </a>
</p>

Dodo Migrate is a CLI tool designed to help you safely and efficiently migrate your data from popular payment providers into Dodo Payments. Whether you're moving products, customers, or discount codes, Dodo Migrate guides you through a secure, auditable, and repeatable migration process with interactive prompts and sensible defaults.

**Supported providers:**
- [x] Lemon Squeezy
- [x] Gumroad
- [x] 2Checkout
- [x] FastSpring
- [x] Stripe
- [x] Paddle
- [x] Razorpay

**Supported models:**
- [x] Products
- [x] Discount codes
- [x] Customers

## Contents
- [Dodo Migrate](#dodo-migrate)
  - [Contents](#contents)
  - [Features](#features)
  - [Requirements](#requirements)
  - [Install](#install)
  - [Quick start](#quick-start)
  - [CLI reference](#cli-reference)
  - [Providers](#providers)
    - [Stripe](#stripe)
    - [Lemon Squeezy](#lemon-squeezy)
    - [Gumroad](#gumroad)
    - [Paddle](#paddle)
    - [Razorpay](#razorpay)
    - [2Checkout](#2checkout)
    - [FastSpring](#fastspring)
  - [Examples](#examples)
    - [Interactive Migration (Recommended)](#interactive-migration-recommended)
    - [Non-Interactive Migration](#non-interactive-migration)
  - [Update / Uninstall](#update--uninstall)
  - [Roadmap](#roadmap)
  - [Contributing](#contributing)
  - [License](#license)

## Features
- Safe, confirm-before-write migration flow
- Interactive prompts with sensible defaults
- Works with Dodo Payments test or live environments
- Incremental, repeatable runs
- Multi-provider support with unified interface
- Selective data migration (choose what to migrate)
- Connection validation before migration
- Detailed progress logging and error handling

## Requirements
- Node.js ≥ 18 (for native `fetch` used by the CLI)
- Provider API key and Dodo Payments API key

## Install
```
npm i -g dodo-migrate
```

## Quick start
Migrate from any supported provider to Dodo Payments:
```
dodo-migrate <provider>
```
You'll be prompted for any missing inputs (API keys, brand selection, environment) and can select what data types to migrate.

## CLI reference
Global usage:
```
dodo-migrate <provider> [options]
```

Options (all optional; interactive prompts will fill in when omitted):

| option | values | description |
| --- | --- | --- |
| `--provider-api-key` | string | Provider API key (varies by provider) |
| `--dodo-api-key` | string | Dodo Payments API key |
| `--mode` | `test_mode` / `live_mode` | Dodo Payments environment (default: `test_mode`) |
| `--dodo-brand-id` | string | Target Dodo Payments brand ID |
| `--migrate-types` | string | Comma-separated list: products,discounts,customers |

Provider-specific options:

| Provider | Additional Options | Description |
| --- | --- | --- |
| Paddle | `--paddle-vendor-id` | Paddle Vendor ID |
| Razorpay | `--razorpay-key-secret` | Razorpay Key Secret |
| 2Checkout | `--provider-seller-id` | 2Checkout Seller ID |

Helpful commands:
```
dodo-migrate --help
dodo-migrate <provider> --help
```

## Providers
All providers support interactive migration with the ability to select specific data types:

### Stripe
Migrates products (with pricing), coupons, and customers from Stripe.
```
dodo-migrate stripe
```

### Lemon Squeezy
Migrates products, discounts, and customers from Lemon Squeezy.
```
dodo-migrate lemonsqueezy
```

### Gumroad
Migrates products, offer codes, and customers from Gumroad.
```
dodo-migrate gumroad
```

### Paddle
Migrates products, coupons, and customers from Paddle.
```
dodo-migrate paddle
```

### Razorpay
Migrates subscription plans, items, coupons, and customers from Razorpay.
```
dodo-migrate razorpay
```

### 2Checkout
Migrates discounts and customers from 2Checkout.
```
dodo-migrate 2checkout
```

### FastSpring
Migrates products, coupons, and customers from FastSpring.
```
dodo-migrate fastspring
```

## Examples

### Interactive Migration (Recommended)
Start an interactive migration session where you'll be prompted to select what to migrate:

**Stripe:**
```bash
dodo-migrate stripe
```

**Lemon Squeezy:**
```bash
dodo-migrate lemonsqueezy
```

**Gumroad:**
```bash
dodo-migrate gumroad
```

**Paddle:**
```bash
dodo-migrate paddle
```

**Razorpay:**
```bash
dodo-migrate razorpay
```

**2Checkout:**
```bash
dodo-migrate 2checkout
```

**FastSpring:**
```bash
dodo-migrate fastspring
```

### Non-Interactive Migration
Provide all parameters via command line flags:

**Stripe (all data types):**
```bash
dodo-migrate stripe \
  --provider-api-key=sk_live_XXXXXXXXXXXXXXXX \
  --dodo-api-key=dp_XXXXXXXXXXXXXXXX \
  --mode=test_mode \
  --dodo-brand-id=brand_XXXXXX \
  --migrate-types=products,coupons,customers
```

**Lemon Squeezy (products only):**
```bash
dodo-migrate lemonsqueezy \
  --provider-api-key=lsq_XXXXXXXXXXXXXXXX \
  --dodo-api-key=dp_XXXXXXXXXXXXXXXX \
  --mode=test_mode \
  --dodo-brand-id=brand_XXXXXX \
  --migrate-types=products
```

**Gumroad (products and discounts):**
```bash
dodo-migrate gumroad \
  --provider-api-key=your_gumroad_token \
  --dodo-api-key=dp_XXXXXXXXXXXXXXXX \
  --mode=live_mode \
  --dodo-brand-id=brand_XXXXXX \
  --migrate-types=products,discounts
```

**Paddle (customers only):**
```bash
dodo-migrate paddle \
  --provider-api-key=your_paddle_api_key \
  --paddle-vendor-id=12345 \
  --dodo-api-key=dp_XXXXXXXXXXXXXXXX \
  --mode=test_mode \
  --dodo-brand-id=brand_XXXXXX \
  --migrate-types=customers
```

**Razorpay (all data types):**
```bash
dodo-migrate razorpay \
  --provider-api-key=rzp_live_XXXXXXXX \
  --razorpay-key-secret=your_secret_key \
  --dodo-api-key=dp_XXXXXXXXXXXXXXXX \
  --mode=test_mode \
  --dodo-brand-id=brand_XXXXXX \
  --migrate-types=products,discounts,customers
```

**2Checkout (discounts and customers):**
```bash
dodo-migrate 2checkout \
  --provider-seller-id=123456789 \
  --provider-api-key=your_api_key \
  --dodo-api-key=dp_XXXXXXXXXXXXXXXX \
  --mode=test_mode \
  --dodo-brand-id=brand_XXXXXX \
  --migrate-types=discounts,customers
```

**FastSpring (products and coupons):**
```bash
dodo-migrate fastspring \
  --provider-api-key=your_fastspring_key \
  --dodo-api-key=dp_XXXXXXXXXXXXXXXX \
  --mode=test_mode \
  --dodo-brand-id=brand_XXXXXX \
  --migrate-types=products,coupons
```

## Update / Uninstall
```
npm update -g dodo-migrate
npm uninstall -g dodo-migrate
```

## Roadmap
- Enhanced data mapping and transformation options
- Migration rollback capabilities
- Bulk migration scheduling
- Migration progress persistence and resume functionality
- Custom field mapping support

## Contributing
Interested in contributing? See [contributing.md](./contributing.md) for guidelines.

## License
GPL-3.0 © Dodo Payments. See [LICENSE](./LICENSE).
