#!/usr/bin/env node
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs';

import MigrateLemonSqueezy from './providers/lemonsqueezy/index.js';
import MigrateStripe from './providers/stripe/index.js';
import MigratePolar from './providers/polar/index.js';

// Silently check for the latest version of the package
// Added a try catch block to ensure that any errors during the fetch process (example, NPM is down) do not crash the application
try {
    const fetchLatestPackageInformation = await fetch('https://registry.npmjs.org/dodo-migrate');
    // Only parse & display this information if the fetch was successful
    if (fetchLatestPackageInformation.status === 200) {
        const packageInformation = await fetchLatestPackageInformation.json() as any;
        const latestVersion = packageInformation['dist-tags'].latest;
        const currentVersion = (await import('../package.json')).version;
        if (latestVersion !== currentVersion) {
            console.log(`\n\x1b[33mA new version of the Dodo Payments Migrator is available! (v${latestVersion})\x1b[0m\nPlease update by running: \x1b[36mnpm install -g dodo-migrate@latest\x1b[0m\n`);
        }
    }
} catch { }

yargs(hideBin(process.argv))
    .scriptName("dodo-migrate")
    .usage('$0 <command> [options]')
    .demandCommand(1, 'You need to specify a command')
    .help()
    .alias('h', 'help')
    .version()
    .alias('v', 'version')
    // Add other providers command files after this
    .command(MigrateLemonSqueezy)
    .command(MigrateStripe)
    .command(MigratePolar)
    .argv;
