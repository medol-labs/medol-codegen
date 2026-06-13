const slugify = require('slugify');

let registry = new Map();
let rootPackage = 'tech.medo';

function configureValueTypes(valueTypes = [], packageName = 'tech.medo') {
    registry = new Map(valueTypes.map((valueType) => [valueType.name, valueType]));
    rootPackage = packageName || 'tech.medo';
}

function findValueType(name) {
    return registry.get(name);
}

function isValueType(name) {
    return registry.has(name);
}

function contextPackage(context) {
    return context ? slugify(String(context)).replaceAll('-', '').replaceAll('_', '').toLowerCase() : 'eventmodel';
}

function valueTypeImport(name) {
    const valueType = findValueType(name);
    return valueType
        ? `import ${rootPackage}.${contextPackage(valueType.context)}.domain.types.${valueType.name}`
        : null;
}

function resolvedBaseType(valueTypeOrName) {
    const valueType = typeof valueTypeOrName === 'string' ? findValueType(valueTypeOrName) : valueTypeOrName;
    return valueType?.resolvedBaseType ?? valueType?.baseType ?? valueTypeOrName ?? 'String';
}

function resolvedConstraints(valueTypeOrName) {
    const valueType = typeof valueTypeOrName === 'string' ? findValueType(valueTypeOrName) : valueTypeOrName;
    return valueType?.resolvedConstraints ?? valueType?.constraints ?? [];
}

module.exports = {
    configureValueTypes,
    contextPackage,
    findValueType,
    isValueType,
    resolvedBaseType,
    resolvedConstraints,
    valueTypeImport
};
