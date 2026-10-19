const test = require('node:test');
const assert = require('node:assert/strict');
const {parseAssertion, renderCommandAssertions} = require('../command-assertions');
const {configureValueTypes} = require('../../../common/util/value-types');

test('assertion parsing preserves quoted operators and rejects trailing executable text', () => {
    assert.deepEqual(parseAssertion('assert Check.label == "a>b"'), ['Check.label', '==', '"a>b"']);
    assert.throws(() => parseAssertion('assert Check.value > 0; dangerous()'), /Unsupported assertion/);
    const code = renderCommandAssertions({rootPackage: 'sample'}, {specifications: [{expressions: ['assert Check.label == "$literal"']}]}, {name: 'Check', fields: [{name: 'label', type: 'String'}]});
    assert.ok(code.includes('command.label == "\\$literal"'));
});

test('command assertions are executable for primitive numbers, scalar numbers and optional values', () => {
    configureValueTypes([{name: 'Quantity', kind: 'scalar', baseType: 'Decimal'}]);
    try {
        const command = {name: 'Check', fields: [{name: 'version', type: 'Int'}, {name: 'quantity', type: 'Quantity', optional: true}]};
        const code = renderCommandAssertions({rootPackage: 'sample'}, {specifications: [{expressions: ['assert Check.version >= 1', 'assert Check.quantity > 0']}]}, command);
        assert.match(code, /BigDecimal\(command.version.toString\(\)\).compareTo\(java.math.BigDecimal\("1"\)\) >= 0/);
        assert.match(code, /command.quantity\?\.value != null &&/);
        assert.match(code, /COMMAND_ASSERTION_FAILED/);
        assert.equal((code.match(/throw sample.shared.domain.CommandRejectedException/g) ?? []).length, 2);
        assert.throws(() => renderCommandAssertions({}, {specifications: [{expressions: ['assert Other.value > 0']}]}, command), /external operand/);
    } finally { configureValueTypes([]); }
});
