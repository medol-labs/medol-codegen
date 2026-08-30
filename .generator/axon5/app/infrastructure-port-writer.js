/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {
    outboundEvents,
    commandStartsLifecycle,
    kotlinFieldImports,
    mappedType,
    pascal,
    primaryConcept,
    relatedEventsForSlice,
    safeIdentifier,
    uniqueBy,
    uniqueFields
} = require('./model-helpers');
const {contextPackage} = require('../../common/util/value-types');
const {_sliceTitle} = require('../../common/util/naming');

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

function portCapability(slice, command) {
    const name = pascal(command.name ?? command.title ?? '');
    const sliceName = pascal(slice.name ?? slice.title ?? name);
    const patterns = [
        {prefix: 'Verify', nounSuffix: 'Verification', method: 'verify'},
        {prefix: 'Authorize', nounSuffix: 'Authorization', method: 'authorize'},
        {prefix: 'Inspect', nounSuffix: 'Inspection', method: 'inspect'},
        {prefix: 'Evaluate', nounSuffix: 'Evaluation', method: 'evaluate'}
    ];
    const pattern = patterns.find((candidate) => name.startsWith(candidate.prefix));
    if (!pattern) {
        return {
            portName: `${sliceName}Service`,
            inputName: `${name}Input`,
            resultName: `${name}Result`,
            methodName: 'execute'
        };
    }
    const subject = name.slice(pattern.prefix.length);
    return {
        portName: `${sliceName}Service`,
        inputName: `${subject}${pattern.nounSuffix}Input`,
        resultName: `${subject}${pattern.nounSuffix}`,
        methodName: pattern.method
    };
}

function isInfrastructurePortCommand(command, events) {
    if (!command?.port) return false;
    const outputs = commandOutputEvents(command, events);
    return outputs.length > 0;
}

function isPortOutputField(field) {
    if (field.portOutput) return true;
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

function stateEventsForSlice(model, slice, events) {
    const concept = primaryConcept(slice);
    if (!concept) return events;
    return uniqueBy((model.slices ?? [])
        .filter((candidate) => candidate.context === slice.context && primaryConcept(candidate) === concept)
        .flatMap((candidate) => relatedEventsForSlice(model, candidate)), (event) => event.id ?? event.name);
}

function stateFieldsBeforeCommand(command, events, slice, model) {
    const outputIds = new Set(commandOutputEvents(command, events).map((event) => event.id));
    return uniqueFields(stateEventsForSlice(model, slice, events)
        .filter((event) => !outputIds.has(event.id))
        .flatMap((event) => event.fields ?? []));
}

function stateFieldForEventField(field, stateFields) {
    if ((stateFields ?? []).some((candidate) => candidate.name === field.name)) return true;
    return Boolean(field.source?.from?.some((name) => {
        const sourceName = String(name).split('.').pop();
        return (stateFields ?? []).some((candidate) => candidate.name === sourceName);
    }));
}

function isStateResolvableResultField(field, stateFields) {
    return Boolean((field.idAttribute || field.source?.from?.length || field.source?.rule)
        && stateFieldForEventField(field, stateFields));
}

function resultFieldsForEvent(event, command = null, stateFields = []) {
    if (!event) return [];
    const commandFieldNames = new Set((command?.fields ?? []).map((field) => field.name));
    return (event.fields ?? []).filter((field) =>
        (!commandFieldNames.has(field.name) || isPortOutputField(field))
        && !isStateResolvableResultField(field, stateFields)
        && !(field.idAttribute && field.generated)
    );
}

function commandResultFields(command) {
    return command?.resultFields ?? [];
}

function constructorArgsFromCommand(fields) {
    return fields.map((field) => `${field.name} = command.${field.name}`).join(', ');
}

function resultVariant(name, properties, resultName) {
    if (!String(properties ?? '').trim()) {
        return `    class ${name} : ${resultName}`;
    }
    return `    data class ${name}(
${properties}
    ) : ${resultName}`;
}

function infrastructureConceptPackage(slice) {
    return _sliceTitle(slice.concepts?.[0] ?? slice.name);
}

function slicePortPackage(rootPackage, slice) {
    return `${rootPackage}.${contextPackage(slice.context)}.${_sliceTitle(slice.title)}`;
}

function slicePortPath(slice) {
    return `${contextPackage(slice.context)}/${_sliceTitle(slice.title)}`;
}

function secondaryPortPackage(rootPackage, slice) {
    return `${rootPackage}.${contextPackage(slice.context)}.infrastructure.secondary.${infrastructureConceptPackage(slice)}.routing`;
}

function secondaryPortPath(slice) {
    return `${contextPackage(slice.context)}/infrastructure/secondary/${infrastructureConceptPackage(slice)}/routing`;
}

function manualInfrastructurePortPath(slice, port) {
    return `secondary/${contextPackage(slice.context)}/${infrastructureConceptPackage(slice)}/${manualInfrastructurePortDirectory(port.capability.portName)}`;
}

function manualInfrastructurePortPathForCommand(slice, command) {
    if (!command?.port) return null;
    return `secondary/${contextPackage(slice.context)}/${infrastructureConceptPackage(slice)}/${manualInfrastructurePortDirectory(portCapability(slice, command).portName)}`;
}

function manualInfrastructurePortDirectory(portName) {
    return _sliceTitle(String(portName ?? '').replace(/Service$/, ''));
}

function infrastructurePortForCommand(command, events, slice, model) {
    if (!isInfrastructurePortCommand(command, events)) return null;
    const outputs = commandOutputEvents(command, events);
    const successEvent = outputs.find((event) => !isFailureOutcome(event)) ?? outputs[0];
    const failureEvent = outputs.find((event) => event.id !== successEvent.id && isFailureOutcome(event));
    return {
        capability: portCapability(slice, command),
        inputFields: portInputFields(command),
        successEvent,
        ...(failureEvent ? {failureEvent} : {}),
        packageName: slicePortPackage(model.rootPackage, slice),
        pathPrefix: slicePortPath(slice),
        secondaryPackageName: secondaryPortPackage(model.rootPackage, slice),
        secondaryPathPrefix: secondaryPortPath(slice)
    };
}

const infrastructurePortWriterMethods = {
    _writeInfrastructurePortArtifacts(slice, command, events) {
        const port = infrastructurePortForCommand(command, events, slice, this.model);
        if (!port) return;

        const capability = port.capability;
        const stateFields = commandStartsLifecycle(command) ? [] : stateFieldsBeforeCommand(command, events, slice, this.model);
        const inputImports = kotlinFieldImports(port.inputFields, this.model.rootPackage);
        const successResultFields = uniqueFields([
            ...resultFieldsForEvent(port.successEvent, command, stateFields),
            ...commandResultFields(command)
        ]);
        const failureResultFields = resultFieldsForEvent(port.failureEvent, command, stateFields);
        const resultImports = kotlinFieldImports(uniqueFields([
            ...successResultFields,
            ...failureResultFields
        ]), this.model.rootPackage);
        const inputProperties = port.inputFields.map((field) =>
            `    val ${field.name}: ${mappedType(field, field.optional)}`
        ).join(',\n');
        const successProperties = successResultFields.map((field) =>
            `        val ${field.name}: ${mappedType(field, field.optional)}`
        ).join(',\n');
        const failureProperties = failureResultFields.map((field) =>
            `        val ${field.name}: ${mappedType(field, field.optional)}`
        ).join(',\n');
        const unavailableProperties = [
            '        val failureReason: String',
            failureResultFields.some((field) => field.name === 'remediationHint') ? '        val remediationHint: String? = null' : undefined
        ].filter(Boolean).join(',\n');
        const successVariant = resultVariant('Succeeded', successProperties, capability.resultName);
        const rejectedVariant = port.failureEvent ? resultVariant('Rejected', failureProperties, capability.resultName) : undefined;
        const unavailableVariant = port.failureEvent ? resultVariant('Unavailable', unavailableProperties, capability.resultName) : undefined;
        const imports = importLines([
            inputImports,
            resultImports
        ]).join('\n');

        this.fs.write(this._kotlinPath(`${port.pathPrefix}/${capability.portName}.kt`), `package ${port.packageName}

${imports}

interface ${capability.portName} {
    fun supports(input: ${capability.inputName}): Boolean = true
    fun ${capability.methodName}(input: ${capability.inputName}): ${capability.resultName}
}

data class ${capability.inputName}(
${inputProperties}
)

sealed interface ${capability.resultName} {
${successVariant}
${rejectedVariant ? `\n${rejectedVariant}` : ''}
${unavailableVariant ? `\n${unavailableVariant}` : ''}
}
`);

        const routerClass = `${capability.portName}Router`;
        this.fs.write(this._kotlinPath(`${port.secondaryPathPrefix}/${routerClass}.kt`), `package ${port.secondaryPackageName}

import ${port.packageName}.${capability.inputName}
import ${port.packageName}.${capability.portName}
import ${port.packageName}.${capability.resultName}
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
                ${port.failureEvent ? `${capability.resultName}.Unavailable(
                    failureReason = ex.message ?: "${capability.portName} is unavailable."
                )` : `throw ex`}
            }
            0 -> ${port.failureEvent ? `${capability.resultName}.Unavailable(
                failureReason = "No ${capability.portName} adapter supports the requested input."
            )` : `error("No ${capability.portName} adapter supports the requested input.")`}
            else -> ${port.failureEvent ? `${capability.resultName}.Unavailable(
                failureReason = "Multiple ${capability.portName} adapters support the requested input."
            )` : `error("Multiple ${capability.portName} adapters support the requested input.")`}
        }
    }
}
`);
    }
};

module.exports = {
    constructorArgsFromCommand,
    commandResultFields,
    infrastructurePortForCommand,
    manualInfrastructurePortPath,
    manualInfrastructurePortPathForCommand,
    resultFieldsForEvent,
    infrastructurePortWriterMethods
};
