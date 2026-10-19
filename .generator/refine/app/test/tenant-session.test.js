const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const read = name => fs.readFileSync(path.join(__dirname, '../templates', name), 'utf8');

test('tenant controls and request headers are absent unless enabled in the model', () => {
    for (const name of ['root/src/providers/api-auth.ts', 'root/src/components/refine-ui/layout/header.tsx']) {
        const template = read(name);
        assert.doesNotMatch(ejs.render(template, {tenancyEnabled: false}), /TenantSwitcher|tenant-session|X-Tenant-Id/);
        assert.match(ejs.render(template, {tenancyEnabled: true}), /TenantSwitcher|tenant-session/);
    }
    const auth = ejs.render(read('root/src/providers/api-auth.ts'), {tenancyEnabled: true});
    assert.match(auth, /X-Tenant-Id/);
    assert.match(auth, /clearSelectedTenant\(\)/);
});

test('tenant selection is account-bound and reloads to discard prior tenant caches', () => {
    const session = ejs.render(read('tenancy/tenant-session.ts.tpl'), {tenantScopeKey: '"arbitrary-system"'});
    assert.match(session, /sessionStorage\.getItem\(key\)/);
    assert.match(session, /user && value\?\.id && value\.owner === user/);
    assert.match(session, /window\.location\.replace\(import\.meta\.env\.BASE_URL\)/);
    const switcher = read('tenancy/tenant-switcher.tsx.tpl');
    assert.match(switcher, /size: "50"/);
    assert.match(switcher, /api\/tenancy\/tenants/);
    assert.match(switcher, /page\.nextCursor/);
    assert.doesNotMatch(switcher, /selectTenant\(page\.items\[0\]\)/);
});
