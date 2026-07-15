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
    safeIdentifier,
    uniqueBy
} = require('./model-helpers');
const {contextPackage} = require('../../common/util/value-types');
const {_commandTitle, _eventTitle, _sliceTitle} = require('../../common/util/naming');

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

function findEvent(generator, eventId) {
    for (const slice of allSlices(generator)) {
        const event = (slice.events ?? []).find((candidate) => candidate.id === eventId);
        if (event) return {slice, event};
    }
    return null;
}

function dependency(processor, direction, elementType) {
    return (processor.dependencies ?? []).find((candidate) =>
        candidate.direction === direction && candidate.elementType === elementType
    );
}

function commandExpression(command, event, eventParameter = 'event') {
    const eventFields = new Map((event.fields ?? []).map((field) => [field.name, field]));
    const args = commandFieldsWithSelection(command, {fields: []}).map((field) => {
        const source = field.source?.from?.find((name) => {
            const sourceField = eventFields.get(String(name).split('.').pop());
            return sourceField && fieldsCompatible(field, sourceField);
        });
        const sourceName = source ? String(source).split('.').pop() : field.name;
        if (eventFields.has(sourceName) && fieldsCompatible(field, eventFields.get(sourceName))) {
            return `${field.name} = ${eventParameter}.${sourceName}`;
        }
        return `${field.name} = ${fallbackValue(field)} /* TODO: provide ${field.name} */`;
    });
    return `${_commandTitle(command.title)}(${args.join(', ')})`;
}

function payloadExpression(command, event, eventParameter = 'event') {
    const eventFields = new Map((event.fields ?? []).map((field) => [field.name, field]));
    const args = commandFieldsWithSelection(command, {fields: []}).map((field) => {
        const source = field.source?.from?.find((name) => {
            const sourceField = eventFields.get(String(name).split('.').pop());
            return sourceField && fieldsCompatible(field, sourceField);
        });
        const sourceName = source ? String(source).split('.').pop() : field.name;
        const sourceField = eventFields.get(sourceName);
        const value = sourceField && fieldsCompatible(field, sourceField)
            ? `${eventParameter}.${sourceName}`
            : `${fallbackValue(field)} /* TODO: provide ${field.name} */`;
        return `${field.name} = ${value}`;
    });
    return `${commandRequestClass(command)}(${args.join(', ')})`;
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
        for (const processor of slice.processors ?? []) {
            this._writeProcessor(slice, processor);
        }
    },

    _writeProcessor(slice, processor) {
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
            this._writeLocalCommandProcessor(packageName, context, slicePackage, processorClass, eventImport, commandRef, eventRef);
        } else {
            const targetDeployment = deploymentForContext(this, commandRef.slice.context);
            if (!targetDeployment) return;
            const clientClass = this._integrationClientClass(targetDeployment.name);
            this._writeIntegrationClient(targetDeployment);
            this._writeRemoteCommandProcessor(packageName, context, slicePackage, processorClass, eventImport, clientClass, commandRef, eventRef);
        }
    },

    _writeLocalCommandProcessor(packageName, context, slicePackage, processorClass, eventImport, commandRef, eventRef) {
        const command = commandRef.command;
        const commandClass = _commandTitle(command.title);
        const commandImport = `${this.model.rootPackage}.${contextPackage(commandRef.slice.context)}.${_sliceTitle(commandRef.slice.title)}.${commandClass}`;
        const commandFields = commandFieldsWithSelection(command, {fields: []});
        const fieldImports = kotlinFieldImports(commandFields, this.model.rootPackage);
        const imports = importLines([
            eventImport,
            commandImport,
            fieldImports
        ]).join('\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${processorClass}.kt`), `package ${packageName}

${imports}
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.springframework.stereotype.Component

@Component
class ${processorClass}(private val commandGateway: CommandGateway) {
    @EventHandler
    fun on(event: ${eventClassName(eventImport)}): java.util.concurrent.CompletableFuture<${commandClass}> =
        commandGateway.send(${commandExpression(command, eventRef.event)}).resultMessage.thenApply { it.payload() as ${commandClass} }
}
`);
    },

    _writeRemoteCommandProcessor(packageName, context, slicePackage, processorClass, eventImport, clientClass, commandRef, eventRef) {
        const requestClass = commandRequestClass(commandRef.command);
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${processorClass}.kt`), `package ${packageName}

import ${eventImport}
import ${this.model.rootPackage}.integration.${clientClass}
import ${this.model.rootPackage}.integration.${requestClass}
import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.springframework.stereotype.Component

@Component
class ${processorClass}(private val client: ${clientClass}) {
    @EventHandler
    fun on(event: ${eventClassName(eventImport)}) {
        client.${lowerCamel(commandRef.command.name)}(${payloadExpression(commandRef.command, eventRef.event)})
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

${requestTypes}

@FeignClient(name = "${configKey}", url = "\\${'${'}integration.${configKey}.endpoint:}")
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
