const assert = require('node:assert/strict');
const test = require('node:test');

const {decorateField} = require('../model-utils');

test('renders Text fields as copyable long text without changing String fields', () => {
    const textField = decorateField({name: 'configuration', label: 'Configuration', type: 'Text'});
    const stringField = decorateField({name: 'name', label: 'Name', type: 'String'});

    assert.equal(textField.longText, true);
    assert.equal(textField.cellValue, '<CopyableText value={getValue()} compact />');
    assert.equal(stringField.longText, false);
    assert.equal(stringField.cellValue, 'String(getValue() ?? "-")');
});
