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
    const contextRoute = contextRouteFor(group.slice, group.chapter);
    const readModelSliceRoute = sliceRouteFor(group.slice, queryTitle);
    const readModelPagePath = `${contextRoute}/slices/${readModelSliceRoute}`;
    const aggregatePagePath = `${contextRoute}/read-models/${route}`;
    let normalizedCommands = resourceCommands
        .filter((command) => command?.title)
        .map((command) => {
            const commandSlice = workflow.commandSliceFor(command) ?? group.slice;
            return {
                ...toCommand(command, route, component, readModel, allEvents, workflow, commandSlice, group.chapter),
                dataProviderName: deployment.dataProviderName
            };
        });
    normalizedCommands = withPrefillFields(normalizedCommands, queryFields);
    normalizedCommands = withActionControlFields(normalizedCommands, queryFields);
    const producerCommandKeys = group.producerCommandKeys ?? new Set();
    const itemCommandKeys = group.itemCommandKeys ?? new Set();
    const producerCommands = normalizedCommands.filter((command) => producerCommandKeys.has(command.id));
    const createCommand = producerCommands.find((command) => command.startsLifecycle && isCreateCommand(command))
        ?? producerCommands.find((command) => command.startsLifecycle);
    const resourceAggregateRoute = axonRoute(aggregateTitle);
    const primaryIdField = idField?.name ?? 'id';
    const rowCommandKeys = new Set([
        ...itemCommandKeys,
        ...producerCommands
            .filter((command) => command !== createCommand)
            .map((command) => command.id)
    ]);
    const rowCommands = normalizedCommands
        .filter((command) => rowCommandKeys.has(command.id))
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
        contextRoute,
        sliceRoute: readModelSliceRoute,
        route,
        name,
        pagePath: aggregatePagePath,
        listPagePath: readModelPagePath,
        showPagePath: readModelPagePath,
        listFile: 'list',
        showFile: 'show',
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
        hasLongTextFields: fields.some((field) => field.longText),
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
    const uniqueResources = resources.map((resource) => {
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

    return withPageImportPaths(withCommandPageFiles(uniqueResources));
}

function withCommandPageFiles(resources) {
    const commandPageFiles = new Map();
    resources.forEach((resource) => {
        resource.commands.forEach((command) => {
            const key = commandPageFileKey(command);
            const components = commandPageFiles.get(key) ?? new Set();
            components.add(command.pageComponent);
            commandPageFiles.set(key, components);
        });
    });

    return resources.map((resource) => {
        const mapCommand = (command) => withUniqueCommandPageFile(command, resource, commandPageFiles);
        const createCommand = mapCommand(resource.createCommand);
        const editCommand = mapCommand(resource.editCommand);
        const deleteCommand = mapCommand(resource.deleteCommand);
        const commands = resource.commands.map(mapCommand);
        const routedCommands = resource.routedCommands.map(mapCommand);
        const itemCommands = resource.itemCommands.map(mapCommand);

        return {
            ...resource,
            createCommand,
            editCommand,
            deleteCommand,
            commands,
            routedCommands,
            itemCommands
        };
    });
}

function commandPageFileKey(command) {
    return command ? `${command.pagePath}/${command.file}` : '';
}

function withUniqueCommandPageFile(command, resource, commandPageFiles) {
    if (!command) {
        return command;
    }

    const components = commandPageFiles.get(commandPageFileKey(command));
    if (!components || components.size <= 1) {
        return command;
    }

    return {
        ...command,
        file: `${command.file}-${resource.route}`
    };
}

function withPageImportPaths(resources) {
    return resources.map((resource) => {
        const mapCommand = (command) => command
            ? {
                ...command,
                importPath: relativeImportPath(resource.pagePath, `${command.pagePath}/${command.file}`)
            }
            : command;
        const createCommand = mapCommand(resource.createCommand);
        const editCommand = mapCommand(resource.editCommand);
        const deleteCommand = mapCommand(resource.deleteCommand);
        const commands = resource.commands.map(mapCommand);
        const routedCommands = resource.routedCommands.map(mapCommand);
        const itemCommands = resource.itemCommands.map(mapCommand);

        return {
            ...resource,
            listImportPath: relativeImportPath(resource.pagePath, `${resource.listPagePath}/${resource.listFile}`),
            showImportPath: relativeImportPath(resource.pagePath, `${resource.showPagePath}/${resource.showFile}`),
            createCommand,
            editCommand,
            deleteCommand,
            commands,
            routedCommands,
            itemCommands
        };
    });
}

function relativeImportPath(fromDirectory, toModule) {
    const fromParts = fromDirectory.split('/').filter(Boolean);
    const toParts = toModule.split('/').filter(Boolean);

    while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
        fromParts.shift();
        toParts.shift();
    }

    const prefix = fromParts.map(() => '..');
    const relativeParts = [...prefix, ...toParts];
    const relativePath = relativeParts.join('/');
    return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
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

function toCommand(command, resourceRoute, resourceComponent, readModel, allEvents, workflow, commandSlice, fallbackChapter) {
    const title = cleanTitle(command.title);
    const component = pascal(title);
    const rawFields = command.fields ?? [];
    const normalizedFields = normalizeFields(command.fields).filter((field) => !field.generated);
    const snapshotFields = commandSnapshotFields(normalizedFields, workflow);
    const snapshotFieldNames = new Set(snapshotFields.map((field) => field.name));
    const snapshotsByKeyField = snapshotFields.reduce((result, field) => {
        const keyField = field.snapshotSelect?.snapshot?.keyField;
        if (!keyField) {
            return result;
        }
        const current = result.get(keyField) ?? [];
        current.push(field.snapshotSelect.snapshot);
        result.set(keyField, current);
        return result;
    }, new Map());
    const snapshotSelectsByKeyField = snapshotFields.reduce((result, field) => {
        const keyField = field.snapshotSelect?.snapshot?.keyField;
        if (keyField && !result.has(keyField)) {
            const {snapshot, ...select} = field.snapshotSelect;
            result.set(keyField, select);
        }
        return result;
    }, new Map());
    const formFields = normalizedFields
        .filter((field) => !snapshotFieldNames.has(field.name))
        .filter(isCommandFormField);
    const resultFields = normalizeFields(command.resultFields ?? []);
    const workflowFields = commandWorkflowFields(command, readModel, allEvents, workflow);
    const stateControl = workflow.stateControlForCommand(command, readModel);
    const commandAggregateTitle = cleanTitle(
        command.concept
        ?? command.concepts?.[0]
        ?? command.aggregateName
        ?? command.aggregate
        ?? title
    );
    const commandFields = formFields.map((field) => {
        const snapshots = snapshotsByKeyField.get(field.name) ?? [];
        const displaySnapshot = snapshots.find((snapshot) => snapshot.display);
        const baseSelect = workflowFields.selects.get(field.name) ?? snapshotSelectsByKeyField.get(field.name) ?? null;
        const select = field.fileInput || !baseSelect
            ? null
            : {
                ...baseSelect,
                ...(displaySnapshot ? {optionLabel: displaySnapshot.sourceField} : {}),
                ...(snapshots.length > 0 ? {snapshots} : {})
            };
        return {
            ...field,
            select
        };
    });
    const historyPrefillFields = commandFields
        .filter((field) => field.select && field.scalarList)
        .map((field) => ({
            fieldName: field.name,
            prefill: workflow.historyPrefillForField(command, readModel, field, formFields)
        }))
        .filter((item) => item.prefill)
        .map((item) => ({
            fieldName: item.fieldName,
            ...item.prefill
        }));

    const contextRoute = contextRouteFor(commandSlice, fallbackChapter);
    const sliceRoute = sliceRouteFor(commandSlice, title);

    return {
        id: commandKey(command),
        title,
        label: titleCase(title),
        name: camel(title),
        route: kebab(title),
        file: kebab(title),
        pagePath: `${contextRoute}/slices/${sliceRoute}`,
        contextRoute,
        sliceRoute,
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
        fields: commandFields,
        snapshotFields,
        historyPrefillFields,
        hasHistoryPrefillFields: historyPrefillFields.length > 0,
        resultFields,
        hasResultFields: resultFields.length > 0,
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
                defaultValue: field.list && workflowFields.selects.has(field.name) ? '[]' : defaultValueExpression(field)
            })),
        hasSelectFields: commandFields.some((field) => field.select),
        hasObjectFields: formFields.some((field) => field.object),
        hasArrayFields: formFields.some((field) => field.list || hasNestedArrayField(field)),
        hasFileFields: formFields.some((field) => field.fileInput),
        fileFields: formFields.filter((field) => field.fileInput),
        fileUploadProducer: isFileUploadProducerCommand(command, rawFields)
    };
}

function commandSnapshotFields(fields, workflow) {
    return fields
        .filter((field) => isCommandFormField(field))
        .map((field) => ({
            ...field,
            snapshotSelect: workflow.selectForSnapshotField(field)
        }))
        .filter((field) => field.snapshotSelect?.snapshot?.keyField);
}

function contextRouteFor(slice, fallbackChapter) {
    return kebab(slice?.context ?? slice?.chapter ?? fallbackChapter?.label ?? fallbackChapter?.name ?? 'default')
        || 'default-context';
}

function sliceRouteFor(slice, fallbackTitle) {
    return kebab(slice?.title ?? slice?.name ?? fallbackTitle) || kebab(fallbackTitle);
}

function isFileUploadProducerCommand(command, rawFields) {
    return rawFields.some((field) => field.uploadFile);
}

function isCommandFormField(field) {
    if (field.excludeFromForm || field.hidden || field.readOnly || field.technicalAttribute || field.portOutput) {
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
            defaultValueEntries: uniqueFields([
                ...prefillFields.map((field) => ({
                    name: field.name,
                    value: field.searchParamDefault
                })),
                ...(command.snapshotFields ?? []).map((field) => ({
                    name: field.name,
                    value: field.searchParamDefault
                })),
                ...(command.defaultValueFields ?? []).map((field) => ({
                    name: field.name,
                    value: field.defaultValue
                }))
            ]),
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
