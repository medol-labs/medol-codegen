/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {
    normalizeArray,
    uniqueElements,
    unique,
    idFieldName,
    tableName,
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
    const selectableReadModelsByFieldSource = new Map();
    let dictionaryProviderSelect = null;
    const commandsById = new Map();
    const eventsById = new Map();
    const commandContextsById = new Map();
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

    slices.flatMap((slice) => (slice.commands ?? []).map((command) => ({command, slice})))
        .filter(({command}) => command?.title)
        .filter(({command}) => !isAutomationCommand(command, automationCommandKeys))
        .filter(({command}) => !selectedCommands || selectedCommands.has(commandKey(command)))
        .forEach(({command, slice}) => {
            commandsById.set(commandKey(command), command);
            commandContextsById.set(commandKey(command), slice.context ?? slice.chapter);
            if (command.id) {
                commandsById.set(command.id, command);
                commandContextsById.set(command.id, slice.context ?? slice.chapter);
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

    const readModelInfos = slices
        .flatMap((slice) => (slice.readmodels ?? []).map((readModel) => ({readModel, slice})))
        .filter(({readModel}) => readModel?.title && readModel.listElement)
        .map(({readModel, slice}) => ({
            readModel,
            slice,
            context: slice.context ?? slice.chapter,
            aggregate: aggregateName(readModel, { ...slice, title: readModel.slice ?? slice.title }, aggregates, contexts),
            deployment: backendModuleForContext(slice.context ?? slice.chapter, backendModules)
        }));

    readModelInfos
        .forEach(({readModel, slice, aggregate}) => {
            const id = idFieldName(readModel);
            if (!id || selectableReadModels.has(id)) {
                return;
            }

            const deployment = backendModuleForContext(slice.context ?? slice.chapter, backendModules);
            const optionLabel = optionLabelField(readModel);
            const baseSelectModel = {
                resource: snake(cleanTitle(readModel.title)),
                dataProviderName: deployment.dataProviderName,
                optionLabel,
                meta: {
                    idField: id,
                    label: cleanTitle(readModel.title),
                    aggregateRoute: axonRoute(aggregate.title),
                    queryRoute: axonRoute(readModel.title),
                    queryFields: queryFieldsForReadModel(readModel)
                }
            };
            const selectModel = {
                ...baseSelectModel,
                optionValue: id
            };
            selectableReadModels.set(id, selectModel);
            readModelFieldSourceKeys(readModel, id).forEach((key) => {
                selectableReadModelsByFieldSource.set(key, selectModel);
            });
            normalizeFields(readModel.fields)
                .filter((field) => !isJsonField(field))
                .forEach((field) => {
                    const fieldSelectModel = {
                        ...baseSelectModel,
                        optionValue: field.name
                    };
                    readModelFieldSourceKeys(readModel, field.name).forEach((key) => {
                        selectableReadModelsByFieldSource.set(key, fieldSelectModel);
                    });
                });
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

    const preferredReadModelIdForCommand = (command) =>
        preferredReadModelForCommand(command, transitionsByCommandId, commandContextsById, readModelInfos)?.readModel?.id;

    readModelInfos
        .forEach(({readModel}) => {
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
                    .filter(Boolean)))
                .filter((command) => {
                    const preferredReadModelId = preferredReadModelIdForCommand(command);
                    return !preferredReadModelId || preferredReadModelId === readModel.id;
                });
            const nextCommands = uniqueElements(inboundEvents
                .flatMap((event) => (event.dependencies ?? [])
                    .filter((dependency) => dependencyDirection(dependency) === 'OUTBOUND' && dependency.elementType === 'COMMAND')
                    .map((dependency) => commandsById.get(dependency.id) ?? commandsById.get(String(dependency.title ?? '')))
                    .filter(Boolean)));
            const reactiveCommands = uniqueElements(inboundEvents
                .flatMap((event) => commandsReactingToEvent(commandsById, event)));

            if (producerCommands.length > 0) {
                producerCommandsByReadModelId.set(readModel.id, producerCommands);
            }
            const itemCommands = uniqueElements([...nextCommands, ...reactiveCommands]);
            if (itemCommands.length > 0) {
                nextCommandsByReadModelId.set(readModel.id, itemCommands);
            }
        });

    uniqueElements(Array.from(commandsById.values())).forEach((command) => {
        const preferredReadModelId = preferredReadModelIdForCommand(command);
        if (!preferredReadModelId) {
            return;
        }
        producerCommandsByReadModelId.set(preferredReadModelId, uniqueElements([
            ...(producerCommandsByReadModelId.get(preferredReadModelId) ?? []),
            command
        ]));
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
        selectForField(field) {
            return readModelSelectForFieldSource(field, selectableReadModelsByFieldSource);
        },
        historyPrefillForField(command, ownerReadModel, field, ownerFields) {
            return historyPrefillForField(readModelInfos, command, ownerReadModel, field, ownerFields);
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

function preferredReadModelForCommand(command, transitionsByCommandId, commandContextsById, readModelInfos) {
    const transition = transitionForCommand(command, transitionsByCommandId);
    const ownerTitle = cleanTitle(
        transition?.owner?.title
        ?? transition?.owner?.name
        ?? command.concept
        ?? command.concepts?.[0]
        ?? command.aggregateName
        ?? command.aggregate
    );
    if (!ownerTitle) {
        return null;
    }

    const commandContext = transition?.context ?? commandContextsById.get(commandKey(command)) ?? (command.id ? commandContextsById.get(command.id) : undefined);
    const ownerKey = normalizeOwnerKey(ownerTitle);
    return readModelInfos.find((info) => {
        const sameContext = !commandContext || !info.context || info.context === commandContext;
        return sameContext && normalizeOwnerKey(info.aggregate.title) === ownerKey;
    }) ?? null;
}

function transitionForCommand(command, transitionsByCommandId) {
    return transitionsByCommandId.get(commandKey(command))
        ?? (command.id ? transitionsByCommandId.get(command.id) : undefined)
        ?? transitionsByCommandId.get(String(command.name ?? ''))
        ?? transitionsByCommandId.get(String(command.title ?? ''));
}

function normalizeOwnerKey(value) {
    return cleanTitle(value).replace(/\s+/g, '').toLowerCase();
}

function readModelFieldSourceKeys(readModel, idField) {
    return unique([
        readModel.id,
        readModel.name,
        readModel.title,
        cleanTitle(readModel.title)
    ].filter(Boolean)).flatMap((readModelKey) => [
        `${readModelKey}.${idField}`,
        `${cleanTitle(readModelKey)}.${idField}`,
        `${pascal(cleanTitle(readModelKey))}.${idField}`
    ]);
}

function readModelSelectForFieldSource(field, selectableReadModelsByFieldSource) {
    const sources = normalizeArray(field?.source?.from);
    for (const source of sources) {
        const select = selectableReadModelsByFieldSource.get(String(source));
        if (select) {
            return select;
        }
    }
    return null;
}

function historyPrefillForField(readModelInfos, command, ownerReadModel, field, ownerFields) {
    if (!field?.list) {
        return null;
    }

    const selectSource = normalizeArray(field?.source?.from)[0];
    const valueField = singularFieldName(field.name);
    if (!selectSource || !valueField || valueField === field.name) {
        return null;
    }

    const ownerFieldNames = new Set((ownerReadModel?.fields ?? []).map((ownerField) => ownerField.name));
    const contextFields = ownerFields
        .filter((ownerField) => !ownerField.list)
        .filter((ownerField) => ownerFieldNames.has(ownerField.name))
        .filter((ownerField) => ownerField.name !== valueField)
        .filter((ownerField) => isLikelyContextField(ownerField));
    if (contextFields.length === 0) {
        return null;
    }

    const candidates = readModelInfos
        .filter(({readModel}) => readModel?.id !== ownerReadModel?.id)
        .map(({readModel, aggregate, deployment}) => {
            const fields = normalizeFields(readModel.fields);
            const fieldNames = new Set(fields.map((candidateField) => candidateField.name));
            const contextField = contextFields.find((candidateField) => fieldNames.has(candidateField.name));
            if (!contextField || !fieldNames.has(valueField)) {
                return null;
            }

            return {
                resource: snake(cleanTitle(readModel.title)),
                dataProviderName: deployment.dataProviderName,
                contextField: contextField.name,
                valueField,
                meta: {
                    tableName: tableName(readModel, cleanTitle(readModel.title)),
                    idField: idFieldName(readModel),
                    label: cleanTitle(readModel.title),
                    aggregateRoute: axonRoute(aggregate.title),
                    queryRoute: axonRoute(readModel.title),
                    queryFields: unique([
                        ...queryFieldsForReadModel(readModel),
                        contextField.name,
                        valueField
                    ])
                },
                score: historyPrefillScore(command, readModel, valueField, contextField.name, selectSource)
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best || best.score <= 0) {
        return null;
    }

    return best;
}

function singularFieldName(name) {
    const value = String(name ?? '');
    if (value.endsWith('ies')) return `${value.slice(0, -3)}y`;
    if (value.endsWith('ses')) return value.slice(0, -2);
    if (value.endsWith('s')) return value.slice(0, -1);
    return value;
}

function isLikelyContextField(field) {
    return field.idAttribute || /id$/i.test(field.name) || /code$/i.test(field.name);
}

function historyPrefillScore(command, readModel, valueField, contextField, selectSource) {
    const haystack = [
        command?.title,
        command?.name,
        readModel?.title,
        readModel?.name,
        valueField,
        contextField,
        selectSource
    ].filter(Boolean).join(' ').toLowerCase();
    let score = 1;
    if (haystack.includes(valueField.toLowerCase())) score += 2;
    if (haystack.includes(contextField.toLowerCase())) score += 2;
    if ((readModel?.dependencies ?? []).some((dependency) => dependencyDirection(dependency) === 'INBOUND' && dependency.elementType === 'EVENT')) score += 1;
    return score;
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

function commandsReactingToEvent(commandsById, event) {
    const eventKeys = new Set([
        event.id,
        event.name,
        event.title,
        cleanTitle(event.title)
    ].filter(Boolean).map(String));
    const commands = uniqueElements(Array.from(commandsById.values()));
    return commands.filter((command) => (command.dependencies ?? [])
        .filter((dependency) => dependencyDirection(dependency) === 'INBOUND' && dependency.elementType === 'EVENT')
        .some((dependency) => [
            dependency.id,
            dependency.name,
            dependency.title,
            cleanTitle(dependency.title)
        ].filter(Boolean).some((key) => eventKeys.has(String(key)))));
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

            const select = workflow.selectForField(field) ?? workflow.selectableReadModels.get(field.name);
            if (select && !field.idAttribute && (hasExplicitReadModelSource(field) || isReferenceSelectField(field))) {
                selects.set(field.name, select);
            }

            const dictionarySelect = workflow.dictionaryValueSelect(field.dictionary);
            if (dictionarySelect && !field.idAttribute && !isJsonField(field)) {
                selects.set(field.name, dictionarySelect);
            }
        });

    return { prefill, selects };
}

function hasExplicitReadModelSource(field) {
    return normalizeArray(field?.source?.from).length > 0;
}

function stateControlForTransition(transition, readModel) {
    const allowedStates = normalizeArray(transition?.from).filter(Boolean);
    const conceptName = transition?.owner?.name ?? transition?.owner?.title;
    return {
        allowedStates,
        targetState: transition?.to,
        stateField: allowedStates.length > 0 ? stateFieldForReadModel(readModel, conceptName, transition) : undefined
    };
}

function stateFieldForReadModel(readModel, conceptName, transition) {
    const fields = normalizeFields(readModel?.fields ?? []);
    const conceptStateType = conceptName ? `${conceptName}.State` : undefined;
    const workflowStateTokens = workflowTokensForTransition(transition);
    const statusFields = fields.filter((field) => /Status$/.test(field.name ?? ''));
    const candidates = [
        fields.find((field) => conceptStateType && field.type === conceptStateType),
        fields.find((field) => field.name === 'state'),
        fields.find((field) => conceptName && field.name === `${camel(conceptName)}State`),
        fields.find((field) => conceptName && field.name === `${camel(conceptName)}Status`),
        statusFields.find((field) => workflowStateTokens.some((token) => statusFieldMatchesToken(field.name, token))),
        statusFields[0],
        fields.find((field) => field.name === 'status')
    ];
    return candidates.filter(Boolean)[0]?.name;
}

function workflowTokensForTransition(transition) {
    return unique([
        ...normalizeArray(transition?.from),
        transition?.to
    ].filter(Boolean)
        .flatMap(splitWorkflowStateName)
        .map((token) => token.toLowerCase())
        .filter((token) => token.length >= 4)
        .filter((token) => !['state', 'status', 'completed', 'failed'].includes(token)));
}

function splitWorkflowStateName(value) {
    return String(value)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function statusFieldMatchesToken(fieldName, token) {
    const normalized = String(fieldName ?? '').toLowerCase();
    if (normalized.includes(token)) {
        return true;
    }
    if (token.startsWith('approv') && normalized.includes('approval')) {
        return true;
    }
    return false;
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
