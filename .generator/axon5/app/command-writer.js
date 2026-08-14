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
const {
    constructorArgsFromCommand,
    infrastructurePortForCommand
} = require('./infrastructure-port-writer');

function lowerCamel(value) {
    const name = pascal(value);
    return safeIdentifier(name.charAt(0).toLowerCase() + name.slice(1));
}

function uploadFileFields(command) {
    return (command.fields ?? []).filter((field) => field.uploadFile);
}

function hasUploadFile(command) {
    return uploadFileFields(command).length > 0;
}

function uploadMetadataExpression(field, storedVariable) {
    switch (field.name) {
        case 'originalFileName': return `${storedVariable}.originalFileName`;
        case 'contentType': return `${storedVariable}.contentType`;
        case 'sizeBytes': return `${storedVariable}.sizeBytes`;
        case 'stagedFileLocation': return `${storedVariable}.location`;
        case 'checksum': return `${storedVariable}.checksum`;
        case 'expiresAt': return `${storedVariable}.expiresAt`;
        default: return null;
    }
}

function uploadStorageName(command) {
    return `${pascal(command.name ?? command.title)}UploadedFileStorage`;
}

function storedUploadName(command) {
    return `${pascal(command.name ?? command.title)}StoredUploadedFile`;
}

const commandWriterMethods = {
    _writeCommand(packageName, context, slicePackage, command, selection, selectionPackageName = packageName, reservations = []) {
        const commandName = _commandTitle(command.title);
        const commandFields = commandFieldsWithSelection(command, selection);
        const commandReservations = commandStartsLifecycle(command) ? reservations : [];
        const imports = uniqueBy([
            kotlinFieldImports(commandFields, this.model.rootPackage),
            ...commandReservations.map((reservation) => `import ${reservation.packageName}.${reservation.selectionName}`)
        ].filter(Boolean), (value) => value).join('\n');
        const selectionImport = selectionPackageName === packageName ? '' : `import ${selectionPackageName}.${selection.name}\n`;
        const properties = commandFields.map((field) => {
            const defaultValue = field.generated ? ` = ${fallbackValue(field)}` : '';
            return `    val ${field.name}: ${mappedType(field, field.optional)}${defaultValue}`;
        }).join(',\n');
        const selectionArgs = selection.fields.map((field) => `${field.alias} = ${field.commandExpression}`).join(', ');
        const reservationSelections = commandReservations.map((reservation) =>
            `    val ${reservation.selectionProperty}: ${reservation.selectionName} = ${reservation.selectionName}(${reservation.selectionArgs.join(', ')})`
        ).join('\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${commandName}.kt`), `package ${packageName}

import org.axonframework.messaging.commandhandling.annotation.Command
import org.axonframework.modelling.annotation.TargetEntityId
${selectionImport}${imports}

@Command
data class ${commandName}(
${properties}
) {
    @TargetEntityId
    val selection: ${selection.name} = ${selection.name}(${selectionArgs})
${reservationSelections ? `\n${reservationSelections}` : ''}
}
`);
    },

    _writeCommandHandlers(packageName, context, slicePackage, slice, selection, events, reservations = []) {
        const stateTarget = stateTargetFor(this.model, slice);
        const stateName = stateTarget.name;
        const decisionName = `${pascal(slice.name)}Decision`;
        const injectEntity = injectEntityExpression(selection);
        const handlers = slice.commands.map((command) => {
            const commandName = _commandTitle(command.title);
            const port = infrastructurePortForCommand(command, events, slice, this.model);
            const usePort = Boolean(port);
            const capability = port?.capability;
            const inputFields = port?.inputFields ?? [];
            const commandReservations = commandStartsLifecycle(command) ? reservations : [];
            const includeState = !commandStartsLifecycle(command);
            const methodParameters = [
                `command: ${commandName}`,
                includeState ? `@InjectEntity${injectEntity} state: ${stateName}` : undefined,
                ...commandReservations.map((reservation) =>
                    `@InjectEntity(idProperty = "${escapeKotlin(reservation.selectionProperty)}") ${reservation.stateParam}: ${reservation.stateName}`
                ),
                'eventAppender: EventAppender'
            ]
                .filter(Boolean)
                .map((parameter) => `        ${parameter}`)
                .join(',\n');
            const decisionArgs = [
                'command',
                ...(includeState ? ['state'] : []),
                ...commandReservations.map((reservation) => reservation.stateParam),
                ...(usePort ? ['portResult'] : []),
                ...(port?.failureEvent ? ['now'] : [])
            ].join(', ');
            const portStatements = usePort
                ? `        val input = ${capability.inputName}(${constructorArgsFromCommand(inputFields)})
        val portResult = ${lowerCamel(capability.portName)}.${capability.methodName}(input)
${port?.failureEvent ? '        val now = java.time.LocalDateTime.now()\n' : ''}
`
                : '';
            return `    @CommandHandler
    fun handle(
${methodParameters}
    ) {
${portStatements}\
        eventAppender.append(decision.decide(${decisionArgs}))
    }`;
        }).join('\n\n');
        const commandImports = slice.commands.map((command) => `import ${packageName}.${_commandTitle(command.title)}`).join('\n');
        const ports = uniqueBy(slice.commands
            .map((command) => infrastructurePortForCommand(command, events, slice, this.model))
            .filter(Boolean), (port) => port.capability.portName);
        const portImports = uniqueBy(ports.flatMap((port) => [
            `import ${port.packageName}.${port.capability.inputName}`,
            `import ${port.packageName}.${port.capability.portName}`
        ]), (value) => value).join('\n');
        const portConstructorParams = ports.map((port) =>
            `,\n    private val ${lowerCamel(port.capability.portName)}: ${port.capability.portName}`
        ).join('');
        const usesState = slice.commands.some((command) => !commandStartsLifecycle(command));
        const stateImport = usesState && stateTarget.packageName !== packageName ? `import ${stateTarget.packageName}.${stateName}\n` : '';
        const reservationStateImports = reservations.map((reservation) => `import ${reservation.packageName}.${reservation.stateName}`).join('\n');
        const injectEntityImport = slice.commands.some((command) => !commandStartsLifecycle(command) || reservations.length > 0)
            ? 'import org.axonframework.modelling.annotation.InjectEntity\n'
            : '';
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${pascal(slice.name)}CommandHandler.kt`), `package ${packageName}

import org.axonframework.messaging.commandhandling.annotation.CommandHandler
import org.axonframework.messaging.eventhandling.gateway.EventAppender
${injectEntityImport}\
import org.springframework.stereotype.Component
${commandImports}
${portImports}
${stateImport}
${reservationStateImports}

@Component
class ${pascal(slice.name)}CommandHandler(
    private val decision: ${decisionName}${portConstructorParams}
) {
${handlers}
}
`);
    },

    _writeCommandResource(packageName, context, slicePackage, slice) {
        const resourceName = `${pascal(slice.name)}Resource`;
        const conceptRoute = httpRoute(slice.concepts[0] ?? slice.name);
        const uploadCommands = slice.commands.filter(hasUploadFile);
        uploadCommands.forEach((command) => this._writeUploadFileStoragePort(packageName, context, slicePackage, command));
        const constructorParams = [
            'private val commandGateway: CommandGateway',
            ...uploadCommands.map((command) => `private val ${lowerCamel(uploadStorageName(command))}: ${uploadStorageName(command)}`)
        ].join(',\n    ');
        const methods = slice.commands.map((command) => {
            const commandName = _commandTitle(command.title);
            const jsonEndpoint = hasUploadFile(command) ? '' : `    @PostMapping("/${httpRoute(command.title)}")
    fun ${safeIdentifier(command.name)}(
        @Valid @RequestBody command: ${commandName},
        request: HttpServletRequest
    ): CompletableFuture<${commandName}> =
        commandGateway.send(command, MetadataFactory.from(request)).resultMessage.thenApply { command }`;
            const multipartEndpoint = this._renderUploadFileCommandEndpoint(command);
            return [jsonEndpoint, multipartEndpoint].filter(Boolean).join('\n\n');
        }).join('\n\n');
        const commandFieldImports = kotlinFieldImports(uniqueFields(slice.commands.flatMap((command) => command.fields ?? [])), this.model.rootPackage);
        const uploadImports = uploadCommands.length > 0
            ? `import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.multipart.MultipartFile
${commandFieldImports ? `${commandFieldImports}\n` : ''}`
            : '';
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${resourceName}.kt`), `package ${packageName}

import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.springframework.web.bind.annotation.CrossOrigin
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import ${this.model.rootPackage}.shared.application.metadata.MetadataFactory
${uploadImports}
import java.util.concurrent.CompletableFuture

@CrossOrigin
@RestController
@RequestMapping("/${conceptRoute}")
class ${resourceName}(
    ${constructorParams}
) {
${methods}
}
`);
    },

    _writeUploadFileStoragePort(packageName, context, slicePackage, command) {
        const storageName = uploadStorageName(command);
        const storedName = storedUploadName(command);
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${storageName}.kt`), `package ${packageName}

import java.io.InputStream
import java.time.LocalDateTime

interface ${storageName} {
    fun save(
        uploadId: String?,
        fieldName: String,
        originalFileName: String,
        contentType: String?,
        inputStream: InputStream
    ): ${storedName}
}

data class ${storedName}(
    val location: String,
    val originalFileName: String,
    val contentType: String?,
    val sizeBytes: Long?,
    val checksum: String?,
    val expiresAt: LocalDateTime
)
`);
    },

    _renderUploadFileCommandEndpoint(command) {
        const commandName = _commandTitle(command.title);
        const uploadFields = uploadFileFields(command);
        if (uploadFields.length === 0) return '';
        const primaryStoredVariable = `${uploadFields[0].name}Stored`;
        const storageProperty = lowerCamel(uploadStorageName(command));
        const requestParts = uploadFields.map((field) =>
            `        @RequestPart("${field.name}") ${field.name}: MultipartFile`
        );
        const requestParams = (command.fields ?? [])
            .filter((field) => !field.uploadFile)
            .filter((field) => !uploadMetadataExpression(field, primaryStoredVariable))
            .map((field) => {
                const required = field.optional || field.generated ? ', required = false' : '';
                const type = mappedType(field, field.optional || field.generated);
                return `        @RequestParam("${field.name}"${required}) ${field.name}: ${type}`;
            });
        const parameters = [
            ...requestParts,
            ...requestParams,
            '        request: HttpServletRequest'
        ].join(',\n');
        const idField = (command.fields ?? []).find((field) => field.idAttribute);
        const uploadIdExpression = idField ? `${idField.name}?.toString()` : 'null';
        const storeStatements = uploadFields.map((field) => `        val ${field.name}Stored = ${storageProperty}.save(
            uploadId = ${uploadIdExpression},
            fieldName = "${field.name}",
            originalFileName = ${field.name}.originalFilename ?: "${kebab(field.name)}",
            contentType = ${field.name}.contentType,
            inputStream = ${field.name}.inputStream
        )`).join('\n');
        const constructorArgs = (command.fields ?? []).map((field) => {
            if (field.uploadFile) {
                return `            ${field.name} = ${field.name}Stored.location`;
            }
            const metadataExpression = uploadMetadataExpression(field, primaryStoredVariable);
            if (metadataExpression) {
                return `            ${field.name} = ${metadataExpression}`;
            }
            if (field.generated) {
                return `            ${field.name} = ${field.name} ?: ${fallbackValue(field).replaceAll('java.util.UUID.', 'UUID.')}`;
            }
            return `            ${field.name} = ${field.name}`;
        }).join(',\n');
        return `    @PostMapping("/${httpRoute(command.title)}/file", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun ${safeIdentifier(command.name)}File(
${parameters}
    ): CompletableFuture<${commandName}> {
${storeStatements}
        val command = ${commandName}(
${constructorArgs}
        )
        return commandGateway.send(command, MetadataFactory.from(request)).resultMessage.thenApply { command }
    }`;
    },
};

module.exports = {commandWriterMethods};
