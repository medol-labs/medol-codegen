const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const templates = path.resolve(__dirname, '../templates/root/src/pages/dashboard');

test('generated dashboard uses model metadata instead of demo metrics', () => {
    const dashboard = fs.readFileSync(path.join(templates, 'dashboard.tsx'), 'utf8');

    assert.match(dashboard, /backendModules, resources/);
    assert.match(dashboard, /filterBackendModules/);
    assert.match(dashboard, /filterResources/);
    assert.doesNotMatch(dashboard, /Total Revenue|New Customers|Total Visitors/);
    assert.doesNotMatch(dashboard, /ChartAreaInteractive|SectionCards/);
});

test('chart examples remain available without being mounted by the dashboard', () => {
    assert.equal(fs.existsSync(path.join(templates, 'chart-area-interactive.tsx')), true);
    assert.equal(fs.existsSync(path.join(templates, 'section-cards.tsx')), true);
});
