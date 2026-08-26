const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadGeneratorModel } = require('../../../common/core/config-loader');
const { buildFrontendModel } = require('../model-builder');

test('loads locale-specific model translations without replacing existing codegen translations', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'refine-i18n-'));
    try {
        fs.writeFileSync(
            path.join(workspace, 'codegen-model.json'),
            JSON.stringify({
                rootPackage: 'tech.medo',
                domain: 'Demo',
                locales: ['zh-CN'],
                defaultLocale: 'zh-CN',
                translations: {
                    'zh-CN': {
                        'Order Catalog': '订单目录'
                    }
                },
                contexts: [{
                    name: 'Sales',
                    title: 'Sales',
                    notes: [],
                    risks: [],
                    decisions: [],
                    metrics: [],
                    valueTypes: [],
                    aggregates: [],
                    concepts: [],
                    externalSystems: []
                }],
                valueTypes: [],
                aggregates: [],
                concepts: [],
                transitions: [],
                actors: [],
                slices: [{
                    context: 'Sales',
                    chapter: 'Sales',
                    title: 'Order Catalog',
                    aggregate: 'Order',
                    commands: [],
                    events: [],
                    readmodels: [{
                        title: 'Order Catalog',
                        name: 'OrderCatalog',
                        listElement: true,
                        fields: [{
                            name: 'orderId',
                            type: 'UUID'
                        }]
                    }],
                    screens: [],
                    processors: [],
                    specifications: [],
                    hotspots: []
                }]
            }, null, 2)
        );
        fs.writeFileSync(
            path.join(workspace, 'model-translations.zh-CN.json'),
            JSON.stringify({
                locales: ['zh-CN'],
                defaultLocale: 'zh-CN',
                translations: {
                    'zh-CN': {
                        'Order Catalog': '旧订单目录',
                        'Order Id': '订单ID'
                    }
                }
            }, null, 2)
        );

        const loaded = loadGeneratorModel(workspace);
        const frontendModel = buildFrontendModel(loaded.codegenModel);
        const messages = frontendModel.i18n.messages['zh-CN'];

        assert.equal(messages['resources.order_catalog.label'], '订单目录');
        assert.equal(messages['resources.order_catalog.fields.orderId.label'], '订单ID');
        assert.equal(messages['breadcrumb.actions.create'], '创建');
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});
