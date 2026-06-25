const slugify = require('slugify');

let registry = new Map();
let conceptRegistry = new Map();
let rootPackage = 'tech.medo';

function configureValueTypes(valueTypes = [], packageName = 'tech.medo', concepts = []) {
    registry = new Map(valueTypes.map((valueType) => [valueType.name, valueType]));
    conceptRegistry = new Map(concepts.map((concept) => [concept.name, concept]));
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

function conceptState(type) {
    const match = String(type ?? '').match(/^([A-Za-z_][A-Za-z0-9_]*)\.State$/);
    if (!match) {
        return undefined;
    }
    const concept = conceptRegistry.get(match[1]);
    return concept ? {concept, typeName: `${concept.name}State`} : undefined;
}

function conceptStateImport(type) {
    const state = conceptState(type);
    return state
        ? `import ${rootPackage}.${contextPackage(state.concept.context)}.domain.states.${state.typeName}`
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
    conceptState,
    conceptStateImport,
    contextPackage,
    findValueType,
    isValueType,
    resolvedBaseType,
    resolvedConstraints,
    valueTypeImport
};
