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

function resultEventArgument(field, command, resultVariable) {
    const commandField = (command.fields ?? []).find((candidate) => candidate.name === field.name);
    const commandArgument = () => {
        if (field.optional || !commandField.optional) return `${field.name} = command.${field.name}`;
        return `${field.name} = command.${field.name} ?: ${fallbackValue(field)} /* TODO: provide non-null ${field.name} */`;
    };
    if (field.idAttribute || field.technicalAttribute) {
        if (commandField) return commandArgument();
    }
    if (field.name === 'failureReason') {
        if (commandField) return commandArgument();
        return `${field.name} = "${escapeKotlin(command.title ?? command.name ?? 'Command')} rejected."`;
    }
    if (field.name === 'failedAt' || field.name === 'verifiedAt') {
        return `${field.name} = ${resultVariable}.${field.name}`;
    }
    return `${field.name} = ${resultVariable}.${field.name}`;
}

function unavailableEventArgument(field, command, resultVariable, fallbackTime = 'now') {
    const commandField = (command.fields ?? []).find((candidate) => candidate.name === field.name);
    if (field.name === 'failedAt' || field.name === 'verifiedAt') return `${field.name} = ${fallbackTime}`;
    if (field.name === 'failureReason') return `${field.name} = ${resultVariable}.failureReason`;
    if (field.name === 'remediationHint') return `${field.name} = ${resultVariable}.remediationHint`;
    if (commandField) {
        if (field.optional || !commandField.optional) return `${field.name} = command.${field.name}`;
        return `${field.name} = command.${field.name} ?: ${fallbackValue(field)} /* TODO: provide non-null ${field.name} */`;
    }
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
            ...fields.map((field) => `    private var ${field.name}: ${stateFieldType(field)} = ${stateFieldDefault(field)}`),
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
                ...(concept && stateTransition && !transition && conceptHasState(this.model, slice.context, concept, stateTransition.to) ? [`        currentState = ${stateEnumName}.${constant(stateTransition.to)}`] : []),
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
        const methods = slice.commands.map((command) => {
            const commandName = _commandTitle(command.title);
            const outputs = outboundEvents(command, events);
            const port = infrastructurePortForCommand(command, events, slice, this.model);
            const usePort = Boolean(port);
            const capability = port?.capability;
            const commandReservations = commandStartsLifecycle(command) ? reservations : [];
            const includeState = !commandStartsLifecycle(command);
            const stateParam = includeState ? `, state: ${stateName}` : '';
            const reservationParams = commandReservations.map((reservation) => `, ${reservation.stateParam}: ${reservation.stateName}`).join('');
            const portParams = usePort ? `, portResult: ${capability.resultName}, now: java.time.LocalDateTime` : '';
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
            const eventLines = [
                ...reservationEvents,
                ...outputs.map((event) => `            ${_eventTitle(event.title)}(${eventArguments(event, command, selection)})`)
            ];
            const returnStatement = usePort
                ? (() => {
                    const success = port.successEvent;
                    const failure = port.failureEvent;
                    const successArgs = success.fields.map((field) => resultEventArgument(field, command, 'portResult')).join(', ');
                    const failureArgs = failure.fields.map((field) => resultEventArgument(field, command, 'portResult')).join(', ');
                    const unavailableArgs = failure.fields.map((field) => unavailableEventArgument(field, command, 'portResult')).join(', ');
                    return [
                        'return when (portResult) {',
                        `            is ${capability.resultName}.Succeeded -> listOf(${_eventTitle(success.title)}(${successArgs}))`,
                        `            is ${capability.resultName}.Rejected -> listOf(${_eventTitle(failure.title)}(${failureArgs}))`,
                        `            is ${capability.resultName}.Unavailable -> listOf(${_eventTitle(failure.title)}(${unavailableArgs}))`,
                        '        }'
                    ].join('\n        ');
                })()
                : outputs.length > 0
                    ? `return listOf(\n${eventLines.join(',\n')}\n        )`
                    : 'return emptyList() // TODO: return the event produced by this command.';
            return `    fun decide(command: ${commandName}${stateParam}${reservationParams}${portParams}): List<Any> {\n${guard}${reservationGuard ? `${reservationGuard}\n` : ''}        ${returnStatement}\n    }`;
        }).join('\n\n');
        const commandImports = slice.commands.map((command) => `import ${packageName}.${_commandTitle(command.title)}`).join('\n');
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

import org.springframework.stereotype.Component
${commandImports}
${portImports}
${eventImports}
${stateImport}
${reservationStateImports}
${stateEnumImports}
${fieldOptionImports}

@Component
class ${decisionName} {
${methods}
}
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
