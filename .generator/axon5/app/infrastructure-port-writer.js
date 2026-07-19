/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {
    outboundEvents,
    kotlinFieldImports,
    mappedType,
    pascal,
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
    return outputs.length === 2 && outputs.some(isFailureOutcome) && outputs.some((event) => !isFailureOutcome(event));
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

function infrastructurePortForCommand(command, events, slice, model) {
    if (!isInfrastructurePortCommand(command, events)) return null;
    const outputs = commandOutputEvents(command, events);
    const successEvent = outputs.find((event) => !isFailureOutcome(event)) ?? outputs[0];
    const failureEvent = outputs.find(isFailureOutcome) ?? outputs[1];
    return {
        capability: portCapability(slice, command),
        inputFields: portInputFields(command),
        successEvent,
        failureEvent,
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
        const inputImports = kotlinFieldImports(port.inputFields, this.model.rootPackage);
        const resultImports = kotlinFieldImports(uniqueFields([
            ...resultFieldsForEvent(port.successEvent),
            ...resultFieldsForEvent(port.failureEvent)
        ]), this.model.rootPackage);
        const inputProperties = port.inputFields.map((field) =>
            `    val ${field.name}: ${mappedType(field, field.optional)}`
        ).join(',\n');
        const successProperties = resultFieldsForEvent(port.successEvent).map((field) =>
            `        val ${field.name}: ${mappedType(field, field.optional)}`
        ).join(',\n');
        const failureProperties = resultFieldsForEvent(port.failureEvent).map((field) =>
            `        val ${field.name}: ${mappedType(field, field.optional)}`
        ).join(',\n');
        const unavailableProperties = [
            '        val failureReason: String',
            resultFieldsForEvent(port.failureEvent).some((field) => field.name === 'remediationHint') ? '        val remediationHint: String? = null' : undefined
        ].filter(Boolean).join(',\n');
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
    }
};

module.exports = {
    constructorArgsFromCommand,
    infrastructurePortForCommand,
    infrastructurePortWriterMethods
};
