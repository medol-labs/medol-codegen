const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

function command(name, startsLifecycle) {
    return {name, route: name, label: name, startsLifecycle, requiresPage: true, pageComponent: name};
}

function resource(route, createCommand, itemCommands) {
    return {
        name: route, route, label: route, component: route, pagePath: route,
        createCommand, commands: [createCommand, ...itemCommands].filter(Boolean),
        routedCommands: itemCommands,
    };
}

test('command links use resource placement, including lifecycle commands invoked from a parent row', () => {
    const createParent = command('create-parent', true);
    const createChild = command('create-child', true);
    const updateParent = command('update-parent', false);
    const resources = [
        resource('parents', createParent, [createChild, updateParent]),
        resource('children', createChild, []),
        resource('related', undefined, [createChild]),
    ];
    const locals = {resources, backendModules: [], chapters: [], authBackendModule: {}, fileUploadCapability: null};
    const render = (name) => ejs.render(fs.readFileSync(path.join(__dirname, '../templates/src/providers', name), 'utf8'), locals);
    const metadata = render('resources.tsx.tpl');
    const router = render('app-router.tsx.tpl');
    const registered = new Set();
    for (const [, route, body] of router.matchAll(/<Route path="\/([^"]+)">([\s\S]*?)<\/Route>/g)) {
        for (const [, child] of body.matchAll(/<Route path="([^"]+)"/g)) {
            registered.add(`/${route}/${child}`);
        }
    }
    const links = [...metadata.matchAll(/route: "([^"]+\/command\/[^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(links, [
        '/parents/command/create-parent',
        '/parents/:id/command/create-child',
        '/parents/:id/command/update-parent',
        '/children/command/create-child',
        '/related/:id/command/create-child',
    ]);
    for (const link of links) {
        assert.ok(registered.has(link), `Command link has no matching route: ${link}`);
    }
});
