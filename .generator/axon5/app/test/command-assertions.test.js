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

test('decimal literals are not interpreted as external command references', () => {
    const command = {name: 'Check', fields: [{name: 'score', type: 'Decimal'}]};
    for (const [expression, comparison] of [
        ['assert Check.score < 0.95', 'BigDecimal(command.score.toString()).compareTo(java.math.BigDecimal("0.95")) < 0'],
        ['assert 0.95 > Check.score', 'BigDecimal("0.95").compareTo(java.math.BigDecimal(command.score.toString())) > 0'],
        ['assert Check.score >= -0.25', 'BigDecimal(command.score.toString()).compareTo(java.math.BigDecimal("-0.25")) >= 0']
    ]) {
        const code = renderCommandAssertions({rootPackage: 'sample'}, {specifications: [{expressions: [expression]}]}, command);
        assert.ok(code.includes(comparison), code);
    }
    const slice = {
        commands: [command, {name: 'Other'}],
        specifications: [{expressions: ['assert Other.score < 0.95']}]
    };
    assert.equal(renderCommandAssertions({}, slice, command), '');
    slice.specifications[0].expressions = ['assert Check.score < Other.score'];
    assert.throws(() => renderCommandAssertions({}, slice, command), /external operand/);
});
