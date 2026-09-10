/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {
    selectionFor,
    uniqueReservationsForSlice,
    parseUniqueExpression,
    reservationForUniqueExpression,
    uniqueFieldLabel,
    normalizedFieldExpression,
    conceptSelectionFor,
    sliceSelectionFor,
    explicitConsistencyTags,
    selectionFromTags,
    commandFieldsWithSelection,
    fieldsWithSelection,
    eventFieldsWithTags,
    eventTagFieldsFor,
    injectEntityExpression,
    uniqueTags,
    commandIdFields,
    fallbackTags,
    selectionTargetFor,
    stateTargetFor,
    relatedStateForCommand,
    primaryConcept,
    childStateTransitions,
    childTransitionKeyField,
    tagSource,
    renderTagExpression,
    compositeKeyExpression,
    renderDerivedEventTags,
    derivedEventTagProperty,
    relatedEventsForSlice,
    outboundEvents,
    transitionForCommand,
    commandStartsLifecycle,
    conceptStateEnumName,
    conceptHasState,
    transitionUsesConceptState,
    renderStateGuard,
    eventFanOut,
    eventArguments,
    fallbackValue,
    nullableType,
    stateFieldType,
    stateFieldDefault,
    readModelStorageImports,
    readModelStorageField,
    readModelStorageType,
    readModelStorageFieldType,
    readModelStorageFieldDefault,
    readModelStorageExpression,
    isScalarValueTypeField,
    valueTypeForField,
    METADATA_FIELD_DEFINITIONS,
    readModelMetadataFields,
    readModelMetadataParameters,
    readModelMetadataAssignments,
    mappedType,
    kotlinFieldImports,
    kotlinEnumImports,
    isJpaEnumField,
    uniqueFields,
    uniqueBy,
    groupByMap,
    stringList,
    pascal,
    kebab,
    safeDatabaseName,
    safeIdentifier,
    httpRoute,
    constant,
    kotlinPrimitive,
    kotlinImports,
    renderScalarValueType,
    renderEnum,
    renderObjectValueType,
    renderValidation,
    literal,
    escapeKotlin,
    filterModelByDeployment
} = require('./model-helpers');
const {contextPackage} = require('../../common/util/value-types');
const {_commandTitle, _eventTitle, _readmodelTitle, _sliceTitle} = require('../../common/util/naming');
const {infrastructurePortForCommand} = require('./infrastructure-port-writer');

function normalizeOutcomeName(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function semanticOutcomeWords(value) {
    const synonyms = {
        failure: 'failed',
        fail: 'failed',
        fails: 'failed',
        failing: 'failed',
        installation: 'deployment',
        installed: 'deployment',
        install: 'deployment',
        succeeded: 'ready',
        success: 'ready',
        established: 'connected'
    };
    return String(value ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.toLowerCase())
        .map((word) => synonyms[word] ?? word);
}

function bestStateForEvent(event, states) {
    const eventName = normalizeOutcomeName(`${event.name} ${event.title}`);
    const direct = states.find((state) => eventName.includes(normalizeOutcomeName(state)));
    if (direct) {
        return direct;
    }

    const eventWords = semanticOutcomeWords(`${event.name} ${event.title}`);
    const ranked = states
        .map((state) => {
            const stateWords = semanticOutcomeWords(state);
            const overlap = stateWords.filter((word) => eventWords.includes(word)).length;
            const extraStateWords = stateWords.filter((word) => !eventWords.includes(word)).length;
            return {
                state,
                score: overlap * 3 - extraStateWords
            };
        })
        .sort((left, right) => right.score - left.score || left.state.length - right.state.length);
    return ranked[0]?.score > 0 ? ranked[0].state : undefined;
}

function selectionTagValueExpression(field) {
    const value = `selection.${field.alias}`;
    return valueTypeForField(field)?.kind === 'scalar'
        ? `${value}.value.toString()`
        : `${value}.toString()`;
}

function stateEventsForSlice(model, slice, events) {
    const concept = primaryConcept(slice);
    if (!concept) return events;
    return uniqueBy((model.slices ?? [])
        .filter((candidate) => candidate.context === slice.context && primaryConcept(candidate) === concept)
        .flatMap((candidate) => relatedEventsForSlice(model, candidate)), (event) => event.id ?? event.name);
}

function stateFieldsBeforeCommand(model, slice, command, events, selection = {fields: []}) {
    const outputIds = new Set(outboundEvents(command, events).map((event) => event.id));
    return fieldsWithSelection(uniqueFields(stateEventsForSlice(model, slice, events)
        .filter((event) => !outputIds.has(event.id))
        .flatMap((event) => event.fields ?? [])), selection.fields ?? []);
}

function renderStateEventArgument(field, source) {
    if (field.optional) return `${field.name} = state.${source.name}`;
    return `${field.name} = requireNotNull(state.${source.name}) { "${field.name} is required from state." }`;
}

function stateFieldForEventField(field, stateFields) {
    const sameName = stateFields.find((candidate) => candidate.name === field.name);
    if (sameName) return sameName;
    const source = field.source?.from?.find((name) => {
        const sourceName = String(name).split('.').pop();
        return stateFields.some((candidate) => candidate.name === sourceName);
    });
    return source ? stateFields.find((candidate) => candidate.name === String(source).split('.').pop()) : undefined;
}

function shouldReadPortEventFieldFromState(field) {
    return Boolean(field.source?.from?.length || field.source?.rule || field.idAttribute);
}

function resultEventArgument(field, command, resultVariable, selection = {fields: []}, stateFields = []) {
    const commandField = commandFieldsWithSelection(command, selection).find((candidate) => candidate.name === field.name);
    const commandArgument = () => {
        if (field.optional || !commandField.optional) return `${field.name} = command.${field.name}`;
        return `${field.name} = command.${field.name} ?: ${fallbackValue(field)} /* TODO: provide non-null ${field.name} */`;
    };
    if (field.portOutput) {
        return `${field.name} = ${resultVariable}.${field.name}`;
    }
    if (field.name === 'failureReason') {
        return `${field.name} = ${resultVariable}.failureReason`;
    }
    if (field.name === 'failedAt' || field.name === 'verifiedAt') {
        return `${field.name} = ${resultVariable}.${field.name}`;
    }
    if (commandField) return commandArgument();
    const stateField = shouldReadPortEventFieldFromState(field) ? stateFieldForEventField(field, stateFields) : undefined;
    if (stateField) return renderStateEventArgument(field, stateField);
    return `${field.name} = ${resultVariable}.${field.name}`;
}

function unavailableEventArgument(field, command, resultVariable, fallbackTime = 'now', selection = {fields: []}, stateFields = []) {
    const commandField = commandFieldsWithSelection(command, selection).find((candidate) => candidate.name === field.name);
    if (field.name === 'failedAt' || field.name === 'verifiedAt') return `${field.name} = ${fallbackTime}`;
    if (field.name === 'failureReason') return `${field.name} = ${resultVariable}.failureReason`;
    if (field.name === 'remediationHint') return `${field.name} = ${resultVariable}.remediationHint`;
    if (commandField) {
        if (field.optional || !commandField.optional) return `${field.name} = command.${field.name}`;
        return `${field.name} = command.${field.name} ?: ${fallbackValue(field)} /* TODO: provide non-null ${field.name} */`;
    }
    const stateField = shouldReadPortEventFieldFromState(field) ? stateFieldForEventField(field, stateFields) : undefined;
    if (stateField) return renderStateEventArgument(field, stateField);
    if (field.optional) return `${field.name} = null`;
    return `${field.name} = ${fallbackValue(field)} /* TODO: provide ${field.name} */`;
}

const stateWriterMethods = {
    _writeEvent(event, ownerSlice, selection) {
        const eventSlice = this.model.slices.find((slice) => slice.title === event.slice || slice.name === event.slice) ?? ownerSlice;
        const context = contextPackage(eventSlice.context);
        const packageName = `${this.model.rootPackage}.${context}.events`;
        const eventName = _eventTitle(event.title);
        const eventTagFields = eventTagFieldsFor(ownerSlice, event, selection, true);
        const eventFields = eventFieldsWithTags(event.fields ?? [], eventTagFields);
        const imports = kotlinFieldImports(eventFields, this.model.rootPackage);
        const annotated = new Set();
        const properties = eventFields.map((field) => {
            const annotations = (field.eventTagKeys ?? []).map((tagName) => {
                annotated.add(tagName);
                return `    @EventTag(key = "${escapeKotlin(tagName)}")`;
            }).join('\n');
            const defaultValue = field.defaultValue ? ` = ${field.defaultValue}` : '';
            return `${annotations ? `${annotations}\n` : ''}    val ${field.name}: ${mappedType(field, field.optional)}${defaultValue}`;
        }).join(',\n');
        const expectedTags = uniqueTags(selection.tags ?? []);
        const unresolved = expectedTags.filter((tag) => !annotated.has(tag.name));
        const note = unresolved.length
            ? `\n/* TODO: provide values for selection tags: ${unresolved.map((tag) => tag.expression ? `${tag.name} = ${tag.expression}` : tag.name).join(', ')} */\n`
            : '\n';
        this.fs.write(this._kotlinPath(`${context}/events/${eventName}.kt`), `package ${packageName}

import org.axonframework.eventsourcing.annotation.EventTag
import org.axonframework.messaging.eventhandling.annotation.Event
${imports}
${note}
@Event
data class ${eventName}(
${properties}
)
`);
    },

    _writeState(packageName, context, slicePackage, slice, selection, events, overrideStateName, childTransitions = []) {
        const stateName = overrideStateName ?? `${pascal(slice.name)}State`;
        const concept = primaryConcept(slice);
        const childTransitionByEventId = new Map(childTransitions.map((transition) => [transition.eventId, transition]));
        const transitionByEventId = new Map((this.model.transitions ?? [])
            .filter((transition) => transition.owner?.name === concept)
            .filter((transition) => transition.event?.id)
            .map((transition) => [transition.event.id, transition]));
        const hasChildMemberState = childTransitions.length > 0;
        const childTransitionKeyFields = new Set(childTransitions.map((transition) => transition.keyField).filter(Boolean));
        const fields = uniqueFields(events.flatMap((event) => event.fields))
            .filter((field) => !(hasChildMemberState && childTransitionKeyFields.has(field.name)));
        const imports = kotlinFieldImports(uniqueFields([...fields, ...(selection.fields ?? [])]), this.model.rootPackage);
        const stateEnumName = concept ? conceptStateEnumName(concept) : undefined;
        const stateFields = [
            ...(concept ? [`    var currentState: ${stateEnumName}? = null`] : []),
            ...fields.map((field) => `    var ${field.name}: ${stateFieldType(field)} = ${stateFieldDefault(field)}`),
            ...(hasChildMemberState ? ['    private val members: MutableMap<String, String> = mutableMapOf()'] : [])
        ].join('\n');
        const sourcingHandlers = events.map((event) => {
            const transition = childTransitionByEventId.get(event.id);
            const stateTransition = transitionByEventId.get(event.id);
            const inferredState = concept && !stateTransition
                ? bestStateForEvent(event, (this.model.concepts ?? [])
                    .find((candidate) => candidate.name === concept && (!slice.context || candidate.context === slice.context))
                    ?.states
                    ?? [])
                : undefined;
            const assignments = [
                ...(concept && stateTransition && stateTransition.from !== stateTransition.to && !transition && conceptHasState(this.model, slice.context, concept, stateTransition.to) ? [`        currentState = ${stateEnumName}.${constant(stateTransition.to)}`] : []),
                ...(concept && inferredState && !transition ? [`        currentState = ${stateEnumName}.${constant(inferredState)}`] : []),
                ...event.fields
                    .filter((field) => !(transition?.keyField && field.name === transition.keyField))
                    .map((field) => `        ${field.name} = event.${field.name}`),
                ...(transition?.keyField ? [`        members[event.${transition.keyField}.toString()] = "${escapeKotlin(transition.to)}"`] : [])
            ].join('\n');
            return `    @EventSourcingHandler\n    fun evolve(event: ${_eventTitle(event.title)}): ${stateName} = apply {\n${assignments}\n    }`;
        }).join('\n\n');
        const eventImports = events.map((event) => `import ${this._eventPackage(event, slice)}.${_eventTitle(event.title)}`).join('\n');
        const stateImport = concept ? `import ${this.model.rootPackage}.${contextPackage(slice.context)}.domain.states.${stateEnumName}\n` : '';
        const singleTag = selection.fields.length === 1;
        const tagOwner = pascal(selection.metadataOwner ?? slice.name);
        const idType = singleTag ? selection.fields[0].selectionType.replace(/\?$/, '') : undefined;
        const entityAnnotation = singleTag
            ? `@EventSourced(idType = ${idType}::class, tagKey = ${tagOwner}Tags.${constant(selection.fields[0].tag.name)})`
            : `@EventSourced(idType = ${selection.name}::class)`;
        const criteria = selection.fields
            .map((field) => `EventCriteria.havingTags(Tag.of(${tagOwner}Tags.${constant(field.tag.name)}, ${selectionTagValueExpression(field)}))`)
            .join(',\n                ');
        const criteriaFunction = singleTag
            ? ''
            : `    companion object {
        @JvmStatic
        @EventCriteriaBuilder
        fun resolveCriteria(selection: ${selection.name}): EventCriteria = EventCriteria.either(
                ${criteria}
        )
    }

`;
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${stateName}.kt`), `package ${packageName}

import org.axonframework.eventsourcing.annotation.EventCriteriaBuilder
import org.axonframework.eventsourcing.annotation.EventSourcingHandler
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator
import org.axonframework.extension.spring.stereotype.EventSourced
import org.axonframework.messaging.eventstreaming.EventCriteria
import org.axonframework.messaging.eventstreaming.Tag
${eventImports}
${stateImport}
${imports}

${entityAnnotation}
class ${stateName} @EntityCreator constructor() {
${criteriaFunction}
${stateFields}

${sourcingHandlers}
}
`);
    },

    _writeDecision(packageName, context, slicePackage, slice, selection, events, reservations = []) {
        const stateTarget = stateTargetFor(this.model, slice);
        const stateName = stateTarget.name;
        const decisionName = `${pascal(slice.name)}Decision`;
        const decisionComponentName = `${decisionName}Component`;
        const methodDefinitions = slice.commands.map((command) => {
            const commandName = _commandTitle(command.title);
            const outputs = outboundEvents(command, events);
            const port = infrastructurePortForCommand(command, events, slice, this.model);
            const usePort = Boolean(port);
            const capability = port?.capability;
            const commandReservations = commandStartsLifecycle(command) ? reservations : [];
            const relatedState = relatedStateForCommand(this.model, slice, command, events);
            const includeState = !commandStartsLifecycle(command) || Boolean(relatedState);
            const commandStateTarget = relatedState?.stateTarget ?? stateTarget;
            const stateParam = includeState ? `, state: ${commandStateTarget.name}` : '';
            const reservationParams = commandReservations.map((reservation) => `, ${reservation.stateParam}: ${reservation.stateName}`).join('');
            const portParams = usePort ? `, portResult: ${capability.resultName}${port.failureEvent ? ', now: java.time.LocalDateTime' : ''}` : '';
            const readableStateFields = includeState
                ? stateFieldsBeforeCommand(this.model, relatedState?.slice ?? slice, command, events, selection)
                : [];
            const reservationGuard = commandReservations.map((reservation) => [
                `        require(!${reservation.stateParam}.reserved) {`,
                `            "${escapeKotlin(reservation.message)}"`,
                '        }'
            ].join('\n')).join('\n');
            const reservationEvents = commandReservations.map((reservation) =>
                `            ${reservation.eventName}(${reservation.eventArgs.join(', ')})`
            );
            const transition = transitionForCommand(this.model, command);
            const guard = commandStartsLifecycle(command) ? '' : `${renderStateGuard(this.model, transition)}\n`;
            const eventExpressions = [
                ...reservationEvents.map((expression) => ({kind: 'single', expression})),
                ...outputs.map((event) => {
                    const fanOut = eventFanOut(event, command, selection, slice);
                    if (!fanOut) {
                        return {
                            kind: 'single',
                            expression: `${_eventTitle(event.title)}(${eventArguments(event, command, selection, readableStateFields, {}, slice)})`
                        };
                    }
                    return {
                        kind: 'many',
                        expression: `command.${fanOut.source.name}.map { ${fanOut.field.name} ->
                ${_eventTitle(event.title)}(${eventArguments(event, command, selection, readableStateFields, {[fanOut.field.name]: fanOut.field.name}, slice)})
            }`
                    };
                })
            ];
            const renderEventReturn = () => {
                if (eventExpressions.length === 0) {
                    return 'return emptyList() // TODO: return the event produced by this command.';
                }
                if (eventExpressions.length === 1 && eventExpressions[0].kind === 'many') {
                    return `return ${eventExpressions[0].expression}`;
                }
                if (eventExpressions.every((expression) => expression.kind === 'single')) {
                    return `return listOf(\n${eventExpressions.map((item) => `            ${item.expression}`).join(',\n')}\n        )`;
                }
                return `return buildList<Any> {
${eventExpressions.map((item) => item.kind === 'single'
                    ? `            add(${item.expression})`
                    : `            addAll(${item.expression})`).join('\n')}
        }`;
            };
            const returnStatement = usePort
                ? (() => {
                    const success = port.successEvent;
                    const failure = port.failureEvent;
                    const successFields = eventFieldsWithTags(success.fields ?? [], eventTagFieldsFor(slice, success, selection, true));
                    const successArgs = successFields.map((field) => resultEventArgument(field, command, 'portResult', selection, readableStateFields)).join(', ');
                    const successEvents = [
                        ...reservationEvents,
                        `            ${_eventTitle(success.title)}(${successArgs})`
                    ];
                    if (!failure) {
                        return [
                            'return when (portResult) {',
                            `            is ${capability.resultName}.Succeeded -> listOf(\n${successEvents.join(',\n')}\n            )`,
                            '        }'
                        ].join('\n        ');
                    }
                    const failureFields = eventFieldsWithTags(failure.fields ?? [], eventTagFieldsFor(slice, failure, selection, true));
                    const failureArgs = failureFields.map((field) => resultEventArgument(field, command, 'portResult', selection, readableStateFields)).join(', ');
                    const unavailableArgs = failureFields.map((field) => unavailableEventArgument(field, command, 'portResult', 'now', selection, readableStateFields)).join(', ');
                    return [
                        'return when (portResult) {',
                        `            is ${capability.resultName}.Succeeded -> listOf(\n${successEvents.join(',\n')}\n            )`,
                        `            is ${capability.resultName}.Rejected -> listOf(${_eventTitle(failure.title)}(${failureArgs}))`,
                        `            is ${capability.resultName}.Unavailable -> listOf(${_eventTitle(failure.title)}(${unavailableArgs}))`,
                        '        }'
                    ].join('\n        ');
                })()
                : renderEventReturn();
            const signature = `fun decide(command: ${commandName}${stateParam}${reservationParams}${portParams}): List<Any>`;
            const implementation = `    ${signature} {\n${guard}${reservationGuard ? `${reservationGuard}\n` : ''}        ${returnStatement}\n    }`;
            return {signature, implementation};
        });
        const interfaceMethods = methodDefinitions.map((method) => method.implementation).join('\n\n');
        const commandImports = slice.commands.map((command) => `import ${packageName}.${_commandTitle(command.title)}`).join('\n');
        const relatedStateImports = uniqueBy(slice.commands
            .map((command) => relatedStateForCommand(this.model, slice, command, events)?.stateTarget)
            .filter((target) => target && target.packageName !== packageName)
            .map((target) => `import ${target.packageName}.${target.name}`), (value) => value)
            .join('\n');
        const portImports = uniqueBy(slice.commands
            .map((command) => {
                const port = infrastructurePortForCommand(command, events, slice, this.model);
                return port ? `import ${port.packageName}.${port.capability.resultName}` : undefined;
            })
            .filter(Boolean), (value) => value)
            .join('\n');
        const eventImports = uniqueBy([
            ...events.map((event) => `import ${this._eventPackage(event, slice)}.${_eventTitle(event.title)}`),
            ...reservations.map((reservation) => `import ${this.model.rootPackage}.${context}.events.${reservation.eventName}`)
        ], (value) => value).join('\n');
        const stateImport = stateTarget.packageName === packageName ? '' : `import ${stateTarget.packageName}.${stateName}\n`;
        const reservationStateImports = reservations.map((reservation) => `import ${reservation.packageName}.${reservation.stateName}`).join('\n');
        const stateEnumImports = uniqueBy(slice.commands
            .map((command) => transitionForCommand(this.model, command))
            .filter((transition) => transitionUsesConceptState(this.model, transition))
            .map((transition) => `import ${this.model.rootPackage}.${contextPackage(transition.context ?? slice.context)}.domain.states.${conceptStateEnumName(transition.owner.name)}`), (value) => value)
            .join('\n');
        const fieldOptionImports = kotlinEnumImports(events.flatMap((event) => event.fields ?? []), this.model.rootPackage);
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${decisionName}.kt`), `package ${packageName}

${commandImports}
${relatedStateImports}
${portImports}
${eventImports}
${stateImport}
${reservationStateImports}
${stateEnumImports}
${fieldOptionImports}

interface ${decisionName} {
${interfaceMethods}
}
`);

        const domainPackage = `${this.model.rootPackage}.domain.${context}.${slicePackage}`;
        this._writeCreateOnly(this._rootKotlinPath(`domain/${context}/${slicePackage}/${decisionComponentName}.kt`), `package ${domainPackage}

import org.springframework.stereotype.Component
import ${packageName}.${decisionName}

@Component
class ${decisionComponentName} : ${decisionName}
`);
    },

    _writeConceptEntityStates(slices) {
        const groups = groupByMap(slices.filter((slice) => primaryConcept(slice) && slice.commands.length > 0), (slice) => primaryConcept(slice));
        for (const [, conceptSlices] of groups.entries()) {
            const first = conceptSlices[0];
            const selection = selectionFor(first, this.model);
            const target = stateTargetFor(this.model, first);
            const context = contextPackage(first.context);
            const conceptPackage = _sliceTitle(primaryConcept(first));
            const packageName = target.packageName;
            const events = uniqueBy(
                conceptSlices.flatMap((slice) => relatedEventsForSlice(this.model, slice)),
                (event) => event.id ?? `${event.slice}:${event.name}`
            );
            const childTransitions = [];
            this._writeState(packageName, context, conceptPackage, first, selection, events, target.name, childTransitions);
        }
    },
};

module.exports = {stateWriterMethods};
