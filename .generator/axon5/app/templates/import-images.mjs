#!/usr/bin/env node

process.argv.splice(2, 0, 'import');
await import('./image-bundle.mjs');
