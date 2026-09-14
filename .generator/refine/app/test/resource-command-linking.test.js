const assert = require('node:assert/strict');
const test = require('node:test');

const {buildDomainModel} = require('../domain-model');
const {buildFrontendModel} = require('../model-builder');

test('links producer create commands to catalog read models across aggregate routes', () => {
    const model = {
        domain: 'Demo',
        contexts: [{name: 'CatalogManagement', title: 'Catalog Management'}],
        aggregates: [],
        transitions: [],
        deployments: [{
            name: 'BackOffice',
            title: 'Back Office',
            contexts: ['CatalogManagement']
        }],
        slices: [{
            id: 'slice-register-product',
            context: 'CatalogManagement',
            chapter: 'Catalog Management',
            title: 'Register Product',
            commands: [{
                id: 'command-register-product',
                title: 'Register Product',
                startsLifecycle: true,
                concept: 'Product',
                fields: [
                    {name: 'productId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'productCode', type: 'String'},
                    {name: 'productName', type: 'String'}
                ],
                dependencies: [{
                    id: 'event-product-registered',
                    direction: 'OUTBOUND',
                    title: 'Product Registered',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-product-registered',
                title: 'Product Registered',
                fields: [
                    {name: 'productId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'productCode', type: 'String'},
                    {name: 'productName', type: 'String'}
                ],
                dependencies: [{
                    id: 'command-register-product',
                    direction: 'INBOUND',
                    title: 'Register Product',
                    elementType: 'COMMAND'
                }, {
                    id: 'readmodel-product-catalog',
                    direction: 'OUTBOUND',
                    title: 'Product Catalog',
                    elementType: 'READMODEL'
                }]
            }],
            readmodels: []
        }, {
            id: 'slice-catalogs',
            context: 'CatalogManagement',
            chapter: 'Catalog Management',
            title: 'Catalogs',
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-product-catalog',
                title: 'Product Catalog',
                slice: 'Catalogs',
                listElement: true,
                fields: [
                    {name: 'productId', type: 'UUID', idAttribute: true},
                    {name: 'productCode', type: 'String'},
                    {name: 'productName', type: 'String', display: true}
                ],
                dependencies: [{
                    id: 'event-product-registered',
                    direction: 'INBOUND',
                    title: 'Product Registered',
                    elementType: 'EVENT'
                }]
            }]
        }]
    };

    const frontend = buildFrontendModel(model);
    const productCatalog = frontend.resources.find((resource) => resource.name === 'product_catalog');

    assert.equal(productCatalog?.createCommand?.title, 'Register Product');
    assert.deepEqual(productCatalog?.commands.map((command) => command.title), ['Register Product']);
});

test('projects frontend resources by frontend application without reusing backend deployment granularity', () => {
    const model = {
        domain: 'Demo',
        frontendApplications: [{
            name: 'ParticipantConsole',
            title: 'Participant Console',
            contexts: [
                {name: 'RuntimeAgentOperations', backend: 'RuntimeAgentBackend'},
                {name: 'IdentityAccessManagement', backend: 'RuntimeAgentBackend'}
            ]
        }],
        contexts: [
            {name: 'FederationManagement', title: 'Federation Management'},
            {name: 'RuntimeAgentOperations', title: 'Runtime Agent Operations'},
            {name: 'IdentityAccessManagement', title: 'Identity Access Management'}
        ],
        aggregates: [],
        transitions: [],
        deployments: [{
            name: 'PlatformBackend',
            title: 'Platform Backend',
            contexts: ['FederationManagement', 'IdentityAccessManagement']
        }, {
            name: 'RuntimeAgentBackend',
            title: 'Runtime Agent Backend',
            contexts: ['RuntimeAgentOperations', 'IdentityAccessManagement']
        }],
        slices: [{
            id: 'slice-federation-catalog',
            name: 'FederationCatalogs',
            context: 'FederationManagement',
            chapter: 'Federation Management',
            title: 'Federation Catalogs',
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-federation-catalog',
                title: 'Federation Catalog',
                listElement: true,
                fields: [{name: 'federationId', type: 'UUID', idAttribute: true}]
            }]
        }, {
            id: 'slice-runtime-agent-catalog',
            name: 'RuntimeAgentCatalogs',
            context: 'RuntimeAgentOperations',
            chapter: 'Runtime Agent Operations',
            title: 'Runtime Agent Catalogs',
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-runtime-agent-catalog',
                title: 'Runtime Agent Catalog',
                listElement: true,
                fields: [{name: 'runtimeAgentId', type: 'UUID', idAttribute: true}]
            }]
        }, {
            id: 'slice-role-catalog',
            name: 'RoleCatalogs',
            context: 'IdentityAccessManagement',
            chapter: 'Identity Access Management',
            title: 'Role Catalogs',
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-role-catalog',
                title: 'Role Catalog',
                listElement: true,
                fields: [{name: 'roleId', type: 'UUID', idAttribute: true}]
            }]
        }]
    };

    const frontend = buildFrontendModel(model, undefined, {frontendApp: 'ParticipantConsole'});

    assert.equal(frontend.appName, 'Participant Console');
    assert.deepEqual(frontend.resources.map((resource) => resource.name), ['role_catalog', 'runtime_agent_catalog']);
    assert.deepEqual(frontend.resources.map((resource) => resource.dataProviderName), ['runtime-agent-backend', 'runtime-agent-backend']);
    assert.deepEqual(
        frontend.backendModules.map((module) => ({name: module.name, resources: module.resourceRoutes})),
        [
            {name: 'platform-backend', resources: []},
            {name: 'runtime-agent-backend', resources: ['role-catalog', 'runtime-agent-catalog']}
        ]
    );
    assert.equal(frontend.authBackendModule.name, 'runtime-agent-backend');
});

test('keeps command result fields out of form fields', () => {
    const model = {
        domain: 'Demo',
        contexts: [{name: 'InventoryManagement', title: 'Inventory Management'}],
        aggregates: [],
        transitions: [],
        deployments: [{
            name: 'BackOffice',
            title: 'Back Office',
            contexts: ['InventoryManagement']
        }],
        slices: [{
            id: 'slice-issue-access-code',
            context: 'InventoryManagement',
            chapter: 'Inventory Management',
            title: 'Issue Access Code',
            commands: [{
                id: 'command-issue-access-code',
                title: 'Issue Access Code',
                concept: 'InventoryItem',
                startsLifecycle: true,
                fields: [
                    {name: 'inventoryItemId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'expiresAfterDays', type: 'Int'}
                ],
                resultFields: [
                    {name: 'accessCode', type: 'String', technicalAttribute: true}
                ],
                dependencies: [{
                    id: 'event-access-code-issued',
                    direction: 'OUTBOUND',
                    title: 'Access Code Issued',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-access-code-issued',
                title: 'Access Code Issued',
                fields: [
                    {name: 'inventoryItemId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'accessCodeHash', type: 'String', technicalAttribute: true, portOutput: true}
                ],
                dependencies: [{
                    id: 'command-issue-access-code',
                    direction: 'INBOUND',
                    title: 'Issue Access Code',
                    elementType: 'COMMAND'
                }, {
                    id: 'readmodel-inventory-item-catalog',
                    direction: 'OUTBOUND',
                    title: 'Inventory Item Catalog',
                    elementType: 'READMODEL'
                }]
            }],
            readmodels: [{
                id: 'readmodel-inventory-item-catalog',
                title: 'Inventory Item Catalog',
                slice: 'Issue Access Code',
                listElement: true,
                fields: [
                    {name: 'inventoryItemId', type: 'UUID', idAttribute: true},
                    {name: 'itemName', type: 'String', display: true}
                ],
                dependencies: [{
                    id: 'event-access-code-issued',
                    direction: 'INBOUND',
                    title: 'Access Code Issued',
                    elementType: 'EVENT'
                }]
            }]
        }]
    };

    const frontend = buildFrontendModel(model);
    const resource = frontend.resources.find((item) => [
        item.createCommand,
        item.editCommand,
        item.deleteCommand,
        ...(item.commands ?? [])
    ].some((command) => command?.title === 'Issue Access Code'));
    const command = [
        resource?.createCommand,
        resource?.editCommand,
        resource?.deleteCommand,
        ...(resource?.commands ?? [])
    ].find((item) => item?.title === 'Issue Access Code');

    assert.deepEqual(command?.fields.map((field) => field.name), ['expiresAfterDays']);
    assert.deepEqual(command?.resultFields.map((field) => field.name), ['accessCode']);
});

test('places lifecycle create command on the catalog named by its modeled screen', () => {
    const model = {
        domain: 'Demo',
        contexts: [{name: 'DatasetGovernance', title: 'Dataset Governance'}],
        aggregates: [],
        transitions: [],
        deployments: [{
            name: 'PlatformBackend',
            title: 'Platform Backend',
            contexts: ['DatasetGovernance']
        }],
        slices: [{
            id: 'slice-define-feature-schema',
            name: 'DefineFeatureSchema',
            context: 'DatasetGovernance',
            chapter: 'Dataset Governance',
            title: 'Define Feature Schema',
            screens: [{
                name: 'FeatureSchemaCatalogScreen',
                title: 'Feature Schema Catalog Screen'
            }],
            commands: [{
                id: 'command-define-feature-schema',
                title: 'Define Feature Schema',
                concept: 'FeatureSchema',
                startsLifecycle: true,
                fields: [{name: 'featureSchemaId', type: 'UUID', idAttribute: true, technicalAttribute: true, generated: true}],
                dependencies: [{
                    id: 'event-feature-schema-defined',
                    direction: 'OUTBOUND',
                    title: 'Feature Schema Defined',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-feature-schema-defined',
                title: 'Feature Schema Defined',
                fields: [{name: 'featureSchemaId', type: 'UUID', idAttribute: true, technicalAttribute: true}]
            }],
            readmodels: []
        }, {
            id: 'slice-current-recommended-feature-schema-catalog',
            name: 'CurrentRecommendedFeatureSchemaCatalog',
            context: 'DatasetGovernance',
            chapter: 'Dataset Governance',
            title: 'Current Recommended Feature Schema Catalog',
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-current-recommended-feature-schema-catalog',
                title: 'Current Recommended Feature Schema Catalog',
                listElement: true,
                fields: [{name: 'featureDomain', type: 'String', idAttribute: true}]
            }]
        }, {
            id: 'slice-feature-schema-catalog',
            name: 'FeatureSchemaCatalog',
            context: 'DatasetGovernance',
            chapter: 'Dataset Governance',
            title: 'Feature Schema Catalog',
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-feature-schema-catalog',
                title: 'Feature Schema Catalog',
                listElement: true,
                fields: [{name: 'featureSchemaId', type: 'UUID', idAttribute: true}]
            }]
        }]
    };

    const frontend = buildFrontendModel(model);
    const featureSchemaCatalog = frontend.resources.find((resource) => resource.route === 'feature-schema-catalog');
    const currentRecommendedCatalog = frontend.resources.find((resource) => resource.route === 'current-recommended-feature-schema-catalog');

    assert.equal(featureSchemaCatalog?.createCommand?.name, 'defineFeatureSchema');
    assert.equal(currentRecommendedCatalog?.createCommand, undefined);
});

test('prefills concept selection fields for row commands addressed by technical ids', () => {
    const model = {
        domain: 'Demo',
        contexts: [{name: 'DatasetGovernance', title: 'Dataset Governance'}],
        aggregates: [],
        transitions: [],
        deployments: [{
            name: 'PlatformBackend',
            title: 'Platform Backend',
            contexts: ['DatasetGovernance']
        }],
        slices: [{
            id: 'slice-define-feature-schema',
            name: 'DefineFeatureSchema',
            context: 'DatasetGovernance',
            title: 'Define Feature Schema',
            concepts: ['FeatureSchema'],
            startsLifecycle: true,
            tags: [{name: 'featureDomain'}, {name: 'version'}],
            commands: [{
                id: 'command-define-feature-schema',
                name: 'DefineFeatureSchema',
                title: 'Define Feature Schema',
                concept: 'FeatureSchema',
                startsLifecycle: true,
                fields: [
                    {name: 'featureSchemaId', type: 'UUID', idAttribute: true, technicalAttribute: true, generated: true},
                    {name: 'featureDomain', type: 'String'},
                    {name: 'version', type: 'String'}
                ],
                dependencies: [{
                    id: 'event-feature-schema-defined',
                    direction: 'OUTBOUND',
                    title: 'Feature Schema Defined',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-feature-schema-defined',
                title: 'Feature Schema Defined',
                fields: [
                    {name: 'featureSchemaId', type: 'UUID', idAttribute: true},
                    {name: 'featureDomain', type: 'String'},
                    {name: 'version', type: 'String'}
                ]
            }],
            readmodels: []
        }, {
            id: 'slice-publish-feature-schema',
            name: 'PublishFeatureSchema',
            context: 'DatasetGovernance',
            title: 'Publish Feature Schema',
            concepts: ['FeatureSchema'],
            commands: [{
                id: 'command-publish-feature-schema',
                name: 'PublishFeatureSchema',
                title: 'Publish Feature Schema',
                concept: 'FeatureSchema',
                fields: [
                    {name: 'featureSchemaId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'publishNote', type: 'String', optional: true}
                ],
                dependencies: [{
                    id: 'event-feature-schema-published',
                    direction: 'OUTBOUND',
                    title: 'Feature Schema Published',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-feature-schema-published',
                title: 'Feature Schema Published',
                dependencies: [{
                    id: 'command-publish-feature-schema',
                    direction: 'INBOUND',
                    title: 'Publish Feature Schema',
                    elementType: 'COMMAND'
                }],
                fields: [{name: 'featureSchemaId', type: 'UUID', idAttribute: true}]
            }],
            readmodels: []
        }, {
            id: 'slice-feature-schema-catalog',
            name: 'FeatureSchemaCatalog',
            context: 'DatasetGovernance',
            title: 'Feature Schema Catalog',
            concepts: ['FeatureSchema'],
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-feature-schema-catalog',
                title: 'Feature Schema Catalog',
                listElement: true,
                fields: [
                    {name: 'featureSchemaId', type: 'UUID', idAttribute: true},
                    {name: 'featureDomain', type: 'String'},
                    {name: 'version', type: 'String'}
                ]
            }]
        }]
    };

    const frontend = buildFrontendModel(model);
    const featureSchemaCatalog = frontend.resources.find((resource) => resource.route === 'feature-schema-catalog');
    const publish = featureSchemaCatalog?.itemCommands.find((command) => command.name === 'publishFeatureSchema');

    assert.deepEqual(publish?.rowPrefillFields.map((field) => field.name), ['featureDomain', 'version']);
    assert.deepEqual(publish?.hiddenPrefillFields.map((field) => field.name), ['featureDomain', 'version', 'featureSchemaId']);

    const domain = buildDomainModel(frontend.frontendSource);
    const command = domain.commands.find((item) => item.name === 'PublishFeatureSchema');
    assert.deepEqual(command?.fields.map((field) => field.name), ['featureSchemaId', 'publishNote', 'featureDomain', 'version']);
});

test('links non-lifecycle producer commands as row actions and supports explicit catalog field selects', () => {
    const model = {
        domain: 'Demo',
        contexts: [{name: 'OrderManagement', title: 'Order Management'}],
        aggregates: [],
        transitions: [],
        deployments: [{
            name: 'BackOffice',
            title: 'Back Office',
            contexts: ['OrderManagement']
        }],
        slices: [{
            id: 'slice-open-order',
            context: 'OrderManagement',
            chapter: 'Order Management',
            title: 'Open Order',
            commands: [{
                id: 'command-open-order',
                title: 'Open Order',
                startsLifecycle: true,
                concept: 'Order',
                fields: [
                    {name: 'orderId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'customerName', type: 'String'}
                ],
                dependencies: [{
                    id: 'event-order-opened',
                    direction: 'OUTBOUND',
                    title: 'Order Opened',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-order-opened',
                title: 'Order Opened',
                fields: [
                    {name: 'orderId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'customerName', type: 'String'}
                ],
                dependencies: [{
                    id: 'command-open-order',
                    direction: 'INBOUND',
                    title: 'Open Order',
                    elementType: 'COMMAND'
                }, {
                    id: 'readmodel-order-catalog',
                    direction: 'OUTBOUND',
                    title: 'Order Catalog',
                    elementType: 'READMODEL'
                }]
            }],
            readmodels: []
        }, {
            id: 'slice-add-product-to-order',
            context: 'OrderManagement',
            chapter: 'Order Management',
            title: 'Add Product To Order',
            commands: [{
                id: 'command-add-product-to-order',
                title: 'Add Product To Order',
                concept: 'Order',
                fields: [
                    {name: 'orderId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'productCode', type: 'String', source: {kind: 'direct', from: ['ProductCatalog.productCode']}}
                ],
                dependencies: [{
                    id: 'event-product-added-to-order',
                    direction: 'OUTBOUND',
                    title: 'Product Added To Order',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-product-added-to-order',
                title: 'Product Added To Order',
                fields: [
                    {name: 'orderId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'productCode', type: 'String'}
                ],
                dependencies: [{
                    id: 'command-add-product-to-order',
                    direction: 'INBOUND',
                    title: 'Add Product To Order',
                    elementType: 'COMMAND'
                }, {
                    id: 'readmodel-order-catalog',
                    direction: 'OUTBOUND',
                    title: 'Order Catalog',
                    elementType: 'READMODEL'
                }]
            }],
            readmodels: []
        }, {
            id: 'slice-order-catalogs',
            context: 'OrderManagement',
            chapter: 'Order Management',
            title: 'Order Catalogs',
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-order-catalog',
                title: 'Order Catalog',
                slice: 'Order Catalogs',
                listElement: true,
                fields: [
                    {name: 'orderId', type: 'UUID', idAttribute: true},
                    {name: 'customerName', type: 'String', display: true}
                ],
                dependencies: [{
                    id: 'event-order-opened',
                    direction: 'INBOUND',
                    title: 'Order Opened',
                    elementType: 'EVENT'
                }, {
                    id: 'event-product-added-to-order',
                    direction: 'INBOUND',
                    title: 'Product Added To Order',
                    elementType: 'EVENT'
                }]
            }, {
                id: 'readmodel-product-catalog',
                title: 'Product Catalog',
                slice: 'Order Catalogs',
                listElement: true,
                fields: [
                    {name: 'productId', type: 'UUID', idAttribute: true},
                    {name: 'productCode', type: 'String'},
                    {name: 'productName', type: 'String', display: true}
                ],
                dependencies: []
            }]
        }]
    };

    const frontend = buildFrontendModel(model);
    const orderCatalog = frontend.resources.find((resource) => resource.name === 'order_catalog');
    const command = orderCatalog?.commands.find((item) => item.name === 'addProductToOrder');

    assert.equal(command?.title, 'Add Product To Order');
    assert.deepEqual(command?.fields.map((field) => field.name), ['productCode']);
    assert.equal(command?.fields[0]?.select?.resource, 'product_catalog');
    assert.equal(command?.fields[0]?.select?.optionValue, 'productCode');
    assert.equal(command?.fields[0]?.select?.optionLabel, 'productName');
});

test('uses derived lookup command fields as hidden display snapshots for id selectors', () => {
    const model = {
        domain: 'Demo',
        contexts: [{name: 'OrderManagement', title: 'Order Management'}],
        aggregates: [],
        transitions: [],
        deployments: [{
            name: 'BackOffice',
            title: 'Back Office',
            contexts: ['OrderManagement']
        }],
        slices: [{
            id: 'slice-add-product-to-order',
            context: 'OrderManagement',
            chapter: 'Order Management',
            title: 'Add Product To Order',
            commands: [{
                id: 'command-add-product-to-order',
                title: 'Add Product To Order',
                concept: 'Order',
                fields: [
                    {name: 'orderId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'productId', type: 'UUID'},
                    {
                        name: 'selectedProductName',
                        type: 'String',
                        display: true,
                        source: {
                            kind: 'derived',
                            from: ['ProductCatalog.productName'],
                            lookup: {
                                key: 'productId',
                                sourceField: 'productName',
                                targetField: 'selectedProductName',
                                cacheProjection: 'ProductCatalog',
                                missingValuePolicy: 'keep'
                            }
                        }
                    }
                ],
                dependencies: [{
                    id: 'event-product-added-to-order',
                    direction: 'OUTBOUND',
                    title: 'Product Added To Order',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-product-added-to-order',
                title: 'Product Added To Order',
                fields: [
                    {name: 'orderId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'productId', type: 'UUID'},
                    {name: 'selectedProductName', type: 'String'}
                ],
                dependencies: [{
                    id: 'command-add-product-to-order',
                    direction: 'INBOUND',
                    title: 'Add Product To Order',
                    elementType: 'COMMAND'
                }, {
                    id: 'readmodel-order-catalog',
                    direction: 'OUTBOUND',
                    title: 'Order Catalog',
                    elementType: 'READMODEL'
                }]
            }],
            readmodels: []
        }, {
            id: 'slice-order-catalogs',
            context: 'OrderManagement',
            chapter: 'Order Management',
            title: 'Order Catalogs',
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-order-catalog',
                title: 'Order Catalog',
                listElement: true,
                fields: [
                    {name: 'orderId', type: 'UUID', idAttribute: true},
                    {name: 'customerName', type: 'String', display: true}
                ],
                dependencies: [{
                    id: 'event-product-added-to-order',
                    direction: 'INBOUND',
                    title: 'Product Added To Order',
                    elementType: 'EVENT'
                }]
            }, {
                id: 'readmodel-product-catalog',
                title: 'Product Catalog',
                listElement: true,
                fields: [
                    {name: 'productId', type: 'UUID', idAttribute: true},
                    {name: 'productCode', type: 'String'},
                    {name: 'productName', type: 'String', display: true}
                ],
                dependencies: []
            }]
        }]
    };

    const frontend = buildFrontendModel(model);
    const orderCatalog = frontend.resources.find((resource) => resource.name === 'order_catalog');
    const command = orderCatalog?.commands.find((item) => item.name === 'addProductToOrder');

    assert.deepEqual(command?.fields.map((field) => field.name), ['productId']);
    assert.deepEqual(command?.snapshotFields.map((field) => field.name), ['selectedProductName']);
    assert.deepEqual(command?.defaultValueEntries.map((field) => field.name), ['orderId', 'selectedProductName']);
    assert.equal(command?.fields[0]?.select?.resource, 'product_catalog');
    assert.equal(command?.fields[0]?.select?.optionValue, 'productId');
    assert.equal(command?.fields[0]?.select?.optionLabel, 'productName');
    assert.deepEqual(command?.fields[0]?.select?.snapshots, [{
        fieldName: 'selectedProductName',
        sourceField: 'productName',
        keyField: 'productId',
        display: true
    }]);
});

test('keeps derived fields out of editable command fields without a selectable projection', () => {
    const model = {
        domain: 'Demo',
        contexts: [{name: 'AgentOperations', title: 'Agent Operations'}],
        aggregates: [],
        transitions: [],
        deployments: [{
            name: 'Agent',
            title: 'Agent',
            contexts: ['AgentOperations']
        }],
        frontendApplications: [{
            name: 'AgentConsole',
            title: 'Agent Console',
            contexts: [{name: 'AgentOperations', backend: 'Agent'}]
        }],
        slices: [{
            id: 'slice-declare-dataset',
            context: 'AgentOperations',
            chapter: 'Agent Operations',
            title: 'Declare Dataset',
            commands: [{
                id: 'command-declare-dataset',
                title: 'Declare Dataset',
                startsLifecycle: true,
                concept: 'Dataset',
                fields: [
                    {name: 'datasetId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'featureSchemaId', type: 'UUID'},
                    {
                        name: 'featureDomain',
                        type: 'String',
                        optional: true,
                        source: {
                            kind: 'derived',
                            from: ['PlatformFeatureSchemaCatalog.featureDomain'],
                            lookup: {
                                key: 'featureSchemaId',
                                cacheProjection: 'PlatformFeatureSchemaCatalog',
                                sourceField: 'featureDomain',
                                targetField: 'featureDomain',
                                missingValuePolicy: 'keep'
                            }
                        }
                    }
                ],
                dependencies: [{
                    id: 'event-dataset-declared',
                    direction: 'OUTBOUND',
                    title: 'Dataset Declared',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-dataset-declared',
                title: 'Dataset Declared',
                fields: [
                    {name: 'datasetId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'featureSchemaId', type: 'UUID'},
                    {name: 'featureDomain', type: 'String', optional: true}
                ],
                dependencies: [{
                    id: 'command-declare-dataset',
                    direction: 'INBOUND',
                    title: 'Declare Dataset',
                    elementType: 'COMMAND'
                }, {
                    id: 'readmodel-dataset-capability',
                    direction: 'OUTBOUND',
                    title: 'Dataset Capability',
                    elementType: 'READMODEL'
                }]
            }],
            readmodels: []
        }, {
            id: 'slice-dataset-capability',
            context: 'AgentOperations',
            chapter: 'Agent Operations',
            title: 'Dataset Capability',
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-dataset-capability',
                title: 'Dataset Capability',
                listElement: true,
                fields: [
                    {name: 'datasetId', type: 'UUID', idAttribute: true},
                    {name: 'datasetName', type: 'String', display: true}
                ],
                dependencies: [{
                    id: 'event-dataset-declared',
                    direction: 'INBOUND',
                    title: 'Dataset Declared',
                    elementType: 'EVENT'
                }]
            }]
        }]
    };

    const frontend = buildFrontendModel(model, undefined, {frontendApp: 'AgentConsole'});
    const datasetCapability = frontend.resources.find((resource) => resource.name === 'dataset_capability');
    const command = datasetCapability?.commands.find((item) => item.name === 'declareDataset');

    assert.deepEqual(command?.fields.map((field) => field.name), ['featureSchemaId']);
    assert.deepEqual(command?.snapshotFields.map((field) => field.name), ['featureDomain']);
    assert.deepEqual(command?.defaultValueEntries.map((field) => field.name), ['datasetId', 'featureDomain']);
});

test('uses sync read models as local selectors for shadow-side commands', () => {
    const model = {
        domain: 'Demo',
        contexts: [{name: 'AgentOperations', title: 'Agent Operations'}],
        aggregates: [],
        transitions: [],
        deployments: [{
            name: 'Agent',
            title: 'Agent',
            contexts: ['AgentOperations']
        }],
        frontendApplications: [{
            name: 'AgentConsole',
            title: 'Agent Console',
            contexts: [{name: 'AgentOperations', backend: 'Agent'}]
        }],
        slices: [{
            id: 'slice-declare-dataset',
            context: 'AgentOperations',
            chapter: 'Agent Operations',
            title: 'Declare Dataset',
            commands: [{
                id: 'command-declare-dataset',
                title: 'Declare Dataset',
                startsLifecycle: true,
                concept: 'Dataset',
                fields: [
                    {name: 'datasetId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {
                        name: 'organizationId',
                        type: 'UUID',
                        source: {kind: 'direct', from: ['AgentOrganizationDirectory.organizationId']}
                    },
                    {
                        name: 'organizationName',
                        type: 'String',
                        optional: true,
                        source: {
                            kind: 'derived',
                            from: ['AgentOrganizationDirectory.organizationName'],
                            lookup: {
                                key: 'organizationId',
                                cacheProjection: 'AgentOrganizationDirectory',
                                sourceField: 'organizationName',
                                targetField: 'organizationName',
                                missingValuePolicy: 'keep'
                            }
                        }
                    },
                    {
                        name: 'featureSchemaId',
                        type: 'UUID',
                        source: {kind: 'direct', from: ['AgentFeatureSchemaCatalog.featureSchemaId']}
                    },
                    {
                        name: 'featureSchemaVersion',
                        type: 'String',
                        optional: true,
                        source: {
                            kind: 'derived',
                            from: ['AgentFeatureSchemaCatalog.featureSchemaVersion'],
                            lookup: {
                                key: 'featureSchemaId',
                                cacheProjection: 'AgentFeatureSchemaCatalog',
                                sourceField: 'featureSchemaVersion',
                                targetField: 'featureSchemaVersion',
                                missingValuePolicy: 'keep'
                            }
                        }
                    }
                ],
                dependencies: [{
                    id: 'event-dataset-declared',
                    direction: 'OUTBOUND',
                    title: 'Dataset Declared',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-dataset-declared',
                title: 'Dataset Declared',
                fields: [
                    {name: 'datasetId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'organizationId', type: 'UUID'},
                    {name: 'organizationName', type: 'String', optional: true},
                    {name: 'featureSchemaId', type: 'UUID'},
                    {name: 'featureSchemaVersion', type: 'String', optional: true}
                ],
                dependencies: [{
                    id: 'command-declare-dataset',
                    direction: 'INBOUND',
                    title: 'Declare Dataset',
                    elementType: 'COMMAND'
                }, {
                    id: 'readmodel-dataset-capability',
                    direction: 'OUTBOUND',
                    title: 'Dataset Capability',
                    elementType: 'READMODEL'
                }]
            }],
            readmodels: []
        }, {
            id: 'slice-agent-directories',
            context: 'AgentOperations',
            chapter: 'Agent Operations',
            title: 'Agent Directories',
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-agent-organization-directory',
                title: 'Agent Organization Directory',
                listElement: true,
                sync: true,
                syncSource: 'OrganizationManagement.OrganizationDirectory',
                fields: [
                    {name: 'organizationId', type: 'UUID', idAttribute: true},
                    {name: 'organizationName', type: 'String', display: true}
                ],
                dependencies: []
            }, {
                id: 'readmodel-agent-feature-schema-catalog',
                title: 'Agent Feature Schema Catalog',
                listElement: true,
                sync: true,
                syncSource: 'DatasetGovernance.FeatureSchemaCatalog',
                fields: [
                    {name: 'featureSchemaId', type: 'UUID', idAttribute: true},
                    {name: 'featureDomain', type: 'String', display: true},
                    {name: 'featureSchemaVersion', type: 'String'}
                ],
                dependencies: []
            }, {
                id: 'readmodel-dataset-capability',
                title: 'Dataset Capability',
                listElement: true,
                fields: [
                    {name: 'datasetId', type: 'UUID', idAttribute: true},
                    {name: 'datasetName', type: 'String', display: true}
                ],
                dependencies: [{
                    id: 'event-dataset-declared',
                    direction: 'INBOUND',
                    title: 'Dataset Declared',
                    elementType: 'EVENT'
                }]
            }]
        }]
    };

    const frontend = buildFrontendModel(model, undefined, {frontendApp: 'AgentConsole'});
    const datasetCapability = frontend.resources.find((resource) => resource.name === 'dataset_capability');
    const command = datasetCapability?.commands.find((item) => item.name === 'declareDataset');

    assert.deepEqual(command?.fields.map((field) => field.name), ['organizationId', 'featureSchemaId']);
    assert.equal(command?.fields[0]?.select?.resource, 'agent_organization_directory');
    assert.equal(command?.fields[0]?.select?.optionValue, 'organizationId');
    assert.equal(command?.fields[0]?.select?.optionLabel, 'organizationName');
    assert.equal(command?.fields[1]?.select?.resource, 'agent_feature_schema_catalog');
    assert.equal(command?.fields[1]?.select?.optionValue, 'featureSchemaId');
    assert.equal(command?.fields[1]?.select?.optionLabel, 'featureDomain');
    assert.deepEqual(command?.snapshotFields.map((field) => field.name), ['organizationName', 'featureSchemaVersion']);
});

test('prefers command owner catalog over relation projection catalog for row actions', () => {
    const model = {
        domain: 'Demo',
        contexts: [{name: 'AccessManagement', title: 'Access Management'}],
        aggregates: [],
        transitions: [{
            id: 'transition-link-role-to-account',
            context: 'AccessManagement',
            owner: {name: 'Account', title: 'Account'},
            command: {id: 'command-link-role-to-account', name: 'LinkRoleToAccount', title: 'Link Role To Account'},
            event: {id: 'event-role-linked-to-account', name: 'RoleLinkedToAccount', title: 'Role Linked To Account'},
            to: 'Active',
            startsLifecycle: false
        }],
        deployments: [{
            name: 'BackOffice',
            title: 'Back Office',
            contexts: ['AccessManagement']
        }],
        slices: [{
            id: 'slice-link-role-to-account',
            context: 'AccessManagement',
            chapter: 'Access Management',
            title: 'Link Role To Account',
            commands: [{
                id: 'command-link-role-to-account',
                title: 'Link Role To Account',
                fields: [
                    {name: 'accountId', type: 'UUID', idAttribute: true, source: {kind: 'direct', from: ['AccountCatalog.accountId']}},
                    {name: 'roleCodes', type: 'String[]', source: {kind: 'direct', from: ['RoleCatalog.roleCode']}}
                ],
                dependencies: [{
                    id: 'event-role-linked-to-account',
                    direction: 'OUTBOUND',
                    title: 'Role Linked To Account',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-role-linked-to-account',
                title: 'Role Linked To Account',
                fields: [
                    {name: 'accountId', type: 'UUID', idAttribute: true},
                    {name: 'roleCodes', type: 'String[]'}
                ],
                dependencies: [{
                    id: 'command-link-role-to-account',
                    direction: 'INBOUND',
                    title: 'Link Role To Account',
                    elementType: 'COMMAND'
                }, {
                    id: 'readmodel-account-role-catalog',
                    direction: 'OUTBOUND',
                    title: 'Account Role Catalog',
                    elementType: 'READMODEL'
                }]
            }],
            readmodels: []
        }, {
            id: 'slice-account-catalogs',
            context: 'AccessManagement',
            chapter: 'Access Management',
            title: 'Account Catalogs',
            concepts: ['Account'],
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-account-catalog',
                title: 'Account Catalog',
                slice: 'Account Catalogs',
                listElement: true,
                fields: [
                    {name: 'accountId', type: 'UUID', idAttribute: true},
                    {name: 'accountName', type: 'String', display: true}
                ],
                dependencies: []
            }]
        }, {
            id: 'slice-account-role-catalog',
            context: 'AccessManagement',
            chapter: 'Access Management',
            title: 'Account Role Catalog',
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-account-role-catalog',
                title: 'Account Role Catalog',
                slice: 'Account Role Catalog',
                listElement: true,
                fields: [
                    {name: 'accountId', type: 'UUID', idAttribute: true},
                    {name: 'roleCodes', type: 'String[]'}
                ],
                dependencies: [{
                    id: 'event-role-linked-to-account',
                    direction: 'INBOUND',
                    title: 'Role Linked To Account',
                    elementType: 'EVENT'
                }]
            }, {
                id: 'readmodel-role-catalog',
                title: 'Role Catalog',
                slice: 'Account Role Catalog',
                listElement: true,
                fields: [
                    {name: 'roleId', type: 'UUID', idAttribute: true},
                    {name: 'roleCode', type: 'String'},
                    {name: 'roleName', type: 'String', display: true}
                ],
                dependencies: []
            }]
        }]
    };

    const frontend = buildFrontendModel(model);
    const accountCatalog = frontend.resources.find((resource) => resource.name === 'account_catalog');
    const accountRoleCatalog = frontend.resources.find((resource) => resource.name === 'account_role_catalog');
    const command = accountCatalog?.itemCommands.find((item) => item.name === 'linkRoleToAccount');

    assert.equal(command?.title, 'Link Role To Account');
    assert.deepEqual(accountRoleCatalog?.itemCommands.map((item) => item.name), []);
    assert.equal(command?.fields.find((field) => field.name === 'roleCodes')?.select?.resource, 'role_catalog');
});
