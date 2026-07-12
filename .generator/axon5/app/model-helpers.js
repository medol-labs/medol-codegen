/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {fieldOptionsFor} = require('../../common/core/field-options');
const {typeMapping, typeImports} = require('../../common/util/generator');
const {contextPackage, findValueType, resolvedBaseType, resolvedConstraints} = require('../../common/util/value-types');
const {_sliceTitle} = require('../../common/util/naming');

function selectionFor(slice, model, eventStorageMode = 'aggregate') {
    if (primaryConcept(slice)) {
        return conceptSelectionFor(slice, model, eventStorageMode);
    }
    return sliceSelectionFor(slice, eventStorageMode);
}

function uniqueReservationsForSlice(slice, model, eventStorageMode = 'aggregate') {
    const command = slice.commands?.[0];
    if (!command) return [];
    const commandFields = command.fields ?? [];
    const idFields = commandFields.filter((field) => field.idAttribute);
    const expressions = (slice.specifications ?? [])
        .flatMap((specification) => [...(specification.validates ?? []), ...(specification.expressions ?? [])])
        .map((expression) => parseUniqueExpression(expression))
        .filter(Boolean);
    return uniqueBy(expressions, (expression) => `${expression.concept}:${expression.fields.join(',')}`)
        .map((expression) => reservationForUniqueExpression(slice, model, command, commandFields, idFields, expression, eventStorageMode))
        .filter(Boolean);
}

function parseUniqueExpression(expression) {
    const value = String(expression ?? '').trim();
    const match = value.match(/^unique\s+(.+)$/i);
    if (!match) return undefined;
    const body = match[1].trim();
    const terms = body.startsWith('(') && body.endsWith(')')
        ? body.slice(1, -1).split(',').map((term) => term.trim())
        : [body];
    const fields = terms.map((term) => {
        const fieldMatch = term.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
        return fieldMatch ? {concept: fieldMatch[1], field: fieldMatch[2]} : undefined;
    });
    if (fields.some((field) => !field)) return undefined;
    const concept = fields[0].concept;
    if (fields.some((field) => field.concept !== concept)) return undefined;
    return {concept, fields: fields.map((field) => field.field)};
}

function reservationForUniqueExpression(slice, model, command, commandFields, idFields, expression, eventStorageMode = 'aggregate') {
    const concept = primaryConcept(slice) ?? expression.concept;
    if (expression.concept !== concept) return undefined;
    const sourceFields = expression.fields
        .map((fieldName) => commandFields.find((field) => field.name === fieldName))
        .filter(Boolean);
    if (sourceFields.length !== expression.fields.length) return undefined;

    const fieldLabels = sourceFields.map((field) => uniqueFieldLabel(concept, field.name));
    const suffix = fieldLabels.join('');
    const base = `${pascal(concept)}${suffix}`;
    const context = contextPackage(slice.context);
    const packagePath = `${context}/${_sliceTitle(concept)}`;
    const selectionFields = sourceFields.map((field, index) => ({
        ...field,
        name: sourceFields.length === 1 ? 'normalizedName' : `normalized${fieldLabels[index]}`,
        tagName: field.name,
        selectionExpression: normalizedFieldExpression(field),
        decisionExpression: normalizedFieldExpression(field, 'command')
    }));
    const normalizedFields = selectionFields.map((field) => ({
        name: field.name,
        type: 'String',
        cardinality: 'Single',
        optional: false,
        tagName: field.tagName
    }));
    const originalFields = sourceFields.map((field) => ({
        ...field,
        tagName: field.name
    }));
    const selectionName = `${base}Selection`;
    const stateName = `${base}ReservationState`;
    const eventName = `${base}ReservedEvent`;
    const selectionProperty = `${safeIdentifier(base.charAt(0).toLowerCase() + base.slice(1))}Selection`;
    const stateParam = `${safeIdentifier(base.charAt(0).toLowerCase() + base.slice(1))}Reservation`;
    const selectionArgs = selectionFields.map((field) => `${field.name} = ${field.selectionExpression}`);
    const eventArgs = [
        ...idFields.map((field) => `${field.name} = command.${field.name}`),
        ...originalFields.map((field) => `${field.name} = command.${field.name}`),
        ...selectionFields.map((field) => `${field.name} = ${field.decisionExpression}`)
    ];
    return {
        concept,
        packagePath,
        packageName: `${model.rootPackage}.${context}.${_sliceTitle(concept)}`,
        selectionName,
        stateName,
        eventName,
        tagsName: `${base}ReservationTags`,
        selectionProperty,
        stateParam,
        selectionFields,
        originalFields,
        normalizedFields,
        idFields,
        selectionArgs,
        eventArgs,
        eventStorageMode,
        message: `${fieldLabels.join(' ')} already exists.`
    };
}

function uniqueFieldLabel(concept, fieldName) {
    const conceptPrefix = String(concept ?? '').charAt(0).toLowerCase() + String(concept ?? '').slice(1);
    if (fieldName.toLowerCase().startsWith(conceptPrefix.toLowerCase()) && fieldName.length > conceptPrefix.length) {
        return pascal(fieldName.slice(conceptPrefix.length));
    }
    return pascal(fieldName);
}

function normalizedFieldExpression(field, receiver) {
    const value = receiver ? `${receiver}.${field.name}` : field.name;
    const type = String(field.type).toLowerCase();
    return type === 'string'
        ? `${value}.trim().lowercase()`
        : `${value}.toString().trim().lowercase()`;
}

function conceptSelectionFor(slice, model, eventStorageMode = 'aggregate') {
    const concept = primaryConcept(slice);
    const conceptSlices = (model?.slices ?? [])
        .filter((candidate) => candidate.context === slice.context && primaryConcept(candidate) === concept && candidate.commands.length > 0);
    const sourceSlice = conceptSlices.find((candidate) => candidate.startsLifecycle && explicitConsistencyTags(candidate).length > commandIdFields(candidate).length)
        ?? conceptSlices.find((candidate) => explicitConsistencyTags(candidate).length > commandIdFields(candidate).length)
        ?? conceptSlices.find((candidate) => candidate.startsLifecycle && commandIdFields(candidate).length > 0)
        ?? conceptSlices.find((candidate) => commandIdFields(candidate).length > 0)
        ?? conceptSlices.find((candidate) => candidate.startsLifecycle && (candidate.tags ?? []).length > 0)
        ?? conceptSlices.find((candidate) => (candidate.tags ?? []).length > 0)
        ?? slice;
    const explicitTags = explicitConsistencyTags(sourceSlice);
    if (explicitTags.length > commandIdFields(sourceSlice).length) {
        return selectionFromTags(sourceSlice, explicitTags, `${pascal(concept)}Selection`, concept, [concept], eventStorageMode);
    }
    const idFields = commandIdFields(sourceSlice);
    if (idFields.length > 0) {
        const tags = idFields.map((field) => ({name: field.name, expression: field.name}));
        return selectionFromTags(sourceSlice, tags, `${pascal(concept)}Selection`, concept, [concept], eventStorageMode);
    }
    return selectionFromTags(sourceSlice, sourceSlice.tags.length > 0 ? sourceSlice.tags : fallbackTags(sourceSlice, sourceSlice.commands[0]?.fields ?? []), `${pascal(concept)}Selection`, concept, [concept], eventStorageMode);
}

function sliceSelectionFor(slice, eventStorageMode = 'aggregate') {
    const firstCommand = slice.commands[0];
    const commandFields = firstCommand?.fields ?? [];
    const idFields = commandFields.filter((field) => field.idAttribute);
    const explicitTags = explicitConsistencyTags(slice);
    const tags = explicitTags.length > idFields.length
        ? explicitTags
        : idFields.length > 0
        ? idFields.map((field) => ({name: field.name, expression: field.name}))
        : (slice.tags.length > 0 ? slice.tags : fallbackTags(slice, commandFields));
    return selectionFromTags(slice, tags, `${pascal(slice.name)}Selection`, slice.name, slice.concepts, eventStorageMode);
}

function explicitConsistencyTags(slice) {
    return slice.tags ?? [];
}

function selectionFromTags(slice, tags, name, metadataOwner, concepts, eventStorageMode = 'aggregate') {
    const commandFields = slice.commands[0]?.fields ?? [];
    const fields = tags.map((tag, index) => {
        const source = tagSource(tag, commandFields) ?? commandFields.find((field) => field.idAttribute)?.name ?? commandFields[0]?.name;
        const sourceField = commandFields.find((field) => field.name === source) ?? {name: source ?? `selection${index + 1}`, type: 'String', cardinality: 'Single'};
        const derived = Boolean(tag.expression) && String(tag.expression).trim() !== sourceField.name;
        const expression = derived ? renderTagExpression(tag.expression, sourceField, commandFields) : undefined;
        return {
            ...sourceField,
            tag,
            source: sourceField.name,
            alias: safeIdentifier(tag.name),
            derived,
            selectionType: derived ? 'String' : mappedType(sourceField, false),
            commandExpression: expression ?? sourceField.name,
            eventExpression: expression ?? sourceField.name
        };
    });
    if (eventStorageMode === 'aggregate' && fields.length > 1) {
        const tag = {name: safeIdentifier(String(metadataOwner ?? name).charAt(0).toLowerCase() + String(metadataOwner ?? name).slice(1))};
        return {
            name,
            tags: [tag],
            fields,
            metadataOwner,
            concepts,
            eventStorageMode,
            compositeTag: {
                tag,
                property: 'consistencyKey',
                sources: fields.map((field) => field.source),
                expression: compositeKeyExpression(fields.map((field) => field.alias)),
                eventExpression: compositeKeyExpression(fields.map((field) => field.eventExpression))
            }
        };
    }
    return {name, tags, fields, metadataOwner, concepts, eventStorageMode};
}

function commandFieldsWithSelection(command, selection) {
    return fieldsWithSelection(command.fields ?? [], selection.fields ?? []);
}

function fieldsWithSelection(fields, selectionFields) {
    const result = [...fields];
    const existing = new Set(result.map((field) => field.name));
    (selectionFields ?? []).forEach((field) => {
        if (existing.has(field.alias)) return;
        result.push({
            name: field.alias,
            type: field.type,
            cardinality: 'Single',
            optional: false,
            idAttribute: false,
            generated: false,
            technicalAttribute: false,
            query: false
        });
        existing.add(field.alias);
    });
    return result;
}

function eventFieldsWithTags(fields, tagFields) {
    const result = fields.map((field) => ({
        ...field,
        eventTagKeys: (tagFields ?? [])
            .filter((tagField) => !tagField.derived && tagField.source === field.name)
            .map((tagField) => tagField.tag.name)
    }));
    const existing = new Set(result.map((field) => field.name));
    const eventShape = {fields: result};
    (tagFields ?? [])
        .filter((tagField) => tagField.derived)
        .filter((tagField) => (tagField.requiredSources ?? [tagField.source]).every((source) => fields.some((field) => field.name === source)))
        .forEach((tagField) => {
            const name = derivedEventTagProperty(tagField, eventShape);
            if (existing.has(name)) return;
            result.push({
                name,
                type: 'String',
                cardinality: 'Single',
                optional: false,
                idAttribute: false,
                generated: false,
                technicalAttribute: false,
                query: false,
                eventTagKeys: [tagField.tag.name],
                defaultValue: tagField.eventExpression
            });
            existing.add(name);
            eventShape.fields = result;
        });
    return result;
}

function eventTagFieldsFor(slice, event, selection, includeMissing = false) {
    if (selection.compositeTag) {
        const sources = selection.compositeTag.sources ?? [];
        if (!includeMissing && !sources.every((source) => (event.fields ?? []).some((eventField) => eventField.name === source))) {
            return [];
        }
        return [{
            name: selection.compositeTag.property,
            alias: selection.compositeTag.property,
            source: sources[0],
            requiredSources: sources,
            type: 'String',
            cardinality: 'Single',
            optional: false,
            derived: true,
            tag: selection.compositeTag.tag,
            eventExpression: selection.compositeTag.eventExpression
        }];
    }
    const explicitTagSelection = selection.eventStorageMode === 'dcb' && (slice.tags ?? []).length > 0
        ? selectionFromTags(slice, slice.tags, `${pascal(slice.name)}ExplicitTags`, slice.name, slice.concepts, 'dcb')
        : {fields: []};
    const byTagName = new Map();
    [...(selection.fields ?? []), ...(explicitTagSelection.fields ?? [])]
        .filter((field) => includeMissing || (event.fields ?? []).some((eventField) => eventField.name === field.source))
        .forEach((field) => {
            if (!byTagName.has(field.tag.name)) byTagName.set(field.tag.name, field);
        });
    return Array.from(byTagName.values());
}

function injectEntityExpression(selection) {
    if ((selection.fields ?? []).length === 1) {
        return `(idProperty = "${escapeKotlin(selection.fields[0].alias)}")`;
    }
    return '(idProperty = "selection")';
}

function uniqueTags(tags) {
    const byName = new Map();
    tags.filter(Boolean).forEach((tag) => {
        if (!byName.has(tag.name)) byName.set(tag.name, tag);
    });
    return Array.from(byName.values());
}

function commandIdFields(slice) {
    return slice.commands[0]?.fields?.filter((field) => field.idAttribute) ?? [];
}

function fallbackTags(slice, fields) {
    const idFields = fields.filter((field) => field.idAttribute);
    if (idFields.length > 0) {
        return idFields.map((field) => ({name: field.name, expression: field.name}));
    }
    const idField = fields[0];
    const concept = primaryConcept(slice) ?? slice.name;
    return [{name: concept, expression: idField?.name}];
}

function selectionTargetFor(model, slice) {
    const context = contextPackage(slice.context);
    const concept = primaryConcept(slice);
    if (concept) {
        const conceptPackage = _sliceTitle(concept);
        return {
            packageName: `${model.rootPackage}.${context}.${conceptPackage}`,
            pathPrefix: `${context}/${conceptPackage}`
        };
    }
    const slicePackage = _sliceTitle(slice.title);
    return {
        packageName: `${model.rootPackage}.${context}.${slicePackage}`,
        pathPrefix: `${context}/${slicePackage}`
    };
}

function stateTargetFor(model, slice) {
    const context = contextPackage(slice.context);
    const concept = primaryConcept(slice);
    if (concept) {
        const conceptPackage = _sliceTitle(concept);
        return {
            name: `${pascal(concept)}State`,
            packageName: `${model.rootPackage}.${context}.${conceptPackage}`,
            pathPrefix: `${context}/${conceptPackage}`
        };
    }
    const slicePackage = _sliceTitle(slice.title);
    return {
        name: `${pascal(slice.name)}State`,
        packageName: `${model.rootPackage}.${context}.${slicePackage}`,
        pathPrefix: `${context}/${slicePackage}`
    };
}

function primaryConcept(slice) {
    return slice.concepts?.[0];
}

function childStateTransitions(slices) {
    return slices
        .filter((slice) => slice.stateChange?.eventId)
        .flatMap((slice) => {
            const events = relatedEventsForSlice({slices}, slice)
                .filter((event) => event.id === slice.stateChange.eventId);
            return events.map((event) => ({
                eventId: event.id,
                keyField: childTransitionKeyField(event),
                to: slice.stateChange.to
            })).filter((transition) => transition.keyField);
        });
}

function childTransitionKeyField(event) {
    const fields = event.fields ?? [];
    const idFields = fields.filter((field) => field.idAttribute || /Id$/.test(field.name));
    return (idFields.length > 1 ? idFields[idFields.length - 1] : idFields[0])?.name;
}

function tagSource(tag, fields) {
    if (fields.some((field) => field.name === tag.name)) return tag.name;
    const identifiers = String(tag.expression ?? '').match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    return identifiers.find((identifier) => fields.some((field) => field.name === identifier));
}

function renderTagExpression(expression, sourceField, fields) {
    if (!expression) return undefined;
    const normalized = String(expression).trim();
    const normalizeMatch = normalized.match(/^normalize\(([A-Za-z_][A-Za-z0-9_]*)\)$/);
    if (normalizeMatch) {
        const field = fields.find((candidate) => candidate.name === normalizeMatch[1]) ?? sourceField;
        const type = String(field.type).toLowerCase();
        const primitive = ['string', 'boolean', 'int', 'integer', 'long', 'float', 'double', 'number', 'decimal', 'bigdecimal', 'uuid', 'date', 'datetime'].includes(type);
        const value = primitive ? field.name : `${field.name}.value`;
        const textValue = type === 'string' ? value : `${value}.toString()`;
        return `${textValue}.trim().lowercase()`;
    }
    return `${sourceField.name}.toString() /* TODO Medol tag expression: ${escapeKotlin(normalized)} */`;
}

function compositeKeyExpression(expressions) {
    return `listOf(${expressions.map((expression) => `${expression}.toString()`).join(', ')}).joinToString("|")`;
}

function renderDerivedEventTags(fields, event) {
    const derived = fields.filter((field) => field.derived && event.fields.some((eventField) => eventField.name === field.source));
    if (derived.length === 0) return '';
    const properties = derived.map((field) => [
        `    @EventTag(key = "${escapeKotlin(field.tag.name)}")`,
        `    val ${derivedEventTagProperty(field, event)}: String = ${field.eventExpression}`
    ].join('\n')).join('\n\n');
    return ` {\n${properties}\n}`;
}

function derivedEventTagProperty(field, event) {
    const fieldNames = new Set(event.fields.map((eventField) => eventField.name));
    let candidate = `${field.alias}EventTag`;
    let suffix = 2;
    while (fieldNames.has(candidate)) {
        candidate = `${field.alias}EventTag${suffix}`;
        suffix += 1;
    }
    return candidate;
}

function relatedEventsForSlice(model, slice) {
    const ids = new Set(slice.commands.flatMap((command) => command.dependencies ?? [])
        .filter((dependency) => dependency.direction === 'OUTBOUND' && dependency.elementType === 'EVENT')
        .map((dependency) => dependency.id));
    const allEvents = model.slices.flatMap((candidate) => candidate.events);
    const related = allEvents.filter((event) => ids.has(event.id));
    return uniqueBy([...(slice.events ?? []), ...related], (event) => event.id ?? event.name);
}

function outboundEvents(command, events) {
    const ids = new Set((command.dependencies ?? [])
        .filter((dependency) => dependency.direction === 'OUTBOUND' && dependency.elementType === 'EVENT')
        .map((dependency) => dependency.id));
    const selected = events.filter((event) => ids.has(event.id));
    return selected.length > 0 ? selected : events.slice(0, 1);
}

function transitionForCommand(model, command) {
    return (model.transitions ?? []).find((transition) =>
        transition.command?.id === command.id || transition.command?.name === command.name
    );
}

function conceptStateEnumName(conceptName) {
    return `${pascal(conceptName)}StateEnum`;
}

function conceptHasState(model, context, conceptName, stateName) {
    const concept = (model.concepts ?? []).find((candidate) =>
        candidate.name === conceptName && (!context || candidate.context === context)
    );
    return (concept?.states ?? []).some((state) => state === stateName);
}

function transitionUsesConceptState(model, transition) {
    return Boolean(
        transition?.from
        && transition.owner?.type === 'concept'
        && conceptHasState(model, transition.context, transition.owner.name, transition.from)
    );
}

function renderStateGuard(model, transition) {
    if (!transition?.from || transition.owner?.type !== 'concept') {
        return '        // TODO: validate domain rules against state before appending events.';
    }
    if (!transitionUsesConceptState(model, transition)) {
        return '        // TODO: validate child/member state before appending events.';
    }
    const stateType = conceptStateEnumName(transition.owner.name);
    return [
        `        require(state.currentState == ${stateType}.${constant(transition.from)}) {`,
        `            "${escapeKotlin(transition.command?.name ?? 'Command')} requires ${escapeKotlin(transition.owner.name)} to be ${escapeKotlin(transition.from)}."`,
        '        }'
    ].join('\n');
}

function eventArguments(event, command, selection) {
    const eventFields = event.fields ?? [];
    const commandFields = commandFieldsWithSelection(command, selection ?? {fields: []});
    return eventFields.map((field) => {
        if (commandFields.some((candidate) => candidate.name === field.name)) return `${field.name} = command.${field.name}`;
        const source = field.source?.from?.find((name) => commandFields.some((candidate) => candidate.name === name));
        if (source) return `${field.name} = command.${source}`;
        return `${field.name} = ${fallbackValue(field)} /* TODO: ${field.source?.rule ?? 'derive value'} */`;
    }).join(', ');
}

function fallbackValue(field) {
    if (field.optional) return 'null';
    if (field.cardinality === 'Multiple') return 'emptyList()';
    if (field.valueType?.kind === 'enum' && (field.valueType.values ?? []).length > 0) {
        return `${field.valueType.name}.${constant(field.valueType.values[0])}`;
    }
    const optionSet = fieldOptionsFor(field);
    if (optionSet) return `${optionSet.enumName}.${optionSet.values[0].enumConstant}`;
    switch (String(field.type).toLowerCase()) {
        case 'boolean': return 'false';
        case 'int': return '0';
        case 'long': return '0L';
        case 'float': return '0f';
        case 'double':
        case 'number': return '0.0';
        case 'decimal':
        case 'bigdecimal': return 'java.math.BigDecimal.ZERO';
        case 'uuid': return 'java.util.UUID.randomUUID()';
        case 'date': return 'java.time.LocalDate.now()';
        case 'datetime': return 'java.time.LocalDateTime.now()';
        default: return '""';
    }
}

function nullableType(field) {
    return mappedType(field, true).replace(/\?\?$/, '?');
}

function stateFieldType(field) {
    return field.cardinality === 'Multiple' ? mappedType(field, false) : nullableType(field);
}

function stateFieldDefault(field) {
    return field.cardinality === 'Multiple' ? 'emptyList()' : 'null';
}

function readModelStorageImports(fields, rootPackage) {
    return kotlinFieldImports((fields ?? []).map(readModelStorageField), rootPackage);
}

function readModelStorageField(field) {
    if (!isScalarValueTypeField(field)) return field;
    const valueType = valueTypeForField(field);
    return {
        ...field,
        type: resolvedBaseType(valueType),
        valueType: undefined
    };
}

function readModelStorageType(field, optional = field.optional) {
    return mappedType(readModelStorageField(field), optional);
}

function readModelStorageFieldType(field) {
    return field.cardinality === 'Multiple'
        ? readModelStorageType(field, false)
        : readModelStorageType(field, true).replace(/\?\?$/, '?');
}

function readModelStorageFieldDefault(field) {
    return field.cardinality === 'Multiple' ? 'emptyList()' : 'null';
}

function readModelStorageExpression(field, expression) {
    if (!isScalarValueTypeField(field)) return expression;
    if (field.cardinality === 'Multiple') {
        return field.optional
            ? `${expression}?.map { it.value }`
            : `${expression}.map { it.value }`;
    }
    return field.optional ? `${expression}?.value` : `${expression}.value`;
}

function isScalarValueTypeField(field) {
    return valueTypeForField(field)?.kind === 'scalar';
}

function valueTypeForField(field) {
    return field?.valueType ?? findValueType(field?.type);
}

const METADATA_FIELD_DEFINITIONS = [
    {name: 'userId', key: 'USER_ID', type: 'String?'},
    {name: 'sessionId', key: 'SESSION_ID', type: 'String?'},
    {name: 'correlationId', key: 'CORRELATION_ID', type: 'String?'},
    {name: 'causationId', key: 'CAUSATION_ID', type: 'String?'},
    {name: 'traceId', key: 'TRACE_ID', type: 'String?'},
    {name: 'tenantId', key: 'TENANT_ID', type: 'String?'}
];

function readModelMetadataFields(readmodel) {
    const existingNames = new Set((readmodel.fields ?? []).map((field) => field.name));
    return METADATA_FIELD_DEFINITIONS.filter((field) => !existingNames.has(field.name));
}

function readModelMetadataParameters(metadataFields, indent = '        ') {
    if (metadataFields.length === 0) return '';
    return `${indent}message: EventMessage`;
}

function readModelMetadataAssignments(metadataFields, indent = '            ') {
    if (metadataFields.length === 0) return '';
    return `${indent}ProjectionMetadata.assign(entity, message)`;
}

function mappedType(field, optional = field.optional) {
    const optionSet = fieldOptionsFor(field);
    const cardinality = field.cardinality === 'Multiple' ? 'List' : field.cardinality;
    if (optionSet) {
        const fieldType = optional ? `${optionSet.enumName}?` : optionSet.enumName;
        return cardinality?.toLowerCase() === 'list'
            ? field.mutable ? `MutableList<${fieldType}>` : `List<${fieldType}>`
            : fieldType;
    }
    return typeMapping(field.type, cardinality, optional, field.mutable);
}

function kotlinFieldImports(fields, rootPackage, additionalImports) {
    return [
        typeImports(fields, additionalImports),
        kotlinEnumImports(fields, rootPackage)
    ].filter(Boolean).join('\n');
}

function kotlinEnumImports(fields, rootPackage) {
    return uniqueBy((fields ?? [])
        .map(fieldOptionsFor)
        .filter(Boolean)
        .map((optionSet) => `import ${rootPackage}.support.enums.${optionSet.enumName}`), (value) => value)
        .join('\n');
}

function isJpaEnumField(field) {
    return field.type?.endsWith('.State') || valueTypeForField(field)?.kind === 'enum' || Boolean(fieldOptionsFor(field));
}

function uniqueFields(fields) {
    return uniqueBy(fields, (field) => field.name);
}

function uniqueBy(items, key) {
    const seen = new Set();
    return items.filter((item) => {
        const value = key(item);
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
    });
}

function groupByMap(items, key) {
    const groups = new Map();
    for (const item of items) {
        const value = key(item);
        groups.set(value, [...(groups.get(value) ?? []), item]);
    }
    return groups;
}

function stringList(items) {
    return items.length > 0
        ? `listOf(${items.map((item) => `"${escapeKotlin(item)}"`).join(', ')})`
        : 'emptyList<String>()';
}

function pascal(value) {
    return String(value ?? '').split(/[^A-Za-z0-9]+|(?=[A-Z])/).filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('') || 'Medol';
}

function kebab(value) {
    return String(value ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

function safeDatabaseName(value) {
    const name = String(value ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
    return name || 'medol';
}

function safeIdentifier(value) {
    const result = String(value ?? '').replace(/[^A-Za-z0-9_]/g, '');
    return result && /^[A-Za-z_]/.test(result) ? result : `tag${pascal(result)}`;
}

function httpRoute(value) {
    return String(value ?? '').replace(/[\s_-]+/g, '').toLowerCase();
}

function constant(value) {
    return String(value ?? '')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/([0-9])([A-Z][a-z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
}

function kotlinPrimitive(type) {
    switch (String(type).toLowerCase()) {
        case 'int':
        case 'integer': return 'Int';
        case 'long': return 'Long';
        case 'double':
        case 'number': return 'Double';
        case 'float': return 'Float';
        case 'decimal':
        case 'bigdecimal': return 'BigDecimal';
        case 'boolean': return 'Boolean';
        case 'date': return 'LocalDate';
        case 'datetime': return 'LocalDateTime';
        case 'uuid': return 'UUID';
        default: return 'String';
    }
}

function kotlinImports(baseType) {
    return ({
        BigDecimal: 'import java.math.BigDecimal',
        LocalDate: 'import java.time.LocalDate',
        LocalDateTime: 'import java.time.LocalDateTime',
        UUID: 'import java.util.UUID'
    })[baseType] ?? '';
}

function renderScalarValueType(valueType, baseType) {
    const validations = resolvedConstraints(valueType).map((constraint) => renderValidation(valueType, constraint, baseType)).filter(Boolean);
    return `@JvmInline\nvalue class ${valueType.name}(val value: ${baseType}) {${validations.length ? `\n    init {\n${validations.map((line) => `        ${line}`).join('\n')}\n    }` : ''}\n}`;
}

function renderEnum(valueType) {
    return `enum class ${valueType.name} {\n${(valueType.values ?? []).map((value) => `    ${constant(value)}`).join(',\n')}\n}`;
}

function renderObjectValueType(valueType, rootPackage) {
    const imports = kotlinFieldImports(valueType.fields ?? [], rootPackage);
    const fields = (valueType.fields ?? []).map((field) => `    val ${field.name}: ${mappedType(field, field.optional)}`).join(',\n');
    return `${imports ? `${imports}\n\n` : ''}data class ${valueType.name}(\n${fields}\n)`;
}

function renderValidation(valueType, constraint, baseType) {
    const label = `${valueType.name} violates ${constraint.kind} constraint`;
    if (constraint.kind === 'format' && constraint.format === 'email') return `require(Regex("^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$").matches(value.toString())) { "${label}" }`;
    if (constraint.kind === 'length') return `require(value.toString().length in ${constraint.min}..${constraint.max}) { "${label}" }`;
    if (constraint.kind === 'range') return `require(value >= ${literal(constraint.min, baseType)} && value <= ${literal(constraint.max, baseType)}) { "${label}" }`;
    if (constraint.kind === 'matches') return `require(Regex("${escapeKotlin(constraint.pattern)}").matches(value.toString())) { "${label}" }`;
    if (constraint.kind === 'oneOf') return `require(value in setOf(${(constraint.values ?? []).map((value) => literal(value, baseType)).join(', ')})) { "${label}" }`;
    return '';
}

function literal(value, type) {
    if (type === 'String') return `"${escapeKotlin(value)}"`;
    if (type === 'Long') return `${value}L`;
    if (type === 'Float') return `${value}f`;
    if (type === 'BigDecimal') return `BigDecimal("${value}")`;
    return String(value);
}

function escapeKotlin(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function filterModelByDeployment(model, deployment) {
    const contextNames = new Set((deployment.contexts ?? []).map((context) => context.name));
    const inContext = (item) => !item?.context || contextNames.has(item.context);
    const slices = (model.slices ?? []).filter((slice) => contextNames.has(slice.context ?? slice.chapter));
    return {
        ...model,
        domain: deployment.name,
        deployment: deployment.name,
        deployments: [deployment],
        contexts: (model.contexts ?? []).filter((context) => contextNames.has(context.name)),
        valueTypes: (model.valueTypes ?? []).filter(inContext),
        aggregates: (model.aggregates ?? []).filter(inContext),
        concepts: (model.concepts ?? []).filter(inContext),
        transitions: (model.transitions ?? []).filter(inContext),
        slices
    };
}

module.exports = {
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
};
