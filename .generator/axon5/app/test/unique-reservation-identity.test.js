const assert = require('node:assert/strict');
const test = require('node:test');
const {reservationForUniqueExpression} = require('../model-helpers');

test('a unique tuple containing the aggregate ID emits each event field and argument once', () => {
    const fields = [
        {name: 'parentId', type: 'UUID', idAttribute: true},
        {name: 'memberId', type: 'UUID'},
    ];
    const reservation = reservationForUniqueExpression(
        {context: 'Memberships', concepts: ['Membership']},
        {rootPackage: 'sample'},
        {fields}, fields, [fields[0]],
        {concept: 'Membership', fields: ['parentId', 'memberId']},
    );
    const names = [...reservation.idFields, ...reservation.originalFields, ...reservation.normalizedFields]
        .map((field) => field.name);
    assert.deepEqual(names, ['parentId', 'memberId', 'normalizedParentId', 'normalizedMemberId']);
    assert.equal(reservation.eventArgs.filter((value) => value.startsWith('parentId =')).length, 1);
    assert.equal(reservation.selectionFields.length, 2);
});
