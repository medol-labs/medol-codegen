#!/usr/bin/env node

process.argv.splice(2, 0, 'pull');
await import('./dependency-images.mjs');
