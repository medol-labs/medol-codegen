const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const authTemplate = fs.readFileSync(
    path.resolve(__dirname, '../templates/root/src/providers/auth.ts'),
    'utf8',
);

test('generated authentication validates cached sessions with the backend', () => {
    const checkStart = authTemplate.indexOf('check: async () =>');
    const permissionsStart = authTemplate.indexOf('getPermissions: async () =>');
    const checkImplementation = authTemplate.slice(checkStart, permissionsStart);

    assert.ok(checkStart >= 0);
    assert.ok(permissionsStart > checkStart);
    assert.match(checkImplementation, /await validateCurrentSession\(\)/);
    assert.match(checkImplementation, /catch[\s\S]*clearLocalAuth\(\)/);
    assert.doesNotMatch(checkImplementation, /if \(cachedCurrentUser\(\)\)/);
});

test('generated authentication validates each access token only once per page lifecycle', () => {
    const apiAuthTemplate = fs.readFileSync(
        path.resolve(__dirname, '../templates/root/src/providers/api-auth.ts'),
        'utf8',
    );

    assert.match(apiAuthTemplate, /let validatedAccessToken: string \| null = null/);
    assert.match(apiAuthTemplate, /accessToken === validatedAccessToken && cachedUser/);
    assert.match(apiAuthTemplate, /validatedAccessToken = accessToken \?\? null/);
});
