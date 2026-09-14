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
const {commandFieldsWithSelection} = require('./selection-fields');

function buildDomainModel(source) {
    source = withResolvedValueTypes(source);
    const slices = source.slices ?? [];
    const automationCommandKeys = buildAutomationCommandKeys(slices);
    const valueTypes = uniqueValueTypes(source.valueTypes ?? []).map((valueType) => ({
        ...valueType,
        tsBaseType: tsValueType(valueType),
        schema: zodValueTypeExpression(valueType)
    }));
    const commands = uniqueCommandsWithSlices(slices.flatMap((slice) => (slice.commands ?? []).map((command) => ({command, slice}))))
        .filter(({command}) => command?.title)
        .filter(({command}) => !isAutomationCommand(command, automationCommandKeys))
        .map(({command, slice}) => {
            const component = pascal(cleanTitle(command.title));
            return {
                name: component,
                schemaName: `${component}CommandSchema`,
                inputTypeName: `${component}CommandInput`,
                fields: normalizeFields(commandFieldsWithSelection(command, slice, slices))
                    .filter((field) => !field.portOutput)
                    .map((field) => ({
                        ...field,
                        schema: zodFieldExpression(field)
                    }))
            };
        });
    return {valueTypes, commands};
}

function withResolvedValueTypes(source) {
    const valueTypesByName = new Map();
    for (const valueType of source.valueTypes ?? []) {
        if (!valueTypesByName.has(valueType.name)) {
            valueTypesByName.set(valueType.name, valueType);
        }
    }
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

function uniqueValueTypes(valueTypes) {
    const byName = new Map();
    for (const valueType of valueTypes.filter(Boolean)) {
        if (!byName.has(valueType.name)) {
            byName.set(valueType.name, valueType);
        }
    }
    return Array.from(byName.values());
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

function uniqueCommandsWithSlices(items) {
    const byName = new Map();
    items.filter((item) => item?.command).forEach((item) => {
        if (!byName.has(item.command.name)) {
            byName.set(item.command.name, item);
        }
    });
    return Array.from(byName.values());
}

module.exports = {
    buildDomainModel,
    withResolvedValueTypes
};
