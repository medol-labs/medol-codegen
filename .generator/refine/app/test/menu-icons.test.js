const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const templates = path.resolve(__dirname, '../templates');

test('generated resources delegate menu icons to a stable extension', () => {
    const resourcesTemplate = fs.readFileSync(
        path.join(templates, 'src/providers/resources.tsx.tpl'),
        'utf8',
    );
    const sidebar = fs.readFileSync(
        path.join(templates, 'root/src/components/refine-ui/layout/sidebar.tsx'),
        'utf8',
    );

    assert.match(resourcesTemplate, /resolveMenuIcon/);
    assert.match(resourcesTemplate, /from "@\/domain\/menu-icons"/);
    assert.match(resourcesTemplate, /type: "chapter"/);
    assert.match(resourcesTemplate, /type: "resource"/);
    assert.match(sidebar, /resolveMenuIcon/);
    assert.match(sidebar, /from "@\/domain\/menu-icons"/);
});

test('menu icon extension is created only when missing', () => {
    const generatorSource = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
    const defaultExtension = fs.readFileSync(path.join(templates, 'menu-icons.tsx'), 'utf8');

    assert.match(generatorSource, /if \(!fs\.existsSync\(menuIconsPath\)\)/);
    assert.match(generatorSource, /templatePath\('menu-icons\.tsx'\)/);
    assert.match(defaultExtension, /return fallback/);
});
