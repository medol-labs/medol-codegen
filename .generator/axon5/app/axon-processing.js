const {kebab, pascal, safeIdentifier} = require('./model-helpers');

const AUDIT_TRAIL_PROCESSING_GROUP = 'audit-trail';

function lowerCamel(value) {
    const name = pascal(value);
    return safeIdentifier(name.charAt(0).toLowerCase() + name.slice(1));
}

function readModelProcessingGroup(readmodel) {
    return `readmodel-${kebab(readmodel.name ?? readmodel.title)}`;
}

function automationProcessingGroup(slice) {
    return `automation-${kebab(slice.context ?? 'default')}-${kebab(slice.name ?? slice.title)}`;
}

function integrationProcessingGroup(slice) {
    return `integration-${kebab(slice.context ?? 'default')}-${kebab(slice.name ?? slice.title)}`;
}

function beanNameForProcessingGroup(processingGroup, usedNames = new Set()) {
    const baseName = lowerCamel(`${processingGroup} event processor definition`);
    let name = baseName;
    let counter = 2;
    while (usedNames.has(name)) {
        name = `${baseName}${counter}`;
        counter += 1;
    }
    usedNames.add(name);
    return name;
}

module.exports = {
    AUDIT_TRAIL_PROCESSING_GROUP,
    automationProcessingGroup,
    beanNameForProcessingGroup,
    integrationProcessingGroup,
    readModelProcessingGroup
};
