const {valueTypeForField} = require('./model-helpers');
const {resolvedBaseType} = require('../../common/util/value-types');

const numeric = new Set(['int', 'integer', 'long', 'float', 'double', 'number', 'decimal', 'bigdecimal']);
const kotlinString = value => JSON.stringify(String(value)).replace(/\$/g, '\\$').replace(/\\f/g, '\\u000c');

function parseAssertion(expression) {
    const input = String(expression).replace(/^assert\s+/, '');
    const tokens = [];
    let rest = input;
    while (rest.trim()) {
        rest = rest.trimStart();
        const match = /^("(?:\\.|[^"\\])*"|>=|<=|==|!=|>|<|-?\d+(?:\.\d+)?|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/.exec(rest);
        if (!match) throw new Error(`Unsupported assertion: ${expression}`);
        tokens.push(match[0]);
        rest = rest.slice(match[0].length);
    }
    if (tokens.length !== 3 || !['>=', '<=', '==', '!=', '>', '<'].includes(tokens[1])) {
        throw new Error(`Unsupported assertion: ${expression}`);
    }
    return tokens;
}

function operand(token, command) {
    if (/^-?\d+(?:\.\d+)?$/.test(token)) return {expression: `java.math.BigDecimal("${token}")`, kind: 'numeric', literal: true};
    if (token.startsWith('"')) return {expression: kotlinString(JSON.parse(token)), kind: 'string'};
    if (['true', 'false', 'null'].includes(token)) return {expression: token, kind: token === 'null' ? 'null' : 'boolean'};
    const parts = token.split('.');
    const name = parts.at(-1);
    if (parts.length > 2 || (parts.length === 2 && parts[0] !== command.name)) throw new Error(`Assertion must reference the current command: ${token}`);
    const field = command.fields?.find(item => item.name === name);
    if (!field || field.cardinality === 'Multiple') throw new Error(`Unsupported assertion field: ${token}`);
    const valueType = valueTypeForField(field);
    const type = String(valueType?.kind === 'scalar' ? resolvedBaseType(valueType) : field.type).toLowerCase();
    const base = `command.${field.name}`;
    const access = valueType?.kind === 'scalar' ? `${base}${field.optional ? '?' : ''}.value` : base;
    return {expression: access, kind: numeric.has(type) ? 'numeric' : type, nullable: field.optional};
}

function renderCommandAssertions(model, slice, command) {
    const expressions = [...new Set((slice.specifications ?? []).flatMap(spec => spec.expressions ?? []))]
        .filter(expression => /^assert\s/.test(expression));
    return expressions.map(expression => {
        const [leftToken, operator, rightToken] = parseAssertion(expression);
        // Specifications may describe another command in the same slice.
        const owners = [leftToken, rightToken].filter(token => /^\w+\./.test(token)).map(token => token.split('.')[0]);
        if (owners.length && owners.every(owner => owner !== command.name && slice.commands?.some(item => item.name === owner))) return '';
        if ([leftToken, rightToken].some(token => /^\w+\./.test(token) && token.split('.')[0] !== command.name)) {
            throw new Error(`Cannot generate ${command.name} assertion with an external operand: ${expression}`);
        }
        const left = operand(leftToken, command);
        const right = operand(rightToken, command);
        let predicate;
        if (left.kind === 'numeric' && right.kind === 'numeric') {
            const decimal = value => value.literal ? value.expression : `java.math.BigDecimal(${value.expression}.toString())`;
            predicate = `${decimal(left)}.compareTo(${decimal(right)}) ${operator} 0`;
        } else {
            if (!['==', '!='].includes(operator) || (left.kind !== right.kind && left.kind !== 'null' && right.kind !== 'null')) {
                throw new Error(`Unsupported assertion comparison: ${expression}`);
            }
            predicate = `${left.expression} ${operator} ${right.expression}`;
        }
        if (left.kind !== 'null' && right.kind !== 'null') {
            const checks = [left, right].filter(value => value.nullable).map(value => `${value.expression} != null`);
            predicate = [...checks, predicate].join(' && ');
        }
        return `        if (!(${predicate})) {
            throw ${model.rootPackage}.shared.domain.CommandRejectedException(
                code = "COMMAND_ASSERTION_FAILED",
                i18nKey = "errors.commandAssertionFailed",
                args = mapOf("command" to ${kotlinString(command.name)}, "expression" to ${kotlinString(expression)}),
                message = "Command validation failed."
            )
        }`;
    }).filter(Boolean).join('\n');
}

module.exports = {parseAssertion, renderCommandAssertions};
