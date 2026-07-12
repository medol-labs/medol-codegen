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

const commandWriterMethods = {
    _writeCommand(packageName, context, slicePackage, command, selection, selectionPackageName = packageName, reservations = []) {
        const commandName = _commandTitle(command.title);
        const commandFields = commandFieldsWithSelection(command, selection);
        const commandReservations = command.startsLifecycle ? reservations : [];
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
            const commandReservations = command.startsLifecycle ? reservations : [];
            const includeState = !command.startsLifecycle;
            const methodParameters = [
                `command: ${commandName}`,
                includeState ? `@InjectEntity${injectEntity} state: ${stateName}` : undefined,
                ...commandReservations.map((reservation) =>
                    `@InjectEntity(idProperty = "${escapeKotlin(reservation.selectionProperty)}") ${reservation.stateParam}: ${reservation.stateName}`
                ),
                '@MetadataValue(MetadataKeys.USER_ID) userId: String?',
                '@MetadataValue(MetadataKeys.SESSION_ID) sessionId: String?',
                '@MetadataValue(MetadataKeys.CORRELATION_ID) correlationId: String?',
                '@MetadataValue(MetadataKeys.TRACE_ID) traceId: String?',
                '@MetadataValue(MetadataKeys.TENANT_ID) tenantId: String?',
                'commandMessage: CommandMessage',
                'eventAppender: EventAppender'
            ]
                .filter(Boolean)
                .map((parameter) => `        ${parameter}`)
                .join(',\n');
            const decisionArgs = ['command', ...(includeState ? ['state'] : []), ...commandReservations.map((reservation) => reservation.stateParam)].join(', ');
            return `    @CommandHandler
    fun handle(
${methodParameters}
    ) {
        eventAppender.append(
            decision.decide(${decisionArgs}),
            MetadataFactory.fromValues(
                userId = userId,
                sessionId = sessionId,
                correlationId = correlationId,
                causationId = commandMessage.identifier(),
                traceId = traceId,
                tenantId = tenantId
            )
        )
    }`;
        }).join('\n\n');
        const commandImports = slice.commands.map((command) => `import ${packageName}.${_commandTitle(command.title)}`).join('\n');
        const stateImport = stateTarget.packageName === packageName ? '' : `import ${stateTarget.packageName}.${stateName}\n`;
        const reservationStateImports = reservations.map((reservation) => `import ${reservation.packageName}.${reservation.stateName}`).join('\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${pascal(slice.name)}CommandHandler.kt`), `package ${packageName}

import org.axonframework.messaging.commandhandling.annotation.CommandHandler
import org.axonframework.messaging.commandhandling.CommandMessage
import org.axonframework.messaging.core.annotation.MetadataValue
import org.axonframework.messaging.eventhandling.gateway.EventAppender
import org.axonframework.modelling.annotation.InjectEntity
import org.springframework.stereotype.Component
import ${this.model.rootPackage}.support.metadata.MetadataFactory
import ${this.model.rootPackage}.support.metadata.MetadataKeys
${commandImports}
${stateImport}
${reservationStateImports}

@Component
class ${pascal(slice.name)}CommandHandler(private val decision: ${decisionName}) {
${handlers}
}
`);
    },

    _writeCommandResource(packageName, context, slicePackage, slice) {
        const resourceName = `${pascal(slice.name)}Resource`;
        const conceptRoute = httpRoute(slice.concepts[0] ?? slice.name);
        const methods = slice.commands.map((command) => {
            const commandName = _commandTitle(command.title);
            return `    @PostMapping("/${httpRoute(command.title)}")
    fun ${safeIdentifier(command.name)}(
        @Valid @RequestBody command: ${commandName},
        request: HttpServletRequest
    ): CompletableFuture<${commandName}> =
        commandGateway.send(command, MetadataFactory.from(request)).resultMessage.thenApply { command }`;
        }).join('\n\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${resourceName}.kt`), `package ${packageName}

import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.springframework.web.bind.annotation.CrossOrigin
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import ${this.model.rootPackage}.support.metadata.MetadataFactory
import java.util.concurrent.CompletableFuture

@CrossOrigin
@RestController
@RequestMapping("/${conceptRoute}")
class ${resourceName}(private val commandGateway: CommandGateway) {
${methods}
}
`);
    },
};

module.exports = {commandWriterMethods};
