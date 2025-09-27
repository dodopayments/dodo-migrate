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

Dodo Migrate is a CLI tool designed to help you safely and efficiently migrate your data from popular payment providers into DodoPayments. Whether you're moving products, customers, or discount codes, Dodo Migrate guides you through a secure, auditable, and repeatable migration process with interactive prompts and sensible defaults.

**Supported providers:**
- [x] LemonSqueezy
- [ ] Gumroad
- [ ] 2Checkout
- [ ] FastSpring
- [ ] Stripe
- [ ] Paddle

**Supported models:**
- [x] Products
- [ ] Discount codes
- [ ] Customers

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
- Works with DodoPayments test or live environments
- Incremental, repeatable runs

## Requirements
- Node.js ≥ 18 (for native `fetch` used by the CLI)
- Provider API key and DodoPayments API key

## Install
```
npm i -g dodo-migrate
```

## Quick start
Migrate from LemonSqueezy to DodoPayments:
```
dodo-migrate lemonsqueezy
```
You’ll be prompted for any missing inputs (API keys, brand selection, environment).

## CLI reference
Global usage:
```
dodo-migrate <provider> [options]
```

Options (all optional; interactive prompts will fill in when omitted):

| option | values | description |
| --- | --- | --- |
| `--provider-api-key` | string | Provider API key (e.g., LemonSqueezy) |
| `--dodo-api-key` | string | DodoPayments API key |
| `--mode` | `test_mode` / `live_mode` | DodoPayments environment (default: `test_mode`) |
| `--dodo-brand-id` | string | Target DodoPayments brand ID |

Helpful commands:
```
dodo-migrate --help
dodo-migrate lemonsqueezy --help
```

## Providers
Detailed, provider-specific docs:
- [LemonSqueezy → DodoPayments](./docs/lemonsqueezy/README.md)

## Examples
- Minimal migration from LemonSqueezy (interactive):
```
dodo-migrate lemonsqueezy
```

- Non-interactive run (all flags provided):
```
dodo-migrate lemonsqueezy \
  --provider-api-key=lsq_XXXXXXXXXXXXXXXX \
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
GPL-3.0 © DodoPayments. See [LICENSE](./LICENSE).