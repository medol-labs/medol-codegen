const assert = require('node:assert/strict');
const test = require('node:test');

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
