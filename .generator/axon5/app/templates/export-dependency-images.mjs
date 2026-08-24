#!/usr/bin/env node

process.argv.splice(2, 0, 'all');
await import('./dependency-images.mjs');
