/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {cleanTitle, uniqueFields} = require('./model-utils');

function commandSelectionFields(command, slice, slices) {
    const concept = primaryConcept(slice, command);
    if (!concept) {
        return [];
    }

    const sourceSlice = selectionSourceSlice(concept, slice, slices);
    if (!sourceSlice) {
        return [];
    }

    const tags = explicitTags(sourceSlice);
    const sourceFields = sourceSlice.commands?.[0]?.fields ?? [];
    return tags
        .map((tag, index) => selectionFieldFromTag(tag, sourceFields, index))
        .filter(Boolean)
        .map((field) => ({
            ...field,
            optional: false,
            generated: false,
            hidden: true,
            excludeFromForm: true,
            selectionPrefill: true
        }));
}

function commandFieldsWithSelection(command, slice, slices) {
    return uniqueFields([
        ...(command?.fields ?? []),
        ...commandSelectionFields(command, slice, slices)
    ]);
}

function selectionSourceSlice(concept, slice, slices) {
    const context = slice?.context ?? slice?.chapter;
    const candidates = (slices ?? [])
        .filter((candidate) => (candidate.context ?? candidate.chapter) === context)
        .filter((candidate) => primaryConcept(candidate) === concept)
        .filter((candidate) => (candidate.commands ?? []).length > 0);

    return candidates.find((candidate) => startsLifecycle(candidate) && explicitTags(candidate).length > 0)
        ?? candidates.find((candidate) => explicitTags(candidate).length > 0)
        ?? null;
}

function selectionFieldFromTag(tag, sourceFields, index) {
    const name = tagName(tag, index);
    if (!name) {
        return null;
    }
    const source = tagSource(tag) ?? name;
    const sourceField = sourceFields.find((field) => field.name === source)
        ?? sourceFields.find((field) => field.name === name)
        ?? {name, type: 'String', cardinality: 'Single'};

    return {
        ...sourceField,
        name,
        cardinality: 'Single',
        idAttribute: false
    };
}

function tagName(tag, index) {
    if (typeof tag === 'string') {
        return tag;
    }
    return tag?.name ?? tag?.key ?? tag?.field ?? `selection${index + 1}`;
}

function tagSource(tag) {
    if (!tag || typeof tag === 'string') {
        return null;
    }
    const expression = tag.expression ? String(tag.expression).trim() : '';
    if (expression && /^[A-Za-z_][A-Za-z0-9_]*$/.test(expression)) {
        return expression;
    }
    return tag.source ?? tag.field ?? tag.name ?? null;
}

function explicitTags(slice) {
    return slice?.tags ?? [];
}

function startsLifecycle(slice) {
    return Boolean(slice?.startsLifecycle)
        || (slice?.commands ?? []).some((command) => command?.startsLifecycle || command?.createsAggregate);
}

function primaryConcept(slice, command = null) {
    return cleanTitle(
        command?.concept
        ?? command?.concepts?.[0]
        ?? slice?.concepts?.[0]
        ?? slice?.concept
        ?? ''
    );
}

module.exports = {
    commandFieldsWithSelection,
    commandSelectionFields
};
