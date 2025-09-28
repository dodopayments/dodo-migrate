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
```bash
npm i -g dodo-migrate
