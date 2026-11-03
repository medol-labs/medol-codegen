const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');
const {domainBranding} = require('../branding');

test('derives uppercase initials from domain words, not the frontend title', () => {
    for (const name of ['FederationLearningPlatform', 'federation-learning-platform', 'Federation Learning Platform', 'federation_learning_platform']) {
        assert.equal(domainBranding({domain: name}, {name: 'OperationsConsole', title: 'Fixed Title'}).initials, 'FLP');
    }
    assert.equal(domainBranding({domain: 'HTTPGatewayService'}).initials, 'HGS');
    assert.equal(domainBranding({domain: 'Medol'}).initials, 'M');
});

test('uses the selected frontend domain for multi-domain projects', () => {
    const source = {domain: 'Orders', domains: [{name: 'Orders'}, {name: 'SampleTracking'}]};
    assert.equal(domainBranding(source, {name: 'LabConsole', domain: 'SampleTracking'}).initials, 'ST');
    assert.equal(domainBranding(source, {name: 'OrderConsole', domain: 'Orders'}).initials, 'O');
    assert.equal(domainBranding({domains: [{name: 'CustomerSupport'}]}).initials, 'CS');
});

test('handles legacy models, Unicode names and long initials without a fixed brand', () => {
    assert.equal(domainBranding({}, {name: 'LocalConsole'}).initials, 'LC');
    assert.equal(domainBranding({}).initials, 'A');
    assert.equal(domainBranding({domain: '设备 管理'}).initials, '设管');
    const brand = domainBranding({domain: 'One Two Three Four Five Six Seven Eight Nine Ten'});
    assert.equal(brand.initials, 'OTTFFSSENT');
    const size = Number(brand.icon.match(/font-size="([\d.]+)"/)[1]);
    assert.ok(size < 5);
    assert.match(brand.icon, /fill="#24684b"/);
    assert.match(brand.icon, /letter-spacing="0"/);
});

test('renders safe domain-derived branding into HTML, React and the same SVG asset', () => {
    const brand = domainBranding({domain: 'Orders <script>alert(1)</script> "Support"'});
    const data = {
        appTitle: brand.initials,
        appTitleLiteral: JSON.stringify(brand.initials),
        domainTitle: brand.title,
        domainTitleLiteral: JSON.stringify(brand.title),
        brandIconSvg: brand.icon,
        backendModules: [], authBackendModule: {name: 'default'}, tenancyEnabled: false
    };
    const root = path.resolve(__dirname, '../templates/root');
    const render = (file) => ejs.render(fs.readFileSync(path.join(root, file), 'utf8'), data);
    const html = render('index.html');
    const app = render('src/App.tsx');
    const icon = render('public/domain-icon.svg');
    assert.ok(html.includes(`<title>${brand.initials}</title>`));
    assert.match(html, /%BASE_URL%domain-icon.svg/);
    assert.doesNotMatch(html, /refine_social|medol-logo|<script>alert/);
    assert.match(app, /BASE_URL}domain-icon.svg/);
    assert.ok(app.includes(`DocumentTitleHandler handler={() => ${JSON.stringify(brand.initials)}}`));
    assert.equal(icon.trim(), brand.icon.trim());
    assert.doesNotMatch(icon, /<script|\bonload=/);
});

test('skeleton copy excludes old fixed image and favicon templates', async () => {
    const {create: createStore} = await import('mem-fs');
    const {create: createEditor} = await import('mem-fs-editor');
    const editor = createEditor(createStore());
    const brand = domainBranding({domain: 'InventoryManagement'});
    const root = path.resolve(__dirname, '../templates/root');
    const target = path.resolve('/private/tmp/medol-branding-test-output');
    editor.copyTpl(root, target, {
        appName: 'InventoryConsole', appTitle: brand.initials, appTitleLiteral: JSON.stringify(brand.initials),
        domainTitle: brand.title, domainTitleLiteral: JSON.stringify(brand.title), brandIconSvg: brand.icon,
        imageName: 'inventory-console', imageTarName: 'inventory-console-images.tar',
        backendModules: [], authBackendModule: {name: 'default'}, tenancyEnabled: false
    }, {}, {globOptions: {ignore: ['**/public/medol-logo.png', '**/public/favicon.ico']}});
    assert.equal(editor.exists(path.join(target, 'public/medol-logo.png')), false);
    assert.equal(editor.exists(path.join(target, 'public/favicon.ico')), false);
    assert.match(editor.read(path.join(target, 'public/domain-icon.svg')), />IM<\/text>/);
});
