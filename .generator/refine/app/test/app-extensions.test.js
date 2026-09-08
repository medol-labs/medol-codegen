const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const templates = path.resolve(__dirname, '../templates');

const readTemplate = (relativePath) =>
    fs.readFileSync(path.join(templates, relativePath), 'utf8');

const occurrences = (content, value) => content.split(value).length - 1;

test('generated frontend framework delegates application-specific behavior to stable extensions', () => {
    assert.match(readTemplate('root/src/App.tsx'), /AppExtensionProvider/);
    assert.match(readTemplate('root/src/App.tsx'), /resolveBackendBaseUrl/);
    assert.match(readTemplate('root/src/components/refine-ui/layout/header.tsx'), /HeaderExtensionActions/);
    const router = readTemplate('root/src/providers/app-router.tsx');
    assert.equal(occurrences(router, 'import { AuthenticatedRouteExtension }'), 1);
    assert.equal(occurrences(router, '<AuthenticatedRouteExtension>'), 1);
    assert.equal(occurrences(router, '</AuthenticatedRouteExtension>'), 1);
    assert.match(readTemplate('root/src/providers/permify-access-control-provider.ts'), /evaluateAdditionalAccess/);

    const defaultExtensions = readTemplate('app-extensions.tsx');
    assert.doesNotMatch(defaultExtensions, /federation-learning|runtime-agent|organizationId/i);
});

test('custom application extensions are created only when missing', () => {
    const generatorSource = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');

    assert.match(generatorSource, /if \(!fs\.existsSync\(appExtensionsPath\)\)/);
    assert.match(generatorSource, /templates\/app-extensions\.tsx|app-extensions\.tsx/);
});
