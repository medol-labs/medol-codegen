/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {
    commandFieldsWithSelection,
    fallbackValue,
    httpRoute,
    kotlinFieldImports,
    mappedType,
    pascal,
    kebab,
    selectionFor,
    eventFieldsWithTags,
    eventTagFieldsFor,
    escapeKotlin,
    safeIdentifier,
    uniqueBy
} = require('./model-helpers');
const {automationProcessingGroup, integrationProcessingGroup} = require('./axon-processing');
const {contextPackage, valueTypeImport} = require('../../common/util/value-types');
const {_commandTitle, _eventTitle, _readmodelTitle, _sliceTitle} = require('../../common/util/naming');

function lowerCamel(value) {
    const name = pascal(value);
    return safeIdentifier(name.charAt(0).toLowerCase() + name.slice(1));
}

function allSlices(generator) {
    return generator.fullModel?.slices ?? generator.model.slices ?? [];
}

function deploymentForContext(generator, contextName) {
    return (generator.fullModel?.deployments ?? generator.model.deployments ?? [])
        .find((deployment) => (deployment.contexts ?? []).some((context) => context.name === contextName));
}

function findCommand(generator, commandId) {
    for (const slice of allSlices(generator)) {
        const command = (slice.commands ?? []).find((candidate) => candidate.id === commandId);
        if (command) return {slice, command};
    }
    return null;
}

function findCommandByName(generator, commandName) {
    const expected = String(commandName ?? '').toLowerCase();
    for (const slice of allSlices(generator)) {
        const command = (slice.commands ?? []).find((candidate) =>
            String(candidate.name ?? '').toLowerCase() === expected
            || String(candidate.title ?? '').toLowerCase() === expected
        );
        if (command) return {slice, command};
    }
    return null;
}

function findEvent(generator, eventId) {
    for (const slice of allSlices(generator)) {
        const event = (slice.events ?? []).find((candidate) => candidate.id === eventId);
        if (event) return {slice, event};
    }
    return null;
}

function findReadModel(generator, readmodelId) {
    for (const slice of allSlices(generator)) {
        const readmodel = (slice.readmodels ?? []).find((candidate) => candidate.id === readmodelId);
        if (readmodel) return {slice, readmodel};
    }
    return null;
}

function isDataExportExecutionAutomation(processor) {
    const metadata = processor.metadata ?? {};
    const uses = String(metadata.uses ?? '').toLowerCase();
    const emits = Object.entries(metadata)
        .filter(([key]) => /^emits\d*$/.test(key))
        .map(([, value]) => String(value).toLowerCase());
    return metadata.on === 'DataExportRequested'
        && (uses === 'platformdataexchange.export' || uses.endsWith('dataexchange.export'))
        && emits.includes('markdataexportprocessing')
        && emits.includes('completedataexport')
        && emits.includes('faildataexport');
}

function dependency(processor, direction, elementType) {
    return (processor.dependencies ?? []).find((candidate) =>
        candidate.direction === direction && candidate.elementType === elementType
    );
}

function sourceFieldMatch(field, sourceFields) {
    const source = field.source?.from?.find((name) => {
        const sourceField = sourceFields.get(String(name).split('.').pop());
        return sourceField && fieldsCompatible(field, sourceField);
    });
    const sourceName = source ? String(source).split('.').pop() : field.name;
    const sourceField = sourceFields.get(sourceName);
    if (sourceField && fieldsCompatible(field, sourceField)) {
        return {sourceName, sourceField};
    }
    return null;
}

function fanOutFieldExpression(field, fanOut) {
    if (!fanOut?.alias || !fanOut?.itemParameter) return null;
    const source = field.source?.from?.find((name) => String(name).startsWith(`${fanOut.alias}.`));
    if (!source) return null;
    const parts = String(source).split('.');
    if (parts.length < 2) return null;
    return `${fanOut.itemParameter}.${parts.slice(1).join('.')}`;
}

function sourceFieldNullable(field, readModelSource = false) {
    if (field.optional) return true;
    return readModelSource && field.cardinality !== 'Many';
}

function commandExpression(command, sourceElement, sourceParameter = 'event', selection = {fields: []}, readModelSource = false, fanOut = null) {
    const sourceFields = new Map((sourceElement.fields ?? []).map((field) => [field.name, field]));
    const args = commandFieldsWithSelection(command, selection).flatMap((field) => {
        const fanOutExpression = fanOutFieldExpression(field, fanOut);
        if (fanOutExpression) {
            return [`${field.name} = ${fanOutExpression}`];
        }
        const match = sourceFieldMatch(field, sourceFields);
        if (match) {
            const value = sourceFieldNullable(match.sourceField, readModelSource) && !field.optional
                ? `${sourceParameter}.${match.sourceName}!!`
                : `${sourceParameter}.${match.sourceName}`;
            return [`${field.name} = ${value}`];
        }
        if (field.generated) return [];
        return [`${field.name} = ${fallbackValue(field)} /* TODO: provide ${field.name} */`];
    });
    return `${_commandTitle(command.title)}(${args.join(', ')})`;
}

function fanOutSourceExpression(processor, sourceElement, sourceParameter = 'event') {
    const source = processor.metadata?.fanOutSource;
    if (!source) return null;
    const sourceParts = String(source).split('.');
    const sourceName = sourceParts.length > 1 ? sourceParts.at(-1) : sourceParts[0];
    const sourceField = (sourceElement.fields ?? []).find((field) => field.name === sourceName);
    if (!sourceField) return null;
    const expression = `${sourceParameter}.${sourceName}`;
    return sourceField.optional ? `${expression}.orEmpty()` : expression;
}

function requiredSourcePredicates(command, sourceElement, sourceParameter = 'todo', selection = {fields: []}, readModelSource = false) {
    const sourceFields = new Map((sourceElement.fields ?? []).map((field) => [field.name, field]));
    return commandFieldsWithSelection(command, selection)
        .map((field) => ({field, match: sourceFieldMatch(field, sourceFields)}))
        .filter(({field, match}) => match && sourceFieldNullable(match.sourceField, readModelSource) && !field.optional)
        .map(({match}) => `${sourceParameter}.${match.sourceName} != null`);
}

function payloadExpression(command, event, eventParameter = 'event') {
    const eventFields = new Map((event.fields ?? []).map((field) => [field.name, field]));
    const args = commandFieldsWithSelection(command, {fields: []}).flatMap((field) => {
        const source = field.source?.from?.find((name) => {
            const sourceField = eventFields.get(String(name).split('.').pop());
            return sourceField && fieldsCompatible(field, sourceField);
        });
        const sourceName = source ? String(source).split('.').pop() : field.name;
        const sourceField = eventFields.get(sourceName);
        const value = sourceField && fieldsCompatible(field, sourceField)
            ? `${eventParameter}.${sourceName}`
            : `${fallbackValue(field)} /* TODO: provide ${field.name} */`;
        if (!sourceField && field.generated) return [];
        return [`${field.name} = ${value}`];
    });
    return `${commandRequestClass(command)}(${args.join(', ')})`;
}

function conditionExpression(processor, sourceElement, sourceParameter = 'todo') {
    const expression = processor.metadata?.condition;
    if (!expression) return 'true';
    const fieldNames = new Set((sourceElement.fields ?? []).map((field) => field.name));
    let unresolved = false;
    const rendered = String(expression).replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (token) => {
        if (token === 'true' || token === 'false' || token === 'null') return token;
        if (fieldNames.has(token)) return `${sourceParameter}.${token}`;
        if (/^[A-Z][A-Z0-9_]*$/.test(token)) return `"${token}"`;
        unresolved = true;
        return token;
    });
    if (unresolved) return 'false';
    return rendered;
}

function readModelRepositoryPageCall(readmodel) {
    const filterFields = (readmodel.fields ?? []).filter((field) => field.query);
    const nullFilters = filterFields.map(() => 'null');
    return filterFields.length > 0
        ? `findAllByFilter(${[...nullFilters, 'PageRequest.of(0, 100)'].join(', ')})`
        : 'findAll(PageRequest.of(0, 100))';
}

function defaultToastPolicy(severity) {
    const normalized = String(severity ?? '').toUpperCase();
    if (normalized === 'ERROR' || normalized === 'WARNING') return 'IMPORTANT';
    if (normalized === 'SUCCESS') return 'DEFAULT';
    return 'NONE';
}

function humanFallbackTitle(messageKey, eventName) {
    const key = String(messageKey ?? '').trim();
    if (key) {
        return key
            .split(/[._-]+/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }
    return String(eventName ?? 'Notification')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim() || 'Notification';
}

function notificationMessageKey(eventName) {
    return `notifications.${lowerCamel(eventName)}`;
}

function inferNotificationCategory(eventRef) {
    const text = `${eventRef.slice.context} ${eventRef.slice.name} ${eventRef.event.name}`.toLowerCase();
    if (text.includes('dataexport') || text.includes('dataimport') || text.includes('dataexchange')) return 'DATA_EXCHANGE';
    if (text.includes('training')) return 'TRAINING';
    if (text.includes('runtime')) return 'RUNTIME';
    return 'SYSTEM';
}

function inferNotificationSeverity(eventName) {
    const name = String(eventName ?? '');
    if (/(Failed|Failure|Rejected|Canceled|Cancelled|Error)$/i.test(name) || /(Failed|Failure|Rejected|Canceled|Cancelled|Error)/i.test(name)) return 'ERROR';
    if (/(Alert|Raised|Warning|Detected)$/i.test(name) || /(Alert|Warning|Detected)/i.test(name)) return 'WARNING';
    if (/(Completed|Succeeded|Success|Approved|Activated|Published|Created)$/i.test(name) || /(Completed|Succeeded|Success|Approved|Activated|Published|Created)/i.test(name)) return 'SUCCESS';
    return 'INFO';
}

function notificationTargetIdField(event) {
    return (event.fields ?? []).find((field) => field.id)
        ?? (event.fields ?? []).find((field) => /Id$/.test(field.name));
}

function importLines(values) {
    return uniqueBy(values.flatMap((value) => String(value ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.startsWith('import ') ? line : `import ${line}`)), (value) => value);
}

function fieldsCompatible(target, source) {
    return mappedType(target, false).replace(/\?$/, '') === mappedType(source, false).replace(/\?$/, '');
}

function commandRequestClass(command) {
    return `${_commandTitle(command.title)}Request`;
}

const processorWriterMethods = {
    _writeProcessors(slice) {
        this._writeSystemNotificationProcessors();
        for (const processor of slice.processors ?? []) {
            this._writeProcessor(slice, processor);
        }
    },

    _writeSystemNotificationProcessors() {
        if (this._systemNotificationProcessorsWritten) {
            return;
        }
        this._systemNotificationProcessorsWritten = true;
        const notifiableEvents = allSlices(this)
            .flatMap((slice) => (slice.events ?? [])
                .filter((event) => event.notifiable)
                .map((event) => ({slice, event})));
        if (notifiableEvents.length === 0) return;

        const publishCommandRef = findCommandByName(this, 'PublishSystemNotification');
        if (!publishCommandRef) return;

        const localContextNames = new Set((this.model.contexts ?? []).map((context) => context.name));
        const commandClass = _commandTitle(publishCommandRef.command.title);
        const commandImport = `${this.model.rootPackage}.${contextPackage(publishCommandRef.slice.context)}.${_sliceTitle(publishCommandRef.slice.title)}.${commandClass}`;
        const categoryImport = valueTypeImport('NotificationCategory');
        const severityImport = valueTypeImport('NotificationSeverity');
        const toastImport = valueTypeImport('NotificationToastPolicy');

        notifiableEvents.forEach((eventRef, index) => {
            if (!localContextNames.has(eventRef.slice.context)) return;
            if (!localContextNames.has(publishCommandRef.slice.context)) return;
            this._writeSystemNotificationProcessor(index, eventRef, commandImport, commandClass, [categoryImport, severityImport, toastImport].filter(Boolean));
        });
    },

    _writeSystemNotificationProcessor(index, eventRef, commandImport, commandClass, typeImports) {
        const context = contextPackage(eventRef.slice.context);
        const slicePackage = _sliceTitle(eventRef.slice.title);
        const packageName = `${this.model.rootPackage}.${context}.${slicePackage}`;
        const eventClass = _eventTitle(eventRef.event.title);
        const eventImport = `${this.model.rootPackage}.${contextPackage(eventRef.slice.context)}.events.${eventClass}`;
        const className = `${eventClass}SystemNotification${index + 1}Processor`;
        const eventFields = new Set((eventRef.event.fields ?? []).map((field) => field.name));
        const argsEntries = (eventRef.event.fields ?? [])
            .map((field) => field.name)
            .filter((arg) => eventFields.has(arg))
            .map((arg) => `"${escapeKotlin(arg)}" to event.${arg}`)
            .join(', ');
        const messageArgs = argsEntries
            ? `objectMapper.writeValueAsString(mapOf(${argsEntries}))`
            : 'null';
        const targetKey = notificationTargetIdField(eventRef.event)?.name ?? null;
        const targetId = targetKey && eventFields.has(targetKey)
            ? `event.${targetKey}.toString()`
            : 'null';
        const category = safeIdentifier(inferNotificationCategory(eventRef));
        const severity = safeIdentifier(inferNotificationSeverity(eventRef.event.name));
        const toastPolicy = safeIdentifier(defaultToastPolicy(severity));
        const messageKey = notificationMessageKey(eventRef.event.name);
        const fallbackTitle = humanFallbackTitle(messageKey, eventRef.event.name);
        const imports = importLines([
            eventImport,
            commandImport,
            ...typeImports
        ]).join('\n');

        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${className}.kt`), `package ${packageName}

${imports}
import com.fasterxml.jackson.databind.ObjectMapper
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.axonframework.messaging.core.annotation.Namespace
import org.springframework.stereotype.Component
import java.time.LocalDateTime
import java.util.UUID

@Namespace("system-notification-${kebab(eventRef.slice.context)}-${kebab(eventRef.slice.name)}")
@Component
class ${className}(
    private val commandGateway: CommandGateway,
    private val objectMapper: ObjectMapper
) {
    @EventHandler
    fun on(event: ${eventClass}) {
        commandGateway.send(
            ${commandClass}(
                notificationId = UUID.randomUUID(),
                recipientUserId = "GLOBAL",
                recipientRole = null,
                category = NotificationCategory.${category},
                severity = NotificationSeverity.${severity},
                messageKey = "${escapeKotlin(messageKey)}",
                messageArgsJson = ${messageArgs},
                fallbackTitle = "${escapeKotlin(fallbackTitle)}",
                fallbackBody = null,
                targetType = "${escapeKotlin(eventRef.slice.name)}",
                targetId = ${targetId},
                targetRoute = null,
                toastPolicy = NotificationToastPolicy.${toastPolicy},
                publishedAt = LocalDateTime.now(),
                status = "UNREAD"
            )
        ).resultMessage
    }
}
`);
    },

    _writeProcessor(slice, processor) {
        if (isDataExportExecutionAutomation(processor)) {
            return;
        }
        if (processor.metadata?.onKind === 'todo') {
            this._writeTodoProcessor(slice, processor);
            return;
        }
        const inbound = dependency(processor, 'INBOUND', 'EVENT');
        const outbound = dependency(processor, 'OUTBOUND', 'COMMAND');
        if (!inbound || !outbound) return;
        const eventRef = findEvent(this, inbound.id);
        const commandRef = findCommand(this, outbound.id);
        if (!eventRef || !commandRef) return;

        const localContextNames = new Set((this.model.contexts ?? []).map((context) => context.name));
        if (!localContextNames.has(eventRef.slice.context)) return;
        const isLocalCommand = localContextNames.has(commandRef.slice.context);
        const context = contextPackage(slice.context);
        const slicePackage = _sliceTitle(slice.title);
        const packageName = `${this.model.rootPackage}.${context}.${slicePackage}`;
        const processorClass = `${pascal(processor.name)}Processor`;
        const eventClass = _eventTitle(eventRef.event.title);
        const eventImport = `${this.model.rootPackage}.${contextPackage(eventRef.slice.context)}.events.${eventClass}`;

        if (isLocalCommand) {
            this._writeLocalCommandProcessor(packageName, context, slicePackage, processorClass, eventImport, commandRef, eventRef, processor, slice);
        } else {
            const targetDeployment = deploymentForContext(this, commandRef.slice.context);
            if (!targetDeployment) return;
            const clientClass = this._integrationClientClass(targetDeployment.name);
            this._writeIntegrationClient(targetDeployment);
            this._writeRemoteCommandProcessor(packageName, context, slicePackage, processorClass, eventImport, clientClass, commandRef, eventRef, slice);
        }
    },

    _writeTodoProcessor(slice, processor) {
        const inbound = dependency(processor, 'INBOUND', 'READMODEL');
        const outbound = dependency(processor, 'OUTBOUND', 'COMMAND');
        if (!inbound || !outbound) return;
        const readmodelRef = findReadModel(this, inbound.id);
        const commandRef = findCommand(this, outbound.id);
        if (!readmodelRef || !commandRef) return;

        const localContextNames = new Set((this.model.contexts ?? []).map((context) => context.name));
        if (!localContextNames.has(readmodelRef.slice.context)) return;
        if (!localContextNames.has(commandRef.slice.context)) return;

        const context = contextPackage(slice.context);
        const slicePackage = _sliceTitle(slice.title);
        const packageName = `${this.model.rootPackage}.${context}.${slicePackage}`;
        const processorClass = `${pascal(processor.name)}Processor`;
        const readmodelClass = _readmodelTitle(readmodelRef.readmodel.title);
        const readmodelPackage = `${this.model.rootPackage}.${contextPackage(readmodelRef.slice.context)}.${_sliceTitle(readmodelRef.slice.title)}`;
        const command = commandRef.command;
        const selection = selectionFor(commandRef.slice, this.model);
        const commandClass = _commandTitle(command.title);
        const commandImport = `${this.model.rootPackage}.${contextPackage(commandRef.slice.context)}.${_sliceTitle(commandRef.slice.title)}.${commandClass}`;
        const commandFields = commandFieldsWithSelection(command, selection);
        const fieldImports = kotlinFieldImports(commandFields, this.model.rootPackage);
        const imports = importLines([
            `${readmodelPackage}.${readmodelClass}`,
            `${readmodelPackage}.${readmodelClass}Repository`,
            commandImport,
            fieldImports
        ]).join('\n');
        const predicates = [
            conditionExpression(processor, readmodelRef.readmodel),
            ...requiredSourcePredicates(command, readmodelRef.readmodel, 'todo', selection, true)
        ];
        const condition = predicates.filter(Boolean).join(' && ');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${processorClass}.kt`), `package ${packageName}

${imports}
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.springframework.data.domain.PageRequest
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
class ${processorClass}(
    private val repository: ${readmodelClass}Repository,
    private val commandGateway: CommandGateway
) {
    @Scheduled(fixedDelayString = "\\${'${'}automation.${kebab(processor.name)}.fixed-delay-ms:5000}")
    fun processTodo() {
        repository.${readModelRepositoryPageCall(readmodelRef.readmodel)}
            .content
            .asSequence()
            .filter { todo -> ${condition} }
            .forEach { todo ->
                commandGateway.send(${commandExpression(command, readmodelRef.readmodel, 'todo', selection, true)})
            }
    }
}
`);
    },

    _writeLocalCommandProcessor(packageName, context, slicePackage, processorClass, eventImport, commandRef, eventRef, processor, slice) {
        const command = commandRef.command;
        const selection = selectionFor(commandRef.slice, this.model);
        const commandClass = _commandTitle(command.title);
        const commandImport = `${this.model.rootPackage}.${contextPackage(commandRef.slice.context)}.${_sliceTitle(commandRef.slice.title)}.${commandClass}`;
        const commandFields = commandFieldsWithSelection(command, selection);
        const fieldImports = kotlinFieldImports(commandFields, this.model.rootPackage);
        const condition = conditionExpression(processor, eventRef.event, 'event');
        const fanOutSource = fanOutSourceExpression(processor, eventRef.event, 'event');
        const fanOutAlias = processor.metadata?.fanOutAlias ? safeIdentifier(processor.metadata.fanOutAlias) : null;
        const eventSelection = selectionFor(eventRef.slice, this.model);
        const sourceEvent = {
            ...eventRef.event,
            fields: eventFieldsWithTags(eventRef.event.fields ?? [], eventTagFieldsFor(eventRef.slice, eventRef.event, eventSelection, true))
        };
        const commandSend = fanOutSource && fanOutAlias
            ? `        java.util.concurrent.CompletableFuture.allOf(*${fanOutSource}.map { ${fanOutAlias} ->
            commandGateway.send(${commandExpression(command, sourceEvent, 'event', selection, false, {alias: fanOutAlias, itemParameter: fanOutAlias})}).resultMessage
        }.toTypedArray())`
            : `        commandGateway.send(${commandExpression(command, sourceEvent, 'event', selection)}).resultMessage`;
        const body = condition === 'true'
            ? commandSend
            : `        if (${condition}) {
${commandSend.replace(/^        /gm, '            ')}
        } else {
            java.util.concurrent.CompletableFuture.completedFuture(null)
        }`;
        const imports = importLines([
            eventImport,
            commandImport,
            fieldImports
        ]).join('\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${processorClass}.kt`), `package ${packageName}

${imports}
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.axonframework.messaging.core.annotation.Namespace
import org.springframework.stereotype.Component

@Namespace("${automationProcessingGroup(slice)}")
@Component
class ${processorClass}(private val commandGateway: CommandGateway) {
    @EventHandler
    fun on(event: ${eventClassName(eventImport)}): java.util.concurrent.CompletableFuture<*> =
${body}
}
`);
    },

    _writeRemoteCommandProcessor(packageName, context, slicePackage, processorClass, eventImport, clientClass, commandRef, eventRef, slice) {
        const requestClass = commandRequestClass(commandRef.command);
        const selection = selectionFor(commandRef.slice, this.model);
        const eventSelection = selectionFor(eventRef.slice, this.model);
        const sourceEvent = {
            ...eventRef.event,
            fields: eventFieldsWithTags(eventRef.event.fields ?? [], eventTagFieldsFor(eventRef.slice, eventRef.event, eventSelection, true))
        };
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${processorClass}.kt`), `package ${packageName}

import ${eventImport}
import ${this.model.rootPackage}.integration.${clientClass}
import ${this.model.rootPackage}.integration.${requestClass}
import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.axonframework.messaging.core.annotation.Namespace
import org.springframework.stereotype.Component

@Namespace("${integrationProcessingGroup(slice)}")
@Component
class ${processorClass}(private val client: ${clientClass}) {
    @EventHandler
    fun on(event: ${eventClassName(eventImport)}) {
        client.${lowerCamel(commandRef.command.name)}(${payloadExpression(commandRef.command, sourceEvent)})
    }
}
`);
    },

    _integrationClientClass(deploymentName) {
        return `${pascal(deploymentName)}IntegrationClient`;
    },

    _writeIntegrationClient(deployment) {
        const clientClass = this._integrationClientClass(deployment.name);
        const configKey = kebab(deployment.name);
        const targetContexts = new Set((deployment.contexts ?? []).map((context) => context.name));
        const commandRefs = uniqueBy((this.model.slices ?? [])
            .flatMap((slice) => slice.processors ?? [])
            .map((processor) => dependency(processor, 'OUTBOUND', 'COMMAND'))
            .filter(Boolean)
            .map((outbound) => findCommand(this, outbound.id))
            .filter(Boolean)
            .filter(({slice}) => targetContexts.has(slice.context)), ({command}) => command.id);
        const fields = commandRefs.flatMap(({command}) => commandFieldsWithSelection(command, {fields: []}));
        const fieldImports = kotlinFieldImports(fields, this.model.rootPackage);
        const requestTypes = commandRefs.map(({command}) => {
            const requestClass = commandRequestClass(command);
            const properties = commandFieldsWithSelection(command, {fields: []})
                .map((field) => `    val ${field.name}: ${mappedType(field, field.optional)}`)
                .join(',\n');
            return `data class ${requestClass}(\n${properties}\n)`;
        }).join('\n\n');
        const methods = commandRefs.map(({slice, command}) => {
            const conceptRoute = httpRoute(slice.concepts?.[0] ?? slice.name);
            const commandRoute = httpRoute(command.title);
            const requestClass = commandRequestClass(command);
            return `    @PostMapping("/${conceptRoute}/${commandRoute}")
    fun ${lowerCamel(command.name)}(@RequestBody payload: ${requestClass}): Any?`;
        }).join('\n\n');
        this.fs.write(this._kotlinPath(`integration/${clientClass}.kt`), `package ${this.model.rootPackage}.integration

${fieldImports ? `${fieldImports}\n` : ''}
import org.springframework.cloud.openfeign.FeignClient
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import ${this.model.rootPackage}.shared.security.MedolFeignSecurityConfiguration

${requestTypes}

@FeignClient(
    name = "${configKey}",
    url = "\\${'${'}integration.${configKey}.endpoint:}",
    configuration = [MedolFeignSecurityConfiguration::class]
)
interface ${clientClass} {
${methods}
}
`);
    }
};

function eventClassName(importPath) {
    return importPath.split('.').pop();
}

module.exports = {processorWriterMethods};
