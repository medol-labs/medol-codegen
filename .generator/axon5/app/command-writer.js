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

function lowerCamel(value) {
    const name = pascal(value);
    return safeIdentifier(name.charAt(0).toLowerCase() + name.slice(1));
}

function importLines(values) {
    return uniqueBy(values.flatMap((value) => String(value ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.startsWith('import ') ? line : `import ${line}`)), (value) => value);
}

function commandOutputEvents(command, events) {
    return outboundEvents(command, events);
}

function isFailureOutcome(event) {
    const name = `${event.name ?? ''} ${event.title ?? ''}`.toLowerCase();
    return name.includes('fail') || name.includes('failure') || name.includes('reject') || name.includes('block');
}

function isExternalCapabilityCommand(command) {
    const name = pascal(command.name ?? command.title ?? '');
    return ['Verify', 'Authorize', 'Inspect', 'Evaluate'].some((prefix) => name.startsWith(prefix));
}

function portCapability(command) {
    const name = pascal(command.name ?? command.title ?? '');
    const patterns = [
        {prefix: 'Verify', suffix: 'Verifier', nounSuffix: 'Verification', method: 'verify'},
        {prefix: 'Authorize', suffix: 'Authorizer', nounSuffix: 'Authorization', method: 'authorize'},
        {prefix: 'Inspect', suffix: 'Inspector', nounSuffix: 'Inspection', method: 'inspect'},
        {prefix: 'Evaluate', suffix: 'Evaluator', nounSuffix: 'Evaluation', method: 'evaluate'}
    ];
    const pattern = patterns.find((candidate) => name.startsWith(candidate.prefix));
    if (!pattern) {
        return {
            portName: `${name}Port`,
            inputName: `${name}Input`,
            resultName: `${name}Result`,
            methodName: 'execute'
        };
    }
    const subject = name.slice(pattern.prefix.length);
    return {
        portName: `${subject}${pattern.suffix}`,
        inputName: `${subject}${pattern.nounSuffix}Input`,
        resultName: `${subject}${pattern.nounSuffix}`,
        methodName: pattern.method
    };
}

function isExternalPortCommand(command, events) {
    const outputs = commandOutputEvents(command, events);
    return outputs.length === 2 && isExternalCapabilityCommand(command) && outputs.some(isFailureOutcome);
}

function isPortOutputField(field) {
    if ([
        'verificationPassed',
        'authorizationPassed',
        'inspectionPassed',
        'evaluationPassed',
        'verifiedAt',
        'authorizedAt',
        'inspectedAt',
        'evaluatedAt',
        'failedAt',
        'verificationSummary',
        'authorizationSummary',
        'inspectionSummary',
        'evaluationSummary',
        'failureReason',
        'remediationHint'
    ].includes(field.name)) return true;
    return Boolean(field.name?.match(/^(can|is).*(Allowed|Passed|Valid|Ready)$/));
}

function portInputFields(command) {
    return (command.fields ?? []).filter((field) => !isPortOutputField(field));
}

function resultFieldsForEvent(event) {
    return (event.fields ?? []).filter((field) => !field.idAttribute && !field.technicalAttribute);
}

function constructorArgsFromCommand(fields) {
    return fields.map((field) => `${field.name} = command.${field.name}`).join(', ');
}

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

    _writePortArtifacts(packageName, context, slicePackage, slice, command, events, selection) {
        if (!isExternalPortCommand(command, events)) return;
        const capability = portCapability(command);
        const outputs = commandOutputEvents(command, events);
        const successEvent = outputs.find((event) => !isFailureOutcome(event)) ?? outputs[0];
        const failureEvent = outputs.find(isFailureOutcome) ?? outputs[1];
        const inputFields = portInputFields(command);
        const inputImports = kotlinFieldImports(inputFields, this.model.rootPackage);
        const resultImports = kotlinFieldImports(uniqueFields([
            ...resultFieldsForEvent(successEvent),
            ...resultFieldsForEvent(failureEvent)
        ]), this.model.rootPackage);
        const inputProperties = inputFields.map((field) =>
            `    val ${field.name}: ${mappedType(field, field.optional)}`
        ).join(',\n');
        const successProperties = resultFieldsForEvent(successEvent).map((field) =>
            `        val ${field.name}: ${mappedType(field, field.optional)}`
        ).join(',\n');
        const failureProperties = resultFieldsForEvent(failureEvent).map((field) =>
            `        val ${field.name}: ${mappedType(field, field.optional)}`
        ).join(',\n');
        const unavailableProperties = [
            resultFieldsForEvent(failureEvent).some((field) => field.name === 'failureReason') ? '        val failureReason: String' : undefined,
            resultFieldsForEvent(failureEvent).some((field) => field.name === 'remediationHint') ? '        val remediationHint: String? = null' : undefined
        ].filter(Boolean).join(',\n');
        const imports = importLines([
            inputImports,
            resultImports
        ]).join('\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${capability.portName}.kt`), `package ${packageName}

${imports}

interface ${capability.portName} {
    fun supports(input: ${capability.inputName}): Boolean = true
    fun ${capability.methodName}(input: ${capability.inputName}): ${capability.resultName}
}

data class ${capability.inputName}(
${inputProperties}
)

sealed interface ${capability.resultName} {
    data class Succeeded(
${successProperties}
    ) : ${capability.resultName}

    data class Rejected(
${failureProperties}
    ) : ${capability.resultName}

    data class Unavailable(
${unavailableProperties}
    ) : ${capability.resultName}
}
`);
        const conceptPackage = _sliceTitle(slice.concepts?.[0] ?? slice.name);
        const routerPackage = `${this.model.rootPackage}.${context}.infrastructure.${conceptPackage}`;
        const routerClass = `${capability.portName}Router`;
        this.fs.write(this._kotlinPath(`${context}/infrastructure/${conceptPackage}/${routerClass}.kt`), `package ${routerPackage}

import ${packageName}.${capability.inputName}
import ${packageName}.${capability.portName}
import ${packageName}.${capability.resultName}
import org.springframework.beans.factory.ObjectProvider
import org.springframework.context.annotation.Primary
import org.springframework.stereotype.Component

@Primary
@Component
class ${routerClass}(private val adapters: ObjectProvider<${capability.portName}>) : ${capability.portName} {
    override fun supports(input: ${capability.inputName}): Boolean = true

    override fun ${capability.methodName}(input: ${capability.inputName}): ${capability.resultName} {
        val candidates = adapters.stream()
            .filter { it !== this }
            .filter { it.supports(input) }
            .toList()
        return when (candidates.size) {
            1 -> try {
                candidates.first().${capability.methodName}(input)
            } catch (ex: Exception) {
                ${capability.resultName}.Unavailable(
                    failureReason = ex.message ?: "${capability.portName} is unavailable."
                )
            }
            0 -> ${capability.resultName}.Unavailable(
                failureReason = "No ${capability.portName} adapter supports the requested input."
            )
            else -> ${capability.resultName}.Unavailable(
                failureReason = "Multiple ${capability.portName} adapters support the requested input."
            )
        }
    }
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
            const usePort = isExternalPortCommand(command, events);
            const capability = portCapability(command);
            const inputFields = portInputFields(command);
            const commandReservations = command.startsLifecycle ? reservations : [];
            const includeState = !command.startsLifecycle;
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
                ...(usePort ? ['portResult', 'now'] : [])
            ].join(', ');
            const portStatements = usePort
                ? `        val input = ${capability.inputName}(${constructorArgsFromCommand(inputFields)})
        val portResult = ${lowerCamel(capability.portName)}.${capability.methodName}(input)
        val now = java.time.LocalDateTime.now()
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
        const portCommands = slice.commands.filter((command) => isExternalPortCommand(command, events));
        const portImports = uniqueBy(portCommands.flatMap((command) => {
            const capability = portCapability(command);
            return [
                `import ${packageName}.${capability.inputName}`,
                `import ${packageName}.${capability.portName}`
            ];
        }), (value) => value).join('\n');
        const portConstructorParams = portCommands.map((command) => {
            const capability = portCapability(command);
            return `,\n    private val ${lowerCamel(capability.portName)}: ${capability.portName}`;
        }).join('');
        const usesState = slice.commands.some((command) => !command.startsLifecycle);
        const stateImport = usesState && stateTarget.packageName !== packageName ? `import ${stateTarget.packageName}.${stateName}\n` : '';
        const reservationStateImports = reservations.map((reservation) => `import ${reservation.packageName}.${reservation.stateName}`).join('\n');
        const injectEntityImport = slice.commands.some((command) => !command.startsLifecycle || reservations.length > 0)
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
