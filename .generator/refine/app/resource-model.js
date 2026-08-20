/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {
    uniqueElements,
    uniqueFields,
    tableName,
    identifierFields,
    rowIdExpression,
    normalizeFields,
    defaultValueExpression,
    hasNestedArrayField,
    isEditCommand,
    isCreateCommand,
    isDeleteCommand,
    cleanTitle,
    titleCase,
    kebab,
    snake,
    axonRoute,
    camel,
    pascal,
    isListField,
    isObjectField
} = require('./model-utils');
const {commandWorkflowFields, commandKey, actionControls, findActionControlField} = require('./workflow-model');

function criteriaQueryFields(fields) {
    return (fields ?? [])
        .filter((field) => !isListField(field) && !isObjectField(field))
        .map((field) => field.name);
}

function toReadModelResource(group, readModel, allEvents, workflow) {
    const aggregateTitle = cleanTitle(group.title);
    const queryTitle = cleanTitle(readModel?.title ?? aggregateTitle);
    const route = kebab(queryTitle);
    const name = snake(queryTitle);
    const component = pascal(queryTitle);
    const queryFields = normalizeFields(readModel?.fields ?? []);
    const fields = queryFields.length > 0
        ? queryFields
        : normalizeFields(group.commands.flatMap((command) => command.fields ?? []));
    const idFields = identifierFields(fields);
    const idField = idFields[0] ?? fields.find((field) => field.name === 'id') ?? fields[0];
    const resourceCommands = uniqueElements(group.commands);
    const deployment = group.deployment;
    let normalizedCommands = resourceCommands
        .filter((command) => command?.title)
        .map((command) => ({
            ...toCommand(command, route, component, readModel, allEvents, workflow),
            dataProviderName: deployment.dataProviderName
        }));
    normalizedCommands = withPrefillFields(normalizedCommands, queryFields);
    normalizedCommands = withActionControlFields(normalizedCommands, queryFields);
    const producerCommandKeys = group.producerCommandKeys ?? new Set();
    const itemCommandKeys = group.itemCommandKeys ?? new Set();
    const producerCommands = normalizedCommands.filter((command) => producerCommandKeys.has(command.id));
    const resourceAggregateRoute = axonRoute(aggregateTitle);
    const aggregateProducerCommands = producerCommands
        .filter((command) => command.aggregateRoute === resourceAggregateRoute);
    const createCommand = aggregateProducerCommands.find((command) => command.startsLifecycle && isCreateCommand(command))
        ?? aggregateProducerCommands.find((command) => command.startsLifecycle);
    const primaryIdField = idField?.name ?? 'id';
    const rowCommands = normalizedCommands
        .filter((command) => itemCommandKeys.has(command.id))
        .filter((command) => canAddressCommandFromReadModel(command, queryFields, primaryIdField));
    const primaryRowCommands = rowCommands.filter((command) =>
        command.matchingFields.some((field) => field.name === primaryIdField)
    );
    const editCommand = primaryRowCommands.find((command) => isEditCommand(command));
    const deleteCommand = primaryRowCommands.find((command) => isDeleteCommand(command));
    const reservedCommandNames = [createCommand, editCommand, deleteCommand].filter(Boolean).map((command) => command.name);
    const itemCommands = rowCommands
        .filter((command) => !reservedCommandNames.includes(command.name));

    return {
        title: queryTitle,
        aggregateTitle,
        label: queryTitle,
        aggregateRoute: resourceAggregateRoute,
        queryRoute: axonRoute(queryTitle),
        route,
        name,
        tableName: tableName(readModel, queryTitle),
        component,
        chapter: group.chapter,
        moduleName: deployment.name,
        moduleLabel: deployment.label,
        dataProviderName: deployment.dataProviderName,
        idField: idField?.name ?? 'id',
        idFields: (idFields.length > 0 ? idFields : [idField]).filter(Boolean).map((field) => field.name),
        queryFields: criteriaQueryFields(queryFields),
        rowIdExpression: rowIdExpression((idFields.length > 0 ? idFields : [idField]).filter(Boolean)),
        readModelId: readModel?.id,
        canList: readModel ? !!readModel.listElement : true,
        fields,
        actionControls: actionControls(queryFields),
        valueTypeImports: Array.from(new Set(fields.map((field) => field.valueType?.name).filter(Boolean))).sort(),
        createCommand,
        editCommand,
        deleteCommand,
        commands: [createCommand, editCommand, deleteCommand, ...itemCommands].filter(Boolean),
        routedCommands: [deleteCommand, ...itemCommands].filter(Boolean),
        itemCommands
    };
}

function sharesIdentifierField(commandFields, readModelFields) {
    const readModelIdentifiers = new Set(readModelFields
        .filter(isIdentifierField)
        .map((field) => field.name));
    return commandFields
        .filter(isIdentifierField)
        .some((field) => readModelIdentifiers.has(field.name));
}

function isIdentifierField(field) {
    return field.idAttribute || field.name === 'id' || field.name?.toLowerCase().endsWith('id');
}

function uniqueResourceNames(resources) {
    const seenNames = new Map();
    return resources.map((resource) => {
        const count = seenNames.get(resource.name) ?? 0;
        seenNames.set(resource.name, count + 1);

        if (count === 0) {
            return resource;
        }

        return {
            ...resource,
            name: `${resource.name}_${resource.aggregateRoute}`,
            route: `${resource.route}-${resource.aggregateRoute}`,
            component: `${resource.component}${pascal(resource.aggregateTitle)}`,
            createCommand: withResourceComponent(resource.createCommand, `${resource.component}${pascal(resource.aggregateTitle)}`),
            editCommand: withResourceComponent(resource.editCommand, `${resource.component}${pascal(resource.aggregateTitle)}`),
            deleteCommand: withResourceComponent(resource.deleteCommand, `${resource.component}${pascal(resource.aggregateTitle)}`),
            commands: resource.commands.map((command) => withResourceComponent(command, `${resource.component}${pascal(resource.aggregateTitle)}`)),
            routedCommands: resource.routedCommands.map((command) => withResourceComponent(command, `${resource.component}${pascal(resource.aggregateTitle)}`)),
            itemCommands: resource.itemCommands.map((command) => withResourceComponent(command, `${resource.component}${pascal(resource.aggregateTitle)}`))
        };
    });
}

function withResourceComponent(command, resourceComponent) {
    if (!command) {
        return command;
    }

    return {
        ...command,
        pageComponent: `${resourceComponent}${command.component}`
    };
}

function toCommand(command, resourceRoute, resourceComponent, readModel, allEvents, workflow) {
    const title = cleanTitle(command.title);
    const component = pascal(title);
    const rawFields = command.fields ?? [];
    const normalizedFields = normalizeFields(command.fields).filter((field) => !field.generated);
    const formFields = normalizedFields.filter(isCommandFormField);
    const workflowFields = commandWorkflowFields(command, readModel, allEvents, workflow);
    const stateControl = workflow.stateControlForCommand(command, readModel);
    const commandAggregateTitle = cleanTitle(
        command.concept
        ?? command.concepts?.[0]
        ?? command.aggregateName
        ?? command.aggregate
        ?? title
    );
    return {
        id: commandKey(command),
        title,
        label: titleCase(title),
        name: camel(title),
        route: kebab(title),
        file: kebab(title),
        component,
        schemaName: `${component}CommandSchema`,
        inputTypeName: `${component}CommandInput`,
        pageComponent: `${resourceComponent}${component}`,
        resourceRoute,
        aggregateRoute: axonRoute(commandAggregateTitle),
        startsLifecycle: !!(command.startsLifecycle ?? command.createsAggregate),
        allowedStates: stateControl.allowedStates,
        targetState: stateControl.targetState,
        stateField: stateControl.stateField,
        fields: formFields.map((field) => ({
            ...field,
            select: field.fileInput ? null : workflowFields.selects.get(field.name) ?? null
        })),
        matchingFields: normalizedFields,
        prefillCandidateFields: [
            ...formFields,
            ...normalizedFields.filter((field) => !isCommandFormField(field) && hasSourceMapping(field))
        ],
        workflowPrefillFields: normalizedFields.filter((field) => workflowFields.prefill.has(field.name)),
        defaultValueFields: formFields
            .filter((field) => !workflowFields.prefill.has(field.name))
            .filter((field) => field.object || field.list)
            .map((field) => ({
                name: field.name,
                defaultValue: defaultValueExpression(field)
            })),
        hasSelectFields: formFields.some((field) => workflowFields.selects.has(field.name)),
        hasObjectFields: formFields.some((field) => field.object),
        hasArrayFields: formFields.some((field) => field.list || hasNestedArrayField(field)),
        hasFileFields: formFields.some((field) => field.fileInput),
        fileFields: formFields.filter((field) => field.fileInput),
        fileUploadProducer: isFileUploadProducerCommand(command, rawFields)
    };
}

function isFileUploadProducerCommand(command, rawFields) {
    return rawFields.some((field) => field.uploadFile);
}

function isCommandFormField(field) {
    if (field.excludeFromForm || field.hidden || field.readOnly || field.technicalAttribute) {
        return false;
    }
    return true;
}

function canAddressCommandFromReadModel(command, queryFields, primaryIdField) {
    return sharesPrimaryIdentifierField(command.matchingFields, primaryIdField)
        || sharesSourcedPrimaryIdentifierField(command.matchingFields, queryFields, primaryIdField);
}

function sharesPrimaryIdentifierField(commandFields, primaryIdField) {
    return commandFields
        .filter(isIdentifierField)
        .some((field) => field.name === primaryIdField);
}

function sharesSourcedPrimaryIdentifierField(commandFields, readModelFields, primaryIdField) {
    const readModelIdentifiers = new Set(readModelFields
        .filter(isIdentifierField)
        .map((field) => field.name));
    return commandFields
        .filter(isIdentifierField)
        .filter(hasSourceMapping)
        .some((field) => field.name === primaryIdField && readModelIdentifiers.has(field.name));
}

function hasSourceMapping(field) {
    return Array.isArray(field.source?.from) && field.source.from.length > 0;
}

function withPrefillFields(commands, resourceFields) {
    const resourceFieldNames = new Set(resourceFields.map((field) => field.name));
    return commands.map((command) => {
        const prefillFields = uniqueFields([
            ...command.prefillCandidateFields.filter((field) => resourceFieldNames.has(field.name)),
            ...(command.workflowPrefillFields ?? [])
        ]);
        const formFieldNames = new Set(command.fields.map((field) => field.name));
        return {
            ...command,
            rowPrefillFields: command.prefillCandidateFields.filter((field) => resourceFieldNames.has(field.name)),
            prefillFields,
            hiddenPrefillFields: prefillFields.filter((field) => !formFieldNames.has(field.name)),
            hasSelectFields: command.fields.some((field) => field.select)
        };
    });
}

function withActionControlFields(commands, resourceFields) {
    return commands.map((command) => ({
        ...command,
        enabledField: findActionControlField(command, resourceFields)
    }));
}

module.exports = {
    toReadModelResource,
    sharesIdentifierField,
    isIdentifierField,
    uniqueResourceNames,
    withResourceComponent,
    toCommand
};
