# Contributing
We welcome contributors to this repository. We will give out swags to those who provide many vauable contributions.

## Basic information
Folder structure:
```
docs/
    [provider]/
        README.md ⬅ Entrypoint of the provider usage documentation
        [...other docs files]
src/
    index.ts ⬅ Main entrypoint File
    providers/
        [provider] ⬅ provider name (eg, lemonsqueezy, stripe, etc)
            index.ts ⬅ Entrypoint for the command
            [...other files] ⬅ Put the other files containing the code, etc that don't belong into the entrypoint src/providers/[provider]/index.ts file
```

Example folder structure:
```
docs/
    stripe/
        README.md
src/
    index.ts
    providers/
        stripe/
            index.ts
```
Keep arguments optional. Do not force the user to enter arguments. Instead, add input if arguments are missing. Check the [Lemon Squeezy](./src/providers/lemonsqueezy/index.ts) migrator for an example.

Prevent using compilers/runtimes other than NodeJS. This is to make sure it's easy to contribute for all future contributors.

Please add comments where appropriate to make it easier for further contributors to contribute.

‼️ When working with subscription migration, please make sure the subscription period is 20 years. In many cases, it has been observed that contributors are setting the subscription period same as the subscription interval. This is because it will cause subscriptions to work only 1 time.

```
Subscription interval = Interval when the subscription will be triggered (example: per month or per year).

Subscription period = Max time after which subscription will automatically be cancelled (example: some large value like 10 years or 20 years).
```

## High Level Flow:
1. User runs the command with or without arguments.
2. If user doesn't use arguments, ask them for input.
3. Fetch the required data from their previous provider (example Stripe, Lemon Squeezy).
4. Normalize the data to for Dodo Payment's model.
5. Copy the required data from the previous provider to Dodo Payments.

## Migration Scope:
- Products.
- License Keys.
- Associated Files.
- Discount Codes.
- Customers.

## Libraries:  
Currently used libraries:  
- [yargs](https://github.com/yargs/yargs) - for parsing command line arguments in nodejs.
- [inquirer](https://github.com/SBoudrias/Inquirer.js) - for taking user input.
- Various SDKs from the providers themselves (example, [Lemon Squeezy SDK](https://github.com/lmsqueezy/lemonsqueezy.js))

Please prevent using additional libraries if not majorly required. You are free to use the providers official SDKs. This is to ensure this project doesn't get overcluttered with less used dependencies.