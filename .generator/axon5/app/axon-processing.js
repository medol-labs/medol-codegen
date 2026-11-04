const {kebab, pascal, safeIdentifier} = require('./model-helpers');

function auditDeploymentName(generator) {
    const singleDeployment = generator.model.deployments?.length === 1 ? generator.model.deployments[0].name : undefined;
    return kebab(generator.currentDeployment?.name || generator.model.deployment || generator.modulePrefix || singleDeployment || generator.model.name || 'application');
}
function auditProcessingGroup(generator) { return `audit-${auditDeploymentName(generator)}-trail-v2`; }
function hasLocalOperationAudit(model) {
    return !!model.operationAudit && (model.slices ?? []).some(slice => slice.context === model.operationAudit.context
        && (slice.readmodels ?? []).some(readmodel => readmodel.name === model.operationAudit.readModel));
}

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
    auditDeploymentName,
    auditProcessingGroup,
    hasLocalOperationAudit,
    automationProcessingGroup,
    beanNameForProcessingGroup,
    integrationProcessingGroup,
    readModelProcessingGroup
};
