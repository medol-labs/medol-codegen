#!/usr/bin/env node

process.argv.splice(2, 0, 'build');
await import('./image-bundle.mjs');
