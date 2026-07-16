/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {
    normalizeArray,
    uniqueElements,
    unique,
    idFieldName,
    optionLabelField,
    dictionaryProviderFor,
    dictionaryProviderField,
    normalizeFields,
    optionLabel,
    isReferenceSelectField,
    isJsonField,
    cleanTitle,
    titleCase,
    snake,
    axonRoute,
    camel,
    pascal
} = require('./model-utils');
const {backendModuleForContext} = require('./backend-modules');
const {aggregateName} = require('./resource-naming');

function buildWorkflowModel(slices, aggregates, contexts, selectedCommands, backendModules, transitions = []) {
    const selectableReadModels = new Map();
    let dictionaryProviderSelect = null;
    const commandsById = new Map();
    const eventsById = new Map();
    const producerCommandsByReadModelId = new Map();
    const nextCommandsByReadModelId = new Map();
    const transitionsByCommandId = new Map();
    const automationCommandKeys = buildAutomationCommandKeys(slices);

    transitions
        .filter((transition) => transition?.command)
        .forEach((transition) => {
            const keys = [
                transition.command.id,
                transition.command.name,
                transition.command.title
            ].filter(Boolean);
            keys.forEach((key) => transitionsByCommandId.set(String(key), transition));
        });

    slices.flatMap((slice) => slice.commands ?? [])
        .filter((command) => command?.title)
        .filter((command) => !isAutomationCommand(command, automationCommandKeys))
        .filter((command) => !selectedCommands || selectedCommands.has(commandKey(command)))
        .forEach((command) => {
            commandsById.set(commandKey(command), command);
            if (command.id) {
                commandsById.set(command.id, command);
            }
        });

    slices.flatMap((slice) => slice.events ?? [])
        .filter((event) => event?.title)
        .forEach((event) => {
            eventsById.set(String(event.title), event);
            if (event.id) {
                eventsById.set(event.id, event);
            }
        });

    slices.flatMap((slice) => (slice.readmodels ?? []).map((readModel) => ({readModel, slice})))
        .filter(({readModel}) => readModel?.title && readModel.listElement)
        .forEach(({readModel, slice}) => {
            const id = idFieldName(readModel);
            if (!id || selectableReadModels.has(id)) {
                return;
            }

            const aggregate = aggregateName(readModel, { title: readModel.slice }, aggregates, contexts);
            const deployment = backendModuleForContext(slice.context ?? slice.chapter, backendModules);
            const optionLabel = optionLabelField(readModel);
            const selectModel = {
                resource: snake(cleanTitle(readModel.title)),
                dataProviderName: deployment.dataProviderName,
                optionValue: id,
                optionLabel,
                meta: {
                    idField: id,
                    label: cleanTitle(readModel.title),
                    aggregateRoute: axonRoute(aggregate.title),
                    queryRoute: axonRoute(readModel.title),
                    queryFields: queryFieldsForReadModel(readModel)
                }
            };
            selectableReadModels.set(id, selectModel);
            const dictionaryProvider = dictionaryProviderFor(readModel);
            if (dictionaryProvider) {
                dictionaryProviderSelect = {
                    ...selectModel,
                    optionValue: dictionaryProviderField(readModel, 'value') ?? id,
                    optionLabel: dictionaryProviderField(readModel, 'label') ?? optionLabel,
                    dictionaryCodeField: dictionaryProviderField(readModel, 'code'),
                    stateField: dictionaryProviderField(readModel, 'state'),
                    activeField: dictionaryProviderField(readModel, 'active'),
                    sortField: dictionaryProviderField(readModel, 'order')
                };
            }
        });

    slices.flatMap((slice) => slice.readmodels ?? [])
        .filter((readModel) => readModel?.title)
        .forEach((readModel) => {
            const inboundEventIds = (readModel.dependencies ?? [])
                .filter((dependency) => dependencyDirection(dependency) === 'INBOUND' && dependency.elementType === 'EVENT')
                .map((dependency) => dependency.id ?? String(dependency.title ?? ''));
            const inboundEvents = inboundEventIds
                .map((eventId) => eventsById.get(eventId))
                .filter(Boolean)
                .filter((event) => eventTargetsReadModel(event, readModel));
            const producerCommands = uniqueElements(inboundEvents
                .flatMap((event) => (event.dependencies ?? [])
                    .filter((dependency) => dependencyDirection(dependency) === 'INBOUND' && dependency.elementType === 'COMMAND')
                    .map((dependency) => commandsById.get(dependency.id) ?? commandsById.get(String(dependency.title ?? '')))
                    .filter(Boolean)));
            const nextCommands = uniqueElements(inboundEvents
                .flatMap((event) => (event.dependencies ?? [])
                    .filter((dependency) => dependencyDirection(dependency) === 'OUTBOUND' && dependency.elementType === 'COMMAND')
                    .map((dependency) => commandsById.get(dependency.id) ?? commandsById.get(String(dependency.title ?? '')))
                    .filter(Boolean)));

            if (producerCommands.length > 0) {
                producerCommandsByReadModelId.set(readModel.id, producerCommands);
            }
            if (nextCommands.length > 0) {
                nextCommandsByReadModelId.set(readModel.id, nextCommands);
            }
        });

    return {
        selectableReadModels,
        commandsForReadModel(readModel) {
            return uniqueElements([
                ...(producerCommandsByReadModelId.get(readModel.id) ?? []),
                ...(nextCommandsByReadModelId.get(readModel.id) ?? [])
            ]);
        },
        producerCommandKeys(readModel) {
            return new Set((producerCommandsByReadModelId.get(readModel.id) ?? []).map(commandKey));
        },
        itemCommandKeys(readModel) {
            return new Set((nextCommandsByReadModelId.get(readModel.id) ?? []).map(commandKey));
        },
        stateControlForCommand(command, readModel) {
            const transition = transitionsByCommandId.get(commandKey(command))
                ?? transitionsByCommandId.get(String(command.name ?? ''))
                ?? transitionsByCommandId.get(String(command.title ?? ''));
            return stateControlForTransition(transition, readModel);
        },
        dictionaryValueSelect(dictionaryCode) {
            if (!dictionaryProviderSelect || !dictionaryProviderSelect.dictionaryCodeField || !dictionaryCode) {
                return null;
            }
            const filters = [{
                field: dictionaryProviderSelect.dictionaryCodeField,
                operator: 'eq',
                value: dictionaryCode
            }];
            if (dictionaryProviderSelect.stateField) {
                filters.push({
                    field: dictionaryProviderSelect.stateField,
                    operator: 'eq',
                    value: 'ACTIVE'
                });
            } else if (dictionaryProviderSelect.activeField) {
                filters.push({
                    field: dictionaryProviderSelect.activeField,
                    operator: 'eq',
                    value: true
                });
            }
            return {
                ...dictionaryProviderSelect,
                meta: {
                    ...dictionaryProviderSelect.meta,
                    queryFields: unique([
                        ...(dictionaryProviderSelect.meta?.queryFields ?? []),
                        dictionaryProviderSelect.dictionaryCodeField,
                        dictionaryProviderSelect.stateField,
                        dictionaryProviderSelect.activeField
                    ])
                },
                filters,
                pagination: {
                    current: 1,
                    currentPage: 1,
                    pageSize: 100,
                    mode: 'server'
                },
                sorters: dictionaryProviderSelect.sortField
                    ? [{ field: dictionaryProviderSelect.sortField, order: 'asc' }]
                    : []
            };
        }
    };
}

function queryFieldsForReadModel(readModel) {
    return unique((readModel?.fields ?? [])
        .filter((field) => field?.query)
        .map((field) => field.name));
}

function eventTargetsReadModel(event, readModel) {
    const outboundReadModels = (event.dependencies ?? [])
        .filter((dependency) => dependencyDirection(dependency) === 'OUTBOUND' && dependency.elementType === 'READMODEL');
    if (outboundReadModels.length === 0) {
        return true;
    }
    const readModelKeys = new Set([
        readModel.id,
        readModel.name,
        readModel.title,
        cleanTitle(readModel.title)
    ].filter(Boolean).map(String));
    return outboundReadModels.some((dependency) => [
        dependency.id,
        dependency.name,
        dependency.title,
        cleanTitle(dependency.title)
    ].filter(Boolean).some((key) => readModelKeys.has(String(key))));
}

function buildAutomationCommandKeys(slices) {
    const keys = new Set();
    const addReference = (reference) => {
        [reference?.id, reference?.name, reference?.title]
            .filter(Boolean)
            .forEach((value) => {
                keys.add(String(value));
                keys.add(cleanTitle(value));
            });
    };

    slices.forEach((slice) => {
        [...normalizeArray(slice.processors), ...normalizeArray(slice.automations)]
            .flatMap((processor) => processor.dependencies ?? [])
            .filter((dependency) => dependencyDirection(dependency) === 'OUTBOUND' && dependency.elementType === 'COMMAND')
            .forEach(addReference);

        (slice.commands ?? [])
            .filter((command) => (command.dependencies ?? [])
                .some((dependency) => dependencyDirection(dependency) === 'INBOUND' && dependency.elementType === 'PROCESSOR'))
            .forEach(addReference);
    });

    return keys;
}

function isAutomationCommand(command, automationCommandKeys) {
    return [
        commandKey(command),
        command.id,
        command.name,
        command.title,
        cleanTitle(command.title)
    ].filter(Boolean).some((key) => automationCommandKeys.has(String(key)));
}

function commandWorkflowFields(command, readModel, allEvents, workflow) {
    const inboundEventIds = (command.dependencies ?? [])
        .filter((dependency) => dependencyDirection(dependency) === 'INBOUND' && dependency.elementType === 'EVENT')
        .map((dependency) => dependency.id ?? String(dependency.title ?? ''));
    const inboundEvents = allEvents.filter((event) => inboundEventIds.includes(event.id) || inboundEventIds.includes(event.title));
    const upstreamFieldNames = new Set([
        ...(readModel?.fields ?? []).map((field) => field.name),
        ...inboundEvents.flatMap((event) => event.fields ?? []).map((field) => field.name)
    ]);
    const prefill = new Set();
    const selects = new Map();

    normalizeFields(command.fields)
        .filter((field) => !field.generated)
        .forEach((field) => {
            if (upstreamFieldNames.has(field.name)) {
                prefill.add(field.name);
            }

            const select = workflow.selectableReadModels.get(field.name);
            if (select && !field.idAttribute && isReferenceSelectField(field)) {
                selects.set(field.name, select);
            }

            const dictionarySelect = workflow.dictionaryValueSelect(field.dictionary);
            if (dictionarySelect && !field.idAttribute && !isJsonField(field)) {
                selects.set(field.name, dictionarySelect);
            }
        });

    return { prefill, selects };
}

function stateControlForTransition(transition, readModel) {
    const allowedStates = normalizeArray(transition?.from).filter(Boolean);
    const conceptName = transition?.owner?.name ?? transition?.owner?.title;
    return {
        allowedStates,
        targetState: transition?.to,
        stateField: allowedStates.length > 0 ? stateFieldForReadModel(readModel, conceptName) : undefined
    };
}

function stateFieldForReadModel(readModel, conceptName) {
    const fields = normalizeFields(readModel?.fields ?? []);
    const conceptStateType = conceptName ? `${conceptName}.State` : undefined;
    const candidates = [
        fields.find((field) => conceptStateType && field.type === conceptStateType),
        fields.find((field) => field.name === 'state'),
        fields.find((field) => conceptName && field.name === `${camel(conceptName)}State`),
        fields.find((field) => conceptName && field.name === `${camel(conceptName)}Status`),
        fields.find((field) => /Status$/.test(field.name ?? '')),
        fields.find((field) => field.name === 'status')
    ];
    return candidates.filter(Boolean)[0]?.name;
}

function dependencyDirection(dependency) {
    return dependency?.direction ?? dependency?.type;
}

function commandKey(command) {
    return String(command.id ?? command.title);
}

function findActionControlField(command, resourceFields) {
    const fields = new Set(resourceFields.map((field) => field.name));
    const candidates = unique([
        `can${pascal(command.title)}`,
        `can${pascal(command.name)}`,
        ...verbActionCandidates(command.title),
        ...verbActionCandidates(command.name),
        ...verbObjectActionCandidates(command.title),
        ...verbObjectActionCandidates(command.name)
    ]);
    return candidates.find((candidate) => fields.has(candidate));
}

function verbActionCandidates(value) {
    const words = titleCase(value).split(/\s+/).filter(Boolean);
    return words.length > 0 ? [`can${pascal(words[0])}`] : [];
}

function verbObjectActionCandidates(value) {
    const words = titleCase(value).split(/\s+/).filter(Boolean);
    if (words.length < 2) {
        return [];
    }
    return [`can${pascal(words[0])}${pascal(words[words.length - 1])}`];
}

function actionControls(fields) {
    return {
        availableActionsField: fields.find((field) => field.name === 'availableActions')?.name,
        blockedReasonField: fields.find((field) => field.name === 'blockedReason')?.name,
        enabledFields: fields.filter((field) => /^can[A-Z]/.test(field.name)).map((field) => field.name)
    };
}

module.exports = {
    buildWorkflowModel,
    buildAutomationCommandKeys,
    isAutomationCommand,
    commandWorkflowFields,
    stateControlForTransition,
    stateFieldForReadModel,
    dependencyDirection,
    findActionControlField,
    actionControls,
    commandKey
};
