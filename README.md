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

Note: This tool is currently in Beta and may contain bugs. If you encounter any issues, please inform us promptly. Additionally, after the migration is completed, kindly verify the product information to ensure it has been migrated accurately as it was previously. Should you identify any discrepancies, kindly report them via our [Discord](https://discord.gg/S6kuPSW5Fm) or GitHub issues.

**Supported providers:**
- [x] Lemon Squeezy
- [x] Stripe
- [x] Polar.sh
- [x] Paddle
- [ ] Gumroad
- [ ] 2Checkout
- [ ] FastSpring

**Supported models:**
- [x] Products
- [x] Discount codes
- [x] Customers

## Contents
- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [CLI reference](#cli-reference)
- [Providers](#providers)
- [Examples](#examples)
- [Update / Uninstall](#update--uninstall)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Features
- Safe, confirm-before-write migration flow
- Interactive prompts with sensible defaults
- Works with Dodo Payments test or live environments
- Incremental, repeatable runs

## Requirements
- Node.js ≥ 18 (for native `fetch` used by the CLI)
- Provider API key and Dodo Payments API key

## Install
```
npm i -g dodo-migrate
```

## Quick start
Migrate from Lemon Squeezy to Dodo Payments:
```
dodo-migrate lemonsqueezy
```
Migrate from Stripe to Dodo Payments:
```
dodo-migrate stripe
```
Migrate from Polar.sh to Dodo Payments:
```
dodo-migrate polar
```
Migrate from Paddle to Dodo Payments:
```
dodo-migrate paddle
```
You'll be prompted for any missing inputs (API keys, brand selection, environment).

## CLI reference
Global usage:
```
dodo-migrate <provider> [options]
```

Options (all optional; interactive prompts will fill in when omitted):

| option | values | description |
| --- | --- | --- |
| `--provider-api-key` | string | Provider API key (e.g., Lemon Squeezy) |
| `--dodo-api-key` | string | Dodo Payments API key |
| `--mode` | `test_mode` / `live_mode` | Dodo Payments environment (default: `test_mode`) |
| `--dodo-brand-id` | string | Target Dodo Payments brand ID |

Helpful commands:
```
dodo-migrate --help
dodo-migrate lemonsqueezy --help
```

## Providers
Detailed, provider-specific docs:
- [Lemon Squeezy → Dodo Payments](./docs/lemonsqueezy/README.md)
- [Stripe → Dodo Payments](./docs/stripe/README.md)
- [Polar.sh → Dodo Payments](./docs/polar/README.md)
- [Paddle → Dodo Payments](./docs/paddle/README.md)

## Examples
- Minimal migration from Lemon Squeezy (interactive):
```
dodo-migrate lemonsqueezy
```

- Minimal migration from Stripe (interactive):
```
dodo-migrate stripe
```

- Minimal migration from Polar.sh (interactive):
```
dodo-migrate polar
```

- Minimal migration from Paddle (interactive):
```
dodo-migrate paddle
```

- Non-interactive run (all flags provided):
```
dodo-migrate lemonsqueezy \
  --provider-api-key=lsq_XXXXXXXXXXXXXXXX \
  --dodo-api-key=dp_XXXXXXXXXXXXXXXX \
  --mode=test_mode \
  --dodo-brand-id=brand_XXXXXX

dodo-migrate stripe \
  --provider-api-key=sk_test_XXXXXXXXXXXXXXXX \
  --dodo-api-key=dp_XXXXXXXXXXXXXXXX \
  --mode=test_mode \
  --dodo-brand-id=brand_XXXXXX \
  --migrate-types=products,coupons

dodo-migrate polar \
  --provider-api-key=polar_org_XXXXXXXXXXXXXXXX \
  --dodo-api-key=dp_XXXXXXXXXXXXXXXX \
  --mode=test_mode \
  --dodo-brand-id=brand_XXXXXX \
  --migrate-types=products,discounts,customers

dodo-migrate paddle \
  --provider-api-key=paddle_XXXXXXXXXXXXXXXX \
  --dodo-api-key=dp_XXXXXXXXXXXXXXXX \
  --mode=test_mode \
  --dodo-brand-id=brand_XXXXXX
```

## Update / Uninstall
```
npm update -g dodo-migrate
npm uninstall -g dodo-migrate
```

## Roadmap
- Add more providers
- Add more data options per provider

## Contributing
Interested in contributing? See [contributing.md](./contributing.md) for guidelines.

## License
GPL-3.0 © Dodo Payments. See [LICENSE](./LICENSE).