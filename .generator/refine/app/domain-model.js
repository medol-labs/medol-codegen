/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {
    normalizeFields,
    tsValueType,
    zodValueTypeExpression,
    zodFieldExpression,
    cleanTitle,
    pascal
} = require('./model-utils');
const {buildAutomationCommandKeys, isAutomationCommand, commandKey} = require('./workflow-model');

function buildDomainModel(source) {
    source = withResolvedValueTypes(source);
    const slices = source.slices ?? [];
    const automationCommandKeys = buildAutomationCommandKeys(slices);
    const valueTypes = (source.valueTypes ?? []).map((valueType) => ({
        ...valueType,
        tsBaseType: tsValueType(valueType),
        schema: zodValueTypeExpression(valueType)
    }));
    const commands = uniqueCommands(slices.flatMap((slice) => slice.commands ?? []))
        .filter((command) => command?.title)
        .filter((command) => !isAutomationCommand(command, automationCommandKeys))
        .map((command) => {
            const component = pascal(cleanTitle(command.title));
            return {
                name: component,
                schemaName: `${component}CommandSchema`,
                inputTypeName: `${component}CommandInput`,
                fields: normalizeFields(command.fields).map((field) => ({
                    ...field,
                    schema: zodFieldExpression(field)
                }))
            };
        });
    return {valueTypes, commands};
}

function withResolvedValueTypes(source) {
    const valueTypesByName = new Map((source.valueTypes ?? []).map((valueType) => [valueType.name, valueType]));
    const enrichField = (field) => ({
        ...field,
        valueType: field.valueType ?? valueTypesByName.get(field.type)
    });
    const enrichValueType = (valueType) => ({
        ...valueType,
        fields: (valueType.fields ?? []).map(enrichField)
    });
    const valueTypes = (source.valueTypes ?? []).map(enrichValueType);
    const slices = (source.slices ?? []).map((slice) => ({
        ...slice,
        commands: (slice.commands ?? []).map((command) => ({
            ...command,
            fields: (command.fields ?? []).map(enrichField)
        })),
        events: (slice.events ?? []).map((event) => ({
            ...event,
            fields: (event.fields ?? []).map(enrichField)
        })),
        readmodels: (slice.readmodels ?? []).map((readModel) => ({
            ...readModel,
            fields: (readModel.fields ?? []).map(enrichField)
        }))
    }));
    return {...source, valueTypes, slices};
}

function uniqueCommands(commands) {
    const byName = new Map();
    commands.filter(Boolean).forEach((command) => {
        if (!byName.has(command.name)) {
            byName.set(command.name, command);
        }
    });
    return Array.from(byName.values());
}

module.exports = {
    buildDomainModel,
    withResolvedValueTypes
};
