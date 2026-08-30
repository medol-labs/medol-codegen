const assert = require('node:assert/strict');
const test = require('node:test');

const {readModelWriterMethods} = require('../read-model-writer');

test('appends singular event fields into plural read model fields', () => {
    const event = {
        id: 'role-assigned',
        name: 'RoleAssignedToUser',
        title: 'Role Assigned To User',
        fields: [
            {name: 'userAccountId', type: 'UUID'},
            {name: 'roleCode', type: 'String'}
        ]
    };
    const readmodel = {
        fields: [
            {name: 'userAccountId', type: 'UUID'},
            {name: 'roleCodes', type: 'String', cardinality: 'Multiple'}
        ]
    };
    const writer = {
        model: {
            slices: [{events: [event]}],
            transitions: []
        }
    };

    const assignments = readModelWriterMethods
        ._readModelConventionalAssignments.call(writer, readmodel, event, new Set(['userAccountId']));

    assert.deepEqual(assignments, [{
        fieldName: 'roleCodes',
        code: 'entity.roleCodes = (entity.roleCodes + event.roleCode).distinct()',
        usesEventTime: false
    }]);
});

test('maps lifecycle state changes onto boolean read model fields', () => {
    const registered = {
        id: 'registered',
        name: 'UserAccountRegistered',
        title: 'User Account Registered',
        fields: [{name: 'userAccountId', type: 'UUID'}]
    };
    const deactivated = {
        id: 'deactivated',
        name: 'UserAccountDeactivated',
        title: 'User Account Deactivated',
        fields: [{name: 'userAccountId', type: 'UUID'}]
    };
    const readmodel = {
        fields: [
            {name: 'userAccountId', type: 'UUID'},
            {name: 'active', type: 'Boolean'}
        ]
    };
    const writer = {
        model: {
            slices: [
                {events: [registered], stateChange: {eventId: 'registered', to: 'Active'}},
                {events: [deactivated], stateChange: {eventId: 'deactivated', to: 'Deactivated'}}
            ],
            transitions: [
                {event: {id: 'registered'}, from: undefined, to: 'Active'},
                {event: {id: 'deactivated'}, from: 'Active', to: 'Deactivated'}
            ]
        }
    };

    const registeredAssignments = readModelWriterMethods
        ._readModelConventionalAssignments.call(writer, readmodel, registered, new Set(['userAccountId']));
    const deactivatedAssignments = readModelWriterMethods
        ._readModelConventionalAssignments.call(writer, readmodel, deactivated, new Set(['userAccountId']));

    assert.equal(registeredAssignments.find((assignment) => assignment.fieldName === 'active')?.code, 'entity.active = true');
    assert.equal(deactivatedAssignments.find((assignment) => assignment.fieldName === 'active')?.code, 'entity.active = false');
});
