const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');
const {buildFrontendModel} = require('../model-builder');

test('explicit technical references can be selected on create and prefilled from a parent row', () => {
    const command = {
        id: 'invite-member', name: 'InviteMember', title: 'Invite Member',
        concept: 'Membership', startsLifecycle: true,
        fields: [
            {
                name: 'teamId', type: 'UUID', idAttribute: true, technicalAttribute: true,
                source: {kind: 'direct', from: ['TeamCatalog.teamId']}
            },
            {
                name: 'teamName', type: 'String', optional: true,
                source: {
                    kind: 'derived', from: ['TeamCatalog.teamName'],
                    lookup: {key: 'teamId', sourceField: 'teamName', targetField: 'teamName', cacheProjection: 'TeamCatalog'}
                }
            },
            {name: 'memberId', type: 'UUID'},
            {name: 'internalToken', type: 'String', technicalAttribute: true},
            {name: 'invitationId', type: 'UUID', technicalAttribute: true, generated: true}
        ],
        dependencies: [
            {id: 'invited', direction: 'OUTBOUND', elementType: 'EVENT'},
            {id: 'created', direction: 'INBOUND', elementType: 'EVENT'}
        ]
    };
    const model = {
        domain: 'Demo', contexts: [{name: 'Teams', title: 'Teams'}], aggregates: [], transitions: [],
        deployments: [{name: 'Backend', contexts: ['Teams']}],
        slices: [{
            id: 'invite', context: 'Teams', title: 'Invite Member',
            commands: [command],
            events: [{
                id: 'invited', title: 'Member Invited',
                dependencies: [
                    {id: 'invite-member', direction: 'INBOUND', elementType: 'COMMAND'},
                    {id: 'memberships', direction: 'OUTBOUND', elementType: 'READMODEL'}
                ]
            }, {
                id: 'created', title: 'Team Created',
                dependencies: [{id: 'invite-member', direction: 'OUTBOUND', elementType: 'COMMAND'}]
            }], readmodels: []
        }, {
            id: 'catalogs', context: 'Teams', title: 'Catalogs', commands: [], events: [],
            readmodels: [{
                id: 'teams', name: 'TeamCatalog', title: 'Team Catalog', listElement: true,
                fields: [{name: 'teamId', type: 'UUID', idAttribute: true}, {name: 'teamName', type: 'String', display: true}],
                dependencies: [{id: 'created', direction: 'INBOUND', elementType: 'EVENT'}]
            }, {
                id: 'memberships', title: 'Membership Directory', listElement: true,
                fields: [{name: 'teamId', type: 'UUID', idAttribute: true}, {name: 'memberId', type: 'UUID', idAttribute: true}],
                dependencies: [{id: 'invited', direction: 'INBOUND', elementType: 'EVENT'}]
            }]
        }]
    };
    const frontend = buildFrontendModel(model);
    const membership = frontend.resources.find(resource => resource.name === 'membership_directory');
    const team = frontend.resources.find(resource => resource.name === 'team_catalog');
    assert.equal(membership.createCommand.name, 'inviteMember');
    const rowCommand = team.itemCommands.find(item => item.name === 'inviteMember');
    assert.ok(rowCommand);
    assert.ok(rowCommand.rowPrefillFields.some(field => field.name === 'teamId'));

    const template = fs.readFileSync(path.join(__dirname, '../templates/src/pages/command-form.tsx.tpl'), 'utf8');
    for (const [resource, action] of [[membership, membership.createCommand], [team, rowCommand]]) {
        const reference = action.fields.find(field => field.name === 'teamId');
        assert.equal(reference.select.resource, 'team_catalog');
        assert.equal(reference.select.optionLabel, 'teamName');
        assert.equal(reference.selectWhenUnbound, true);
        assert.ok(reference.select.snapshots.some(snapshot => snapshot.fieldName === 'teamName'));
        assert.ok(action.defaultValueEntries.some(field => field.name === 'teamId'));
        assert.ok(!action.hiddenPrefillFields.some(field => field.name === 'teamId'));
        assert.ok(!action.fields.some(field => ['internalToken', 'invitationId', 'teamName'].includes(field.name)));
        const rendered = ejs.render(template, {resource, command: action});
        assert.match(rendered, /defaultValues\.teamId !== undefined.*defaultValues\.teamId !== "" \? \(/);
        assert.match(rendered, /type="hidden".*form\.register\("teamId"/);
        assert.match(rendered, /name="teamId"[\s\S]*resource="team_catalog"/);
        assert.match(rendered, /"teamName" as never/);
    }
});
