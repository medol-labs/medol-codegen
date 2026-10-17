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
    selectionEntityIdProperty,
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
    stateEnumEntry,
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
    commandResultFields,
    infrastructurePortForCommand
} = require('./infrastructure-port-writer');
const {tenantScoped} = require('./tenant-support');

function lowerCamel(value) {
    const name = pascal(value);
    return safeIdentifier(name.charAt(0).toLowerCase() + name.slice(1));
}

function cleanTitle(value) {
    return String(value ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function permissionCode(name) {
    return kebab(name)
        .replace(/-/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

function uploadFileFields(command) {
    return (command.fields ?? []).filter((field) => field.uploadFile);
}

function hasUploadFile(command) {
    return uploadFileFields(command).length > 0;
}

function importableCommands(slice) {
    return (slice.commands ?? []).filter((command) => command.importable);
}

function isImportUnsupportedField(field) {
    return field.cardinality === 'Multiple' || field.valueType?.kind === 'object';
}

function importConversionExpression(field) {
    const required = field.optional ? 'false' : 'true';
    const fieldName = escapeKotlin(field.name);
    const optionSet = field.valueType?.kind === 'enum' && (field.valueType.values ?? []).length > 0
        ? {enumName: field.valueType.name}
        : undefined;
    const fieldOptions = optionSet ?? (field.options?.length || field.enumOptions?.length ? {enumName: field.enumName ?? pascal(field.name)} : undefined);
    if (fieldOptions?.enumName) {
        const raw = `dataImportService.string(row, "${fieldName}", ${required})`;
        return field.optional
            ? `${raw}?.let { ${fieldOptions.enumName}.valueOf(it.trim().uppercase().replace(Regex("[^A-Z0-9]+"), "_")) }`
            : `${fieldOptions.enumName}.valueOf(${raw}!!.trim().uppercase().replace(Regex("[^A-Z0-9]+"), "_"))`;
    }
    const type = String(field.valueType?.resolvedBaseType ?? field.type ?? 'String').toLowerCase();
    const method = (() => {
        switch (type) {
            case 'uuid': return 'uuid';
            case 'int':
            case 'integer': return 'int';
            case 'long': return 'long';
            case 'decimal':
            case 'bigdecimal':
            case 'number': return 'decimal';
            case 'boolean': return 'boolean';
            case 'date':
            case 'localdate': return 'date';
            case 'datetime':
            case 'localdatetime':
            case 'instant': return 'dateTime';
            default: return 'string';
        }
    })();
    const expression = `dataImportService.${method}(row, "${fieldName}", ${required})`;
    return field.optional ? expression : `${expression}!!`;
}

function normalizeArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function reportGenerationWarning(target, message) {
    if (!target || !message) return;
    const warnings = target.generationWarnings ?? [];
    if (!warnings.includes(message)) {
        warnings.push(message);
        target.generationWarnings = warnings;
        target.log?.(`Warning: ${message}`);
    }
}

function eligibilityGuardsForCommand(model, command, slice, warningsTarget) {
    const readModels = (model.slices ?? [])
        .flatMap((candidateSlice) => (candidateSlice.readmodels ?? []).map((readmodel) => ({
            readmodel,
            slice: candidateSlice,
            context: candidateSlice.context ?? candidateSlice.chapter
        })));
    return (command.fields ?? [])
        .filter((field) => field?.source?.kind === 'direct')
        .flatMap((field) => normalizeArray(field?.source?.from).map((source) => ({field, source: String(source)})))
        .map(({field, source}) => eligibilityGuardForField(model, command, slice, field, source, readModels, warningsTarget))
        .filter(Boolean);
}

function eligibilityGuardForField(model, command, slice, field, source, readModels, warningsTarget) {
    const sourceParts = source.split('.').filter(Boolean);
    const sourceField = sourceParts.pop();
    const sourceOwner = sourceParts.pop();
    const sourceContext = sourceParts.join('.');
    if (!sourceOwner || !sourceField) return null;
    const matches = readModels.filter(({readmodel, context}) =>
        (!sourceContext || context === sourceContext) && readModelMatchesSource(readmodel, sourceOwner)
        && (readmodel.fields ?? []).some((candidate) => candidate.name === sourceField)
    );
    if (model.tenancy && matches.length > 1) throw new Error(`Ambiguous tenant selection source ${source}; qualify its context.`);
    const info = matches[0];
    if (!info) return null;
    const tenantReference = tenantScoped(model, info.context)
        && (info.readmodel.fields ?? []).filter((candidate) => candidate.idAttribute).length === 1
        && (info.readmodel.fields ?? []).some((candidate) => candidate.idAttribute && candidate.name === sourceField);
    const eligibility = eligibilityForCommand(info.readmodel.eligibility, command, slice)
        ?? (tenantReference ? {conditions: []} : null);
    if (!eligibility) return null;
    const fieldByName = new Map((info.readmodel.fields ?? []).map((candidate) => [candidate.name, candidate]));
    const eligibilityConditions = normalizeArray(eligibility.conditions);
    const conditions = eligibilityConditions
        .map((condition) => eligibilityConditionForReadModel(condition, info.readmodel, fieldByName, model.rootPackage));
    if ((!tenantReference && conditions.length === 0) || !conditions.every(Boolean)) {
        const unmappedConditions = eligibilityConditions.filter((condition, index) => !conditions[index]);
        reportGenerationWarning(
            warningsTarget,
            `Projection eligibility for ${cleanTitle(info.readmodel.title)}${eligibility.profile ? ` profile ${cleanTitle(eligibility.profile)}` : ''} cannot be generated as backend guard for command ${cleanTitle(command?.title ?? command?.name)} field ${field.name}: unmapped condition(s) ${unmappedConditions.map(eligibilityConditionText).join(', ')}. Materialize these fields on the projection or enforce the rule in command policy.`
        );
        if (tenantReference) throw new Error('Tenant selection eligibility cannot be mapped to its projection fields.');
        return null;
    }
    const readModelName = _readmodelTitle(info.readmodel.title);
    const repositoryName = `${readModelName}Repository`;
    const repositoryVariable = lowerCamel(repositoryName);
    const projectionVariable = `${lowerCamel(readModelName)}Selection`;
    const packageName = `${model.rootPackage}.${contextPackage(info.context)}.${_sliceTitle(info.slice.title)}`;
    return {
        rootPackage: model.rootPackage,
        field,
        readmodel: info.readmodel,
        repositoryName,
        repositoryVariable,
        repositoryImport: `import ${packageName}.${repositoryName}`,
        typeImports: uniqueImportLines([
            kotlinFieldImports(conditions.map((condition) => condition.field), model.rootPackage),
            ...conditions.map((condition) => eligibilityConditionTypeImport(model, info.context, condition.field))
        ].filter(Boolean).join('\n')),
        projectionVariable,
        conditions,
        profile: eligibility.profile,
        commandName: cleanTitle(command?.title ?? command?.name),
        projectionName: cleanTitle(info.readmodel.title),
        i18nKey: `errors.${contextPackage(slice.context ?? slice.chapter)}.${lowerCamel(command?.title ?? command?.name)}.${lowerCamel(info.readmodel.title)}.notEligible`,
        message: `${cleanTitle(info.readmodel.title)} selection is not eligible${eligibility.profile ? ` for ${cleanTitle(eligibility.profile)}` : ''}.`
    };
}

function uniqueImportLines(value) {
    return uniqueBy(String(value ?? '')
        .split('\n')
        .map((line) => line.trim().replace(/;$/, ''))
        .filter(Boolean), (line) => line)
        .join('\n');
}

function eligibilityConditionTypeImport(model, context, field) {
    if (field.type?.endsWith('.State')) {
        const concept = field.type.split('.')[0];
        return `import ${model.rootPackage}.${contextPackage(context)}.domain.states.${conceptStateEnumName(concept)}`;
    }
    return '';
}

function readModelMatchesSource(readmodel, sourceOwner) {
    const sourceKey = normalizeEligibilityKey(sourceOwner);
    return [
        readmodel.id,
        readmodel.name,
        readmodel.title,
        cleanTitle(readmodel.title)
    ].filter(Boolean).map(normalizeEligibilityKey)
        .some((key) =>
            key === sourceKey
            || key.startsWith(sourceKey)
            || key.endsWith(sourceKey)
            || sourceKey.startsWith(key)
            || sourceKey.endsWith(key)
        );
}

function eligibilityForCommand(eligibilities, command, slice) {
    const normalized = normalizeArray(eligibilities);
    if (normalized.length === 0) return null;
    const keys = commandEligibilityProfileKeys(command, slice);
    return normalized.find((eligibility) =>
        eligibility.profile && keys.has(normalizeEligibilityKey(eligibility.profile))
    ) ?? normalized.find((eligibility) => !eligibility.profile) ?? null;
}

function commandEligibilityProfileKeys(command, slice) {
    return new Set([
        command?.id,
        command?.name,
        command?.title,
        cleanTitle(command?.title),
        slice?.id,
        slice?.name,
        slice?.title,
        cleanTitle(slice?.title)
    ].filter(Boolean).map(normalizeEligibilityKey));
}

function normalizeEligibilityKey(value) {
    return cleanTitle(String(value ?? '')).replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
}

function eligibilityConditionForReadModel(condition, readmodel, fieldByName, rootPackage) {
    const field = eligibilityConditionField(condition?.left, readmodel, fieldByName);
    const operator = eligibilityConditionOperator(condition?.operator);
    if (!field || !operator) return null;
    return {
        field,
        expression: `${field.name} ${operator} ${eligibilityConditionValue(condition?.right, field, rootPackage)}`
    };
}

function eligibilityConditionField(left, readmodel, fieldByName) {
    const parts = String(left ?? '').split('.').filter(Boolean);
    if (parts.length > 1 && !readModelMatchesSource(readmodel, parts[0])) {
        return fieldByName.get(String(left ?? '')) ?? null;
    }
    const candidates = [
        String(left ?? ''),
        parts.at(-1)
    ].filter(Boolean);
    return candidates.map((candidate) => fieldByName.get(candidate)).find(Boolean) ?? null;
}

function eligibilityConditionOperator(operator) {
    switch (operator) {
        case '==': return '==';
        case '!=': return '!=';
        case '>': return '>';
        case '>=': return '>=';
        case '<': return '<';
        case '<=': return '<=';
        default: return null;
    }
}

function eligibilityConditionValue(value, field) {
    if (value === null) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') return literal(value, field.type);
    if (field.type === 'String' || !field.type) return literal(value, 'String');
    if (field.type.endsWith('.State')) {
        return `${conceptStateEnumName(field.type.split('.')[0])}.${stateEnumEntry(value)}`;
    }
    return `${pascal(field.type)}.${constant(value)}`;
}

function eligibilityConditionText(condition) {
    return `${condition?.left ?? '?'} ${condition?.operator ?? '?'} ${JSON.stringify(condition?.right)}`;
}

function renderEligibilityGuard(guard) {
    const checks = guard.conditions
        .map((condition) => `${guard.projectionVariable}.${condition.expression}`)
        .join(' && ') || 'true';
    const lookup = guard.field.optional
        ? `command.${guard.field.name}?.let { ${guard.repositoryVariable}.findById(it) }`
        : `${guard.repositoryVariable}.findById(command.${guard.field.name})`;
    const requireExpression = guard.field.optional
        ? `command.${guard.field.name} == null || (${guard.projectionVariable} != null && ${checks})`
        : `${guard.projectionVariable} != null && ${checks}`;
    return `        val ${guard.projectionVariable} = ${lookup}
        if (!(${requireExpression})) {
            throw ${guard.rootPackage}.shared.domain.CommandRejectedException(
                code = "SELECTION_NOT_ELIGIBLE",
                i18nKey = "${escapeKotlin(guard.i18nKey)}",
                args = mapOf(
                    "command" to "${escapeKotlin(guard.commandName)}",
                    "projection" to "${escapeKotlin(guard.projectionName)}",
                    "field" to "${escapeKotlin(guard.field.name)}",
                    "profile" to ${guard.profile ? `"${escapeKotlin(cleanTitle(guard.profile))}"` : 'null'}
                ),
                message = "${escapeKotlin(guard.message)}"
            )
        }`;
}

function uploadMetadataExpression(field, storedVariable) {
    switch (field.name) {
        case 'originalFileName': return `${storedVariable}.originalFileName`;
        case 'contentType': return `${storedVariable}.contentType`;
        case 'sizeBytes': return `${storedVariable}.sizeBytes`;
        case 'fileLocation':
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
        const scoped = tenantScoped(this.model, command.context ?? (this.model.slices ?? []).find((slice) => slice.commands?.some((item) => item.id === command.id))?.context);
        const ownerSlice = (this.model.slices ?? []).find((slice) => slice.commands?.some((item) => item.id === command.id));
        const related = scoped && ownerSlice ? relatedStateForCommand(this.model, ownerSlice, command, relatedEventsForSlice(this.model, ownerSlice)) : undefined;
        const relatedSelection = related ? selectionFor(related.slice, this.model) : undefined;
        const relatedProperty = relatedSelection ? `\n    @get:com.fasterxml.jackson.annotation.JsonIgnore
    val medolRelatedSelection: ${related.stateTarget.packageName}.${relatedSelection.name}
        get() = ${related.stateTarget.packageName}.${relatedSelection.name}(${relatedSelection.fields.map((field) => `${field.alias} = ${relatedSelection.fields.length === 1 ? `this.${related.idProperty}` : `this.${field.alias}`}`).join(', ')}, medolTenantScope = requireNotNull(medolTenantScope))\n` : '';
        const commandName = _commandTitle(command.title);
        const commandFields = commandFieldsWithSelection(command, selection).filter((field) => !field.portOutput);
        if (this.model.tenancy && commandFields.some((field) => ['medolTenantScope', 'medolTenantUser', 'medolTenantScoped'].includes(field.name))) {
            throw new Error('medolTenantScope, medolTenantUser and medolTenantScoped are reserved technical command properties when tenancy is enabled.');
        }
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
        const selectionArgs = [...selection.fields.map((field) => `${field.alias} = ${field.commandExpression}`), ...(scoped ? ['medolTenantScope = requireNotNull(medolTenantScope) { "Tenant command has not been verified." }'] : [])].join(', ');
        const selectionEntityIds = selection.fields
            .filter((field) => field.derived)
            .map((field) => `    val ${selectionEntityIdProperty(field)}: String = ${field.commandExpression}`)
            .join('\n');
        const reservationSelections = commandReservations.map((reservation) =>
            `${scoped ? '    @get:com.fasterxml.jackson.annotation.JsonIgnore\n' : ''}    val ${reservation.selectionProperty}: ${reservation.selectionName}${scoped ? '\n        get()' : ''} = ${reservation.selectionName}(${[...reservation.selectionArgs, ...(scoped ? ['medolTenantScope = requireNotNull(medolTenantScope)'] : [])].join(', ')})`
        ).join('\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${commandName}.kt`), `package ${packageName}

import org.axonframework.messaging.commandhandling.annotation.Command
import org.axonframework.modelling.annotation.TargetEntityId
${selectionImport}${imports}

@Command
data class ${commandName}(
${properties}
)${this.model.tenancy ? ` : ${this.model.rootPackage}.shared.application.tenancy.TenantCommand` : ''} {
${this.model.tenancy ? `    @get:com.fasterxml.jackson.annotation.JsonIgnore
    override val medolTenantScoped: Boolean = ${scoped}
    @get:com.fasterxml.jackson.annotation.JsonIgnore
    @set:com.fasterxml.jackson.annotation.JsonIgnore
    override var medolTenantScope: String? = ${scoped ? `${this.model.rootPackage}.shared.application.tenancy.TenantScope.current()?.tenantId` : 'null'}
    @get:com.fasterxml.jackson.annotation.JsonIgnore
    @set:com.fasterxml.jackson.annotation.JsonIgnore
    override var medolTenantUser: String? = ${scoped ? `${this.model.rootPackage}.shared.application.tenancy.TenantScope.current()?.userId` : 'null'}
` : ''}
${scoped ? '    @get:com.fasterxml.jackson.annotation.JsonIgnore\n' : ''}    @${scoped ? 'get:' : ''}TargetEntityId
    val selection: ${selection.name}${scoped ? '\n        get()' : ''} = ${selection.name}(${selectionArgs})
${relatedProperty}
${selectionEntityIds ? `\n${selectionEntityIds}` : ''}
${reservationSelections ? `\n${reservationSelections}` : ''}
}
`);
    },

    _writeCommandHandlers(packageName, context, slicePackage, slice, selection, events, reservations = []) {
        const scoped = tenantScoped(this.model, slice.context);
        const stateTarget = stateTargetFor(this.model, slice);
        const stateName = stateTarget.name;
        const decisionName = `${pascal(slice.name)}Decision`;
        const injectEntity = scoped ? '(idProperty = "selection")' : injectEntityExpression(selection);
        const handlers = slice.commands.map((command) => {
            const commandName = _commandTitle(command.title);
            const port = infrastructurePortForCommand(command, events, slice, this.model);
            const usePort = Boolean(port);
            const capability = port?.capability;
            const inputFields = port?.inputFields ?? [];
            const returnsPortResult = commandResultFields(command).length > 0 && usePort;
            const eligibilityGuards = eligibilityGuardsForCommand(this.model, command, slice, this);
            const eligibilityStatements = eligibilityGuards.map(renderEligibilityGuard).join('\n');
            const commandReservations = commandStartsLifecycle(command) ? reservations : [];
            const relatedState = relatedStateForCommand(this.model, slice, command, events);
            const includeState = !commandStartsLifecycle(command) || Boolean(relatedState);
            const commandStateTarget = relatedState?.stateTarget ?? stateTarget;
            const commandStateName = commandStateTarget.name;
            const commandInjectEntity = relatedState
                ? `(idProperty = "${scoped ? 'medolRelatedSelection' : escapeKotlin(relatedState.idProperty)}")`
                : injectEntity;
            const methodParameters = [
                `command: ${commandName}`,
                includeState ? `@InjectEntity${commandInjectEntity} state: ${commandStateName}` : undefined,
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
            const transition = transitionForCommand(this.model, command);
            const portPrecondition = usePort && includeState && transition?.from
                ? `${renderStateGuard(this.model, transition)}\n`
                : '';
            const portStatements = usePort
                ? `${portPrecondition}        val input = ${capability.inputName}(${constructorArgsFromCommand(inputFields)})
        val portResult = ${lowerCamel(capability.portName)}.${capability.methodName}(input)
${port?.failureEvent ? '        val now = java.time.LocalDateTime.now()\n' : ''}
`
                : '';
            const returnType = returnsPortResult ? `: ${capability.resultName}` : '';
            const appendEvents = `eventAppender.append(decision.decide(${decisionArgs}))`;
            const bodyEnd = returnsPortResult
                ? `        ${appendEvents}
        ${scoped ? '' : 'return '}portResult`
                : `        ${appendEvents}`;
            return `    @CommandHandler
    fun handle(
${methodParameters}
    )${returnType} {
${scoped ? `        return ${this.model.rootPackage}.shared.application.tenancy.TenantScope.withIdentity(
            ${this.model.rootPackage}.shared.application.tenancy.TenantIdentity(requireNotNull(command.medolTenantScope), requireNotNull(command.medolTenantUser))
        ) {\n` : ''}
${eligibilityStatements ? `${eligibilityStatements}\n` : ''}\
${portStatements}\
${bodyEnd}
${scoped ? '        }' : ''}
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
        const eligibilityGuards = slice.commands.flatMap((command) => eligibilityGuardsForCommand(this.model, command, slice, this));
        const eligibilityRepositories = uniqueBy(eligibilityGuards, (guard) => guard.repositoryVariable);
        const eligibilityConstructorParams = eligibilityRepositories.map((guard) =>
            `,\n    private val ${guard.repositoryVariable}: ${guard.repositoryName}`
        ).join('');
        const eligibilityRepositoryImports = uniqueBy(eligibilityRepositories.map((guard) => guard.repositoryImport), (value) => value).join('\n');
        const eligibilityTypeImports = uniqueImportLines(eligibilityGuards.map((guard) => guard.typeImports).filter(Boolean).join('\n'));
        const stateImports = uniqueBy(slice.commands
            .map((command) => relatedStateForCommand(this.model, slice, command, events)?.stateTarget
                ?? (!commandStartsLifecycle(command) ? stateTarget : undefined))
            .filter((target) => target && target.packageName !== packageName)
            .map((target) => `import ${target.packageName}.${target.name}`), (value) => value)
            .join('\n');
        const stateEnumImports = uniqueBy(slice.commands
            .map((command) => ({command, transition: transitionForCommand(this.model, command)}))
            .filter(({command, transition}) =>
                Boolean(infrastructurePortForCommand(command, events, slice, this.model))
                && transitionUsesConceptState(this.model, transition)
            )
            .map(({transition}) => `import ${this.model.rootPackage}.${contextPackage(transition.context ?? slice.context)}.domain.states.${conceptStateEnumName(transition.owner.name)}`), (value) => value)
            .join('\n');
        const reservationStateImports = reservations.map((reservation) => `import ${reservation.packageName}.${reservation.stateName}`).join('\n');
        const injectEntityImport = slice.commands.some((command) =>
            !commandStartsLifecycle(command)
            || Boolean(relatedStateForCommand(this.model, slice, command, events))
            || reservations.length > 0
        )
            ? 'import org.axonframework.modelling.annotation.InjectEntity\n'
            : '';
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${pascal(slice.name)}CommandHandler.kt`), `package ${packageName}

import org.axonframework.messaging.commandhandling.annotation.CommandHandler
import org.axonframework.messaging.eventhandling.gateway.EventAppender
${injectEntityImport}\
import org.springframework.stereotype.Component
${commandImports}
${portImports}
${eligibilityRepositoryImports}
${eligibilityTypeImports}
${stateImports}
${stateEnumImports}
${reservationStateImports}

@Component
class ${pascal(slice.name)}CommandHandler(
    private val decision: ${decisionName}${portConstructorParams}${eligibilityConstructorParams}
) {
${handlers}
}
`);
    },

    _writeCommandResource(packageName, context, slicePackage, slice) {
        const resourceName = `${pascal(slice.name)}Resource`;
        const conceptRoute = httpRoute(slice.concepts[0] ?? slice.name);
        const uploadCommands = slice.commands.filter(hasUploadFile);
        const importCommands = importableCommands(slice);
        uploadCommands.forEach((command) => this._writeUploadFileStoragePort(packageName, context, slicePackage, command));
        if (importCommands.length > 0) {
            this._writeDataImportSupport();
            this._writeDataImportJobAxonPorts();
            this._writeDataImportProcessor();
            importCommands.forEach((command) => this._writeDataImportCommandExecutor(packageName, context, slicePackage, slice, command));
        }
        const constructorParams = [
            'private val commandGateway: CommandGateway',
            ...(importCommands.length > 0 ? ['private val dataImportService: DataImportService'] : []),
            ...uploadCommands.map((command) => `private val ${lowerCamel(uploadStorageName(command))}: ${uploadStorageName(command)}`)
        ].join(',\n    ');
        const methods = slice.commands.map((command) => {
            const commandName = _commandTitle(command.title);
            const port = infrastructurePortForCommand(command, relatedEventsForSlice(this.model, slice), slice, this.model);
            const returnsPortResult = commandResultFields(command).length > 0 && port;
            const returnType = returnsPortResult ? port.capability.resultName : commandName;
            const sendExpression = returnsPortResult
                ? `commandGateway.send(command, MetadataFactory.from(request)).resultAs(${port.capability.resultName}::class.java)`
                : `commandGateway.send(command, MetadataFactory.from(request)).resultMessage.thenApply { command }`;
            const preAuthorize = `    @PreAuthorize("hasAuthority('*:*') or hasAuthority('${permissionCode(command.name ?? command.title)}:execute')")`;
            const jsonEndpoint = hasUploadFile(command) ? '' : `${preAuthorize}
    @PostMapping("/${httpRoute(command.title)}")
    fun ${safeIdentifier(command.name)}(
        @Valid @RequestBody command: ${commandName},
        request: HttpServletRequest
    ): CompletableFuture<${returnType}> =
        ${sendExpression}`;
            const multipartEndpoint = this._renderUploadFileCommandEndpoint(command);
            const importEndpoint = this._renderDataImportCommandEndpoint(command, conceptRoute);
            return [jsonEndpoint, multipartEndpoint, importEndpoint].filter(Boolean).join('\n\n');
        }).join('\n\n');
        const commandFieldImports = kotlinFieldImports(uniqueFields(slice.commands.flatMap((command) => command.fields ?? [])), this.model.rootPackage);
        const commandResultImports = uniqueBy(slice.commands
            .map((command) => {
                const port = infrastructurePortForCommand(command, relatedEventsForSlice(this.model, slice), slice, this.model);
                return commandResultFields(command).length > 0 && port
                    ? `import ${port.packageName}.${port.capability.resultName}`
                    : undefined;
            })
            .filter(Boolean), (value) => value)
            .join('\n');
        const uploadImports = uploadCommands.length > 0
            ? `import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.multipart.MultipartFile
${commandFieldImports ? `${commandFieldImports}\n` : ''}`
            : '';
        const importImports = importCommands.length > 0
            ? `import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.multipart.MultipartFile
import ${this.model.rootPackage}.shared.application.importing.DataImportJobResponse
import ${this.model.rootPackage}.shared.application.importing.DataImportService
${commandFieldImports ? `${commandFieldImports}\n` : ''}`
            : '';
        const multipartImports = uniqueImportLines(`${uploadImports}\n${importImports}`);
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${resourceName}.kt`), `package ${packageName}

import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.CrossOrigin
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import ${this.model.rootPackage}.shared.application.metadata.MetadataFactory
${multipartImports}
${commandResultImports}
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
        const resolvedIdVariable = idField?.generated ? `resolved${pascal(idField.name)}` : null;
        const resolvedIdStatement = resolvedIdVariable
            ? `        val ${resolvedIdVariable} = ${idField.name} ?: ${fallbackValue(idField).replaceAll('java.util.UUID.', 'UUID.')}\n`
            : '';
        const uploadIdExpression = resolvedIdVariable
            ? `${resolvedIdVariable}.toString()`
            : idField ? `${idField.name}?.toString()` : 'null';
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
                if (field === idField && resolvedIdVariable) {
                    return `            ${field.name} = ${resolvedIdVariable}`;
                }
                return `            ${field.name} = ${field.name} ?: ${fallbackValue(field).replaceAll('java.util.UUID.', 'UUID.')}`;
            }
            return `            ${field.name} = ${field.name}`;
        }).join(',\n');
        return `    @PreAuthorize("hasAuthority('*:*') or hasAuthority('${permissionCode(command.name ?? command.title)}:execute')")
    @PostMapping("/${httpRoute(command.title)}/file", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun ${safeIdentifier(command.name)}File(
${parameters}
    ): CompletableFuture<${commandName}> {
${resolvedIdStatement}${storeStatements}
        val command = ${commandName}(
${constructorArgs}
        )
        return commandGateway.send(command, MetadataFactory.from(request)).resultMessage.thenApply { command }
    }`;
    },

    _writeDataImportSupport() {
        if (this._dataImportSupportWritten) {
            return;
        }
        this._dataImportSupportWritten = true;
        const basePath = 'shared/application/importing';
        const basePackage = `${this.model.rootPackage}.shared.application.importing`;
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/DataImportModels.kt`), `package ${basePackage}

import java.time.Instant
import java.util.UUID

data class DataImportJobResponse(
    val jobId: UUID,
    val status: String,
    val originalFileName: String,
    val errorMessage: String? = null
)

data class DataImportJobRequestMessage(
    val dataImportJobId: UUID,
    val commandName: String,
    val resourceName: String,
    val originalFileName: String,
    val filePath: String,
    val requestedLocale: String?,
    val requestedAt: Instant,
    val requestHash: String
)

data class DataImportExecutionTask(
    val dataImportJobId: UUID,
    val commandName: String,
    val resourceName: String,
    val originalFileName: String,
    val filePath: String,
    val requestedLocale: String?,
    val requestedAt: Instant,
    val requestHash: String,
    val userId: String?,
    val sessionId: String?,
    val correlationId: String?,
    val causationId: String?,
    val traceId: String?,
    val tenantId: String?
)

data class DataImportExecutionResult(
    val totalRows: Long,
    val successRows: Long,
    val failedRows: Long,
    val failureIndexPath: String? = null
)

data class DataImportRowError(
    val rowNumber: Long,
    val rowHash: String,
    val errorCode: String?,
    val message: String
)
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/DataImportProperties.kt`), `package ${basePackage}

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.stereotype.Component

@Component
@ConfigurationProperties(prefix = "medol.data-exchange.import")
class DataImportProperties {
    var batchSize: Int = 1000
    var maxRows: Long = 800000
    var maxFileSizeBytes: Long = 104857600
    var errorPreviewLimit: Int = 200
    var storagePath: String = "build/data-imports"
}
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/DataImportPorts.kt`), `package ${basePackage}

import java.util.UUID
import org.axonframework.messaging.core.Metadata

interface DataImportJobRequestPort {
    fun request(message: DataImportJobRequestMessage, metadata: Metadata)
}

interface DataImportJobLifecyclePort {
    fun markProcessing(dataImportJobId: UUID, totalRows: Long)
    fun complete(dataImportJobId: UUID, totalRows: Long, successRows: Long, failedRows: Long, failureIndexPath: String?)
    fun fail(dataImportJobId: UUID, errorMessage: String)
}

interface DataImportCommandExecutor {
    val commandName: String
    fun execute(task: DataImportExecutionTask): DataImportExecutionResult
}
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/DataImportCommandExecutorRegistry.kt`), `package ${basePackage}

import org.springframework.beans.factory.ObjectProvider
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.server.ResponseStatusException

@Component
class DataImportCommandExecutorRegistry(
    executors: ObjectProvider<DataImportCommandExecutor>
) {
    private val executorsByCommandName = executors.orderedStream()
        .toList()
        .associateBy { it.commandName }

    fun executor(commandName: String): DataImportCommandExecutor =
        executorsByCommandName[commandName]
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "No data import executor registered for $commandName.")
}
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/DataImportService.kt`), `package ${basePackage}

import org.springframework.beans.factory.ObjectProvider
import org.axonframework.messaging.core.Metadata
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import java.io.InputStream
import java.math.BigDecimal
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.util.UUID
import kotlin.io.path.createDirectories

@Service
class DataImportService(
    private val properties: DataImportProperties,
    private val requestPort: ObjectProvider<DataImportJobRequestPort>
) {
    fun request(
        commandName: String,
        resourceName: String,
        originalFileName: String,
        contentType: String?,
        requestedLocale: String?,
        inputStream: InputStream,
        metadata: Metadata
    ): ResponseEntity<DataImportJobResponse> {
        val bytes = inputStream.readBytes()
        if (bytes.size.toLong() > properties.maxFileSizeBytes) {
            throw ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Data import file exceeds the configured maximum size.")
        }
        val extension = originalFileName.substringAfterLast('.', "csv").lowercase()
        if (extension != "csv") {
            throw ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Only CSV import is supported in this version.")
        }
        val requestHash = requestHash(commandName, resourceName, bytes, requestedLocale)
        val jobId = UUID.nameUUIDFromBytes(requestHash.toByteArray(StandardCharsets.UTF_8))
        val directory = ${this.model.tenancy ? `${this.model.rootPackage}.shared.application.tenancy.TenantFiles.directory(properties.storagePath).resolve(jobId.toString())` : 'Path.of(properties.storagePath, jobId.toString())'}.createDirectories()
        val safeFileName = originalFileName.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "import.csv" }
        val path = directory.resolve(safeFileName).normalize()
        Files.write(path, bytes)
        val message = DataImportJobRequestMessage(
            dataImportJobId = jobId,
            commandName = commandName,
            resourceName = resourceName,
            originalFileName = originalFileName,
            filePath = path.toString(),
            requestedLocale = requestedLocale,
            requestedAt = Instant.now(),
            requestHash = requestHash
        )
        val port = requestPort.getIfAvailable()
            ?: throw ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Data import job request port is not available.")
        port.request(message, metadata)
        return ResponseEntity.accepted().body(DataImportJobResponse(jobId, "REQUESTED", originalFileName))
    }

    fun readCsv(filePath: String): List<Map<String, String>> {
        val rows = mutableListOf<Map<String, String>>()
        processCsv(filePath) { _, row, _ -> rows += row }
        return rows
    }

    fun processCsv(filePath: String, consumer: (Long, Map<String, String>, String) -> Unit): Long {
        var headers: List<String>? = null
        var totalRows = 0L
        Files.newBufferedReader(${this.model.tenancy ? `${this.model.rootPackage}.shared.application.tenancy.TenantFiles.owned(filePath, properties.storagePath)` : 'Path.of(filePath)'}, StandardCharsets.UTF_8).useLines { lines ->
            lines.forEachIndexed { index, line ->
                val normalizedLine = if (index == 0) line.removePrefix("\\uFEFF") else line
                if (normalizedLine.isBlank()) return@forEachIndexed
                val currentHeaders = headers
                if (currentHeaders == null) {
                    headers = parseCsvLine(normalizedLine).map { it.trim() }
                    return@forEachIndexed
                }
                totalRows += 1
                if (totalRows > properties.maxRows) {
                    throw ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Data import exceeds the configured maximum row count.")
                }
                val values = parseCsvLine(normalizedLine)
                val row = currentHeaders.mapIndexed { valueIndex, header ->
                    header to (values.getOrNull(valueIndex)?.trim().orEmpty())
                }.toMap()
                consumer(index.toLong() + 1L, row, rowHash(normalizedLine))
            }
        }
        return totalRows
    }

    fun writeFailureIndex(task: DataImportExecutionTask, errors: List<DataImportRowError>): String? {
        if (errors.isEmpty()) return null
        val directory = ${this.model.tenancy ? `${this.model.rootPackage}.shared.application.tenancy.TenantFiles.directory(properties.storagePath).resolve(task.dataImportJobId.toString())` : 'Path.of(properties.storagePath, task.dataImportJobId.toString())'}.createDirectories()
        val path = directory.resolve("failure-index.csv").normalize()
        val builder = StringBuilder()
        builder.append("rowNumber,rowHash,errorCode,message\\n")
        errors.forEach { error ->
            builder.append(csvCell(error.rowNumber.toString())).append(',')
                .append(csvCell(error.rowHash)).append(',')
                .append(csvCell(error.errorCode.orEmpty())).append(',')
                .append(csvCell(error.message)).append('\\n')
        }
        Files.write(path, ("\\uFEFF" + builder.toString()).toByteArray(StandardCharsets.UTF_8))
        return path.toString()
    }

    fun string(row: Map<String, String>, field: String, required: Boolean = true): String? =
        raw(row, field, required)

    fun uuid(row: Map<String, String>, field: String, required: Boolean = true): UUID? =
        raw(row, field, required)?.let { UUID.fromString(it) }

    fun int(row: Map<String, String>, field: String, required: Boolean = true): Int? =
        raw(row, field, required)?.toInt()

    fun long(row: Map<String, String>, field: String, required: Boolean = true): Long? =
        raw(row, field, required)?.toLong()

    fun decimal(row: Map<String, String>, field: String, required: Boolean = true): BigDecimal? =
        raw(row, field, required)?.let { BigDecimal(it) }

    fun boolean(row: Map<String, String>, field: String, required: Boolean = true): Boolean? =
        raw(row, field, required)?.let {
            when (it.lowercase()) {
                "true", "yes", "y", "1", "是" -> true
                "false", "no", "n", "0", "否" -> false
                else -> throw IllegalArgumentException("$field must be boolean.")
            }
        }

    fun date(row: Map<String, String>, field: String, required: Boolean = true): LocalDate? =
        raw(row, field, required)?.let { LocalDate.parse(it) }

    fun dateTime(row: Map<String, String>, field: String, required: Boolean = true): LocalDateTime? =
        raw(row, field, required)?.let { value ->
            runCatching { LocalDateTime.parse(value) }
                .getOrElse { OffsetDateTime.parse(value).toLocalDateTime() }
        }

    private fun raw(row: Map<String, String>, field: String, required: Boolean): String? {
        val value = row[field]?.trim().orEmpty()
        if (value.isBlank()) {
            if (required) throw IllegalArgumentException("$field is required.")
            return null
        }
        return value
    }

    private fun requestHash(commandName: String, resourceName: String, bytes: ByteArray, requestedLocale: String?): String {
        val digest = MessageDigest.getInstance("SHA-256")
${this.model.tenancy ? `        digest.update(${this.model.rootPackage}.shared.application.tenancy.TenantScope.requireTenant().toByteArray(StandardCharsets.UTF_8))\n        digest.update(0.toByte())\n` : ''}\
        digest.update(commandName.toByteArray(StandardCharsets.UTF_8))
        digest.update(0.toByte())
        digest.update(resourceName.toByteArray(StandardCharsets.UTF_8))
        digest.update(0.toByte())
        digest.update(requestedLocale.orEmpty().toByteArray(StandardCharsets.UTF_8))
        digest.update(0.toByte())
        digest.update(bytes)
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun rowHash(row: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(row.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private fun parseCsvLine(line: String): List<String> {
        val values = mutableListOf<String>()
        val current = StringBuilder()
        var quoted = false
        var index = 0
        while (index < line.length) {
            val char = line[index]
            when {
                char == '"' && quoted && index + 1 < line.length && line[index + 1] == '"' -> {
                    current.append('"')
                    index += 1
                }
                char == '"' -> quoted = !quoted
                char == ',' && !quoted -> {
                    values += current.toString()
                    current.clear()
                }
                else -> current.append(char)
            }
            index += 1
        }
        values += current.toString()
        return values
    }

    private fun csvCell(value: String): String {
        val quote = '"'.toString()
        return if (value.contains(',') || value.contains(quote) || value.contains('\\n') || value.contains('\\r')) {
            quote + value.replace(quote, quote + quote) + quote
        } else {
            value
        }
    }
}
`);
    },

    _writeDataImportJobAxonPorts() {
        if (this._dataImportJobAxonPortsWritten) {
            return;
        }
        const hasDataImportJobSlice = (this.model.slices ?? []).some((slice) =>
            String(slice.name ?? slice.title ?? '').toLowerCase() === 'dataimportjob'
        );
        if (!hasDataImportJobSlice) {
            return;
        }
        this._dataImportJobAxonPortsWritten = true;
        const packageName = `${this.model.rootPackage}.dataexchange.dataimportjob`;
        this.fs.write(this._kotlinPath('dataexchange/dataimportjob/DataImportJobPorts.kt'), `package ${packageName}

import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.axonframework.messaging.core.Metadata
import org.springframework.stereotype.Component
import ${this.model.rootPackage}.dataexchange.dataimportjob.RequestDataImportCommand
import ${this.model.rootPackage}.dataexchange.dataimportjob.MarkDataImportProcessingCommand
import ${this.model.rootPackage}.dataexchange.dataimportjob.CompleteDataImportCommand
import ${this.model.rootPackage}.dataexchange.dataimportjob.FailDataImportCommand
import ${this.model.rootPackage}.shared.application.importing.DataImportJobLifecyclePort
import ${this.model.rootPackage}.shared.application.importing.DataImportJobRequestMessage
import ${this.model.rootPackage}.shared.application.importing.DataImportJobRequestPort
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.UUID

@Component
class AxonDataImportJobRequestPort(
    private val commandGateway: CommandGateway
) : DataImportJobRequestPort {
    override fun request(message: DataImportJobRequestMessage, metadata: Metadata) {
        commandGateway.send(
            RequestDataImportCommand(
                dataImportJobId = message.dataImportJobId,
                commandName = message.commandName,
                resourceName = message.resourceName,
                originalFileName = message.originalFileName,
                filePath = message.filePath,
                requestedLocale = message.requestedLocale,
                requestedAt = LocalDateTime.ofInstant(message.requestedAt, ZoneOffset.UTC),
                requestHash = message.requestHash,
                status = DataImportJobStatus.REQUESTED
            ),
            metadata
        ).resultMessage.toCompletableFuture().join()
    }
}

@Component
class AxonDataImportJobLifecyclePort(
    private val commandGateway: CommandGateway
) : DataImportJobLifecyclePort {
    override fun markProcessing(dataImportJobId: UUID, totalRows: Long) {
        commandGateway.send(MarkDataImportProcessingCommand(dataImportJobId, totalRows, DataImportJobStatus.PROCESSING)).resultMessage.toCompletableFuture().join()
    }

    override fun complete(dataImportJobId: UUID, totalRows: Long, successRows: Long, failedRows: Long, failureIndexPath: String?) {
        commandGateway.send(CompleteDataImportCommand(dataImportJobId, totalRows, successRows, failedRows, failureIndexPath, DataImportJobStatus.COMPLETED)).resultMessage.toCompletableFuture().join()
    }

    override fun fail(dataImportJobId: UUID, errorMessage: String) {
        commandGateway.send(FailDataImportCommand(dataImportJobId, errorMessage, DataImportJobStatus.FAILED)).resultMessage.toCompletableFuture().join()
    }
}

object DataImportJobStatus {
    const val REQUESTED = "REQUESTED"
    const val PROCESSING = "PROCESSING"
    const val COMPLETED = "COMPLETED"
    const val FAILED = "FAILED"
}
`);
    },

    _writeDataImportProcessor() {
        if (this._dataImportProcessorWritten) {
            return;
        }
        const automation = (this.model.slices ?? [])
            .flatMap((slice) => slice.processors ?? [])
            .find((processor) => {
                const metadata = processor.metadata ?? {};
                const uses = String(metadata.uses ?? '').toLowerCase();
                const emits = Object.entries(metadata)
                    .filter(([key]) => /^emits\d*$/.test(key))
                    .map(([, value]) => String(value).toLowerCase());
                return metadata.on === 'DataImportRequested'
                    && (uses === 'platformdataexchange.import' || uses.endsWith('dataexchange.import'))
                    && emits.includes('markdataimportprocessing')
                    && emits.includes('completedataimport')
                    && emits.includes('faildataimport');
            });
        if (!automation) {
            return;
        }
        this._dataImportProcessorWritten = true;
        const packageName = `${this.model.rootPackage}.dataexchange.dataimportjob`;
        const processorClass = `${pascal(automation.name)}Processor`;
        this.fs.write(this._kotlinPath(`dataexchange/dataimportjob/${processorClass}.kt`), `package ${packageName}

import org.axonframework.messaging.core.annotation.Namespace
import org.axonframework.messaging.eventhandling.EventMessage
import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import ${this.model.rootPackage}.dataexchange.events.DataImportRequestedEvent
import ${this.model.rootPackage}.shared.application.importing.DataImportCommandExecutorRegistry
import ${this.model.rootPackage}.shared.application.importing.DataImportExecutionTask
import ${this.model.rootPackage}.shared.application.importing.DataImportJobLifecyclePort
import ${this.model.rootPackage}.shared.application.metadata.MetadataFactory
import ${this.model.rootPackage}.shared.application.metadata.MetadataKeys
import java.time.ZoneOffset

@Namespace("automation-data-exchange-${kebab(automation.name)}")
@Component
class ${processorClass}(
    private val registry: DataImportCommandExecutorRegistry,
    private val lifecyclePort: DataImportJobLifecyclePort${this.model.tenancy ? `,\n    private val tenantAccess: ${this.model.rootPackage}.shared.application.tenancy.SameSchemaTenantAccess` : ''}
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @EventHandler
    fun on(event: DataImportRequestedEvent, message: EventMessage) {
${this.model.tenancy ? `        ${this.model.rootPackage}.shared.application.tenancy.TenantScope.withIdentity(
            tenantAccess.verify(requireNotNull(message.metadata()["tenantId"]), requireNotNull(message.metadata()["userId"]))
        ) {\n` : ''}
        val task = DataImportExecutionTask(
            dataImportJobId = event.dataImportJobId,
            commandName = event.commandName,
            resourceName = event.resourceName,
            originalFileName = event.originalFileName,
            filePath = event.filePath,
            requestedLocale = event.requestedLocale,
            requestedAt = event.requestedAt.toInstant(ZoneOffset.UTC),
            requestHash = event.requestHash,
            userId = MetadataFactory.value(message.metadata[MetadataKeys.USER_ID]?.toString()),
            sessionId = MetadataFactory.value(message.metadata[MetadataKeys.SESSION_ID]?.toString()),
            correlationId = MetadataFactory.value(message.metadata[MetadataKeys.CORRELATION_ID]?.toString()),
            causationId = MetadataFactory.value(message.metadata[MetadataKeys.CAUSATION_ID]?.toString()),
            traceId = MetadataFactory.value(message.metadata[MetadataKeys.TRACE_ID]?.toString()),
            tenantId = MetadataFactory.value(message.metadata[MetadataKeys.TENANT_ID]?.toString())
        )
        try {
            val result = registry.executor(event.commandName).execute(task)
            lifecyclePort.complete(event.dataImportJobId, result.totalRows, result.successRows, result.failedRows, result.failureIndexPath)
        } catch (ex: Exception) {
            log.warn("Data import job {} failed", event.dataImportJobId, ex)
            lifecyclePort.fail(event.dataImportJobId, ex.message ?: "Data import failed.")
        }
${this.model.tenancy ? '        }' : ''}
    }
}
`);
    },

    _writeDataImportCommandExecutor(packageName, context, slicePackage, slice, command) {
        const commandName = safeIdentifier(command.name);
        const commandClassName = `${commandName}Command`;
        const executorClassName = `${commandName}DataImportCommandExecutor`;
        const commandFields = (command.fields ?? [])
            .filter((field) => field?.name && !field.generated && !field.excludeFromApi && !field.uploadFile && !field.file);
        const unsupportedFields = commandFields.filter(isImportUnsupportedField);
        const imports = [
            `import ${packageName}.${commandClassName}`,
            'import org.axonframework.messaging.commandhandling.gateway.CommandGateway',
            'import org.springframework.stereotype.Component',
            `import ${this.model.rootPackage}.shared.application.importing.DataImportCommandExecutor`,
            `import ${this.model.rootPackage}.shared.application.importing.DataImportExecutionResult`,
            `import ${this.model.rootPackage}.shared.application.importing.DataImportExecutionTask`,
            `import ${this.model.rootPackage}.shared.application.importing.DataImportRowError`,
            `import ${this.model.rootPackage}.shared.application.importing.DataImportService`,
            `import ${this.model.rootPackage}.shared.application.metadata.MetadataFactory`,
            kotlinFieldImports(commandFields, this.model.rootPackage)
        ].filter(Boolean).join('\n');
        const assignments = commandFields.map((field) => {
            if (isImportUnsupportedField(field)) {
                return `${field.name} = ${fallbackValue(field)} /* Unsupported CSV import field: ${field.name}. Model a dedicated import command or adapter for complex values. */`;
            }
            return `${field.name} = ${importConversionExpression(field)}`;
        }).join(',\n                            ');
        const unsupportedGuard = unsupportedFields.length > 0
            ? `\n                require(false) { "Unsupported CSV import field(s): ${unsupportedFields.map((field) => field.name).join(', ')}. Model a dedicated import command or adapter for complex values." }\n`
            : '';
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${executorClassName}.kt`), `package ${packageName}

${imports}

@Component
class ${executorClassName}(
    private val commandGateway: CommandGateway,
    private val dataImportService: DataImportService
) : DataImportCommandExecutor {
    override val commandName: String = "${commandName}"

    override fun execute(task: DataImportExecutionTask): DataImportExecutionResult {
        val errors = mutableListOf<DataImportRowError>()
        var successRows = 0L
        var totalRows = 0L
        dataImportService.processCsv(task.filePath) { rowNumber, row, rowHash ->
            totalRows += 1
            try {${unsupportedGuard}
                val command = ${commandClassName}(
                    ${assignments}
                )
                val metadata = MetadataFactory.fromValues(
                    userId = task.userId,
                    sessionId = task.sessionId,
                    correlationId = task.correlationId ?: task.requestHash,
                    causationId = "${'${task.dataImportJobId}'}:${'${rowNumber}'}",
                    traceId = task.traceId ?: task.requestHash,
                    tenantId = task.tenantId
                )
                commandGateway.send(command, metadata).resultMessage.toCompletableFuture().join()
                successRows += 1
            } catch (ex: Exception) {
                errors += DataImportRowError(
                    rowNumber = rowNumber,
                    rowHash = rowHash,
                    errorCode = ex.javaClass.simpleName,
                    message = ex.message ?: "Import row failed."
                )
            }
        }
        val failureIndexPath = dataImportService.writeFailureIndex(task, errors)
        return DataImportExecutionResult(
            totalRows = totalRows,
            successRows = successRows,
            failedRows = errors.size.toLong(),
            failureIndexPath = failureIndexPath
        )
    }
}
`);
    },

    _renderDataImportCommandEndpoint(command, resourceName) {
        if (!command.importable) return '';
        const route = httpRoute(command.title);
        return `    @PreAuthorize("hasAuthority('*:*') or hasAuthority('${permissionCode(command.name ?? command.title)}:import') or hasAuthority('${permissionCode(command.name ?? command.title)}:execute')")
    @PostMapping("/${route}/import", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun ${safeIdentifier(command.name)}Import(
        @RequestPart("file") file: MultipartFile,
        @RequestParam(required = false) requestedLocale: String?,
        request: HttpServletRequest
    ): ResponseEntity<DataImportJobResponse> =
        dataImportService.request(
            commandName = "${safeIdentifier(command.name)}",
            resourceName = "${resourceName}",
            originalFileName = file.originalFilename ?: "${route}.csv",
            contentType = file.contentType,
            requestedLocale = requestedLocale,
            inputStream = file.inputStream,
            metadata = MetadataFactory.from(request)
        )`;
    },
};

module.exports = {commandWriterMethods};
