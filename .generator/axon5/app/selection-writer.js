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

const selectionWriterMethods = {
    _writeSelection(packageName, pathPrefix, slice, selection) {
        const imports = kotlinFieldImports(selection.fields, this.model.rootPackage);
        const properties = selection.fields.map((field) => `    val ${field.alias}: ${field.selectionType}`).join(',\n');
        const tags = uniqueTags(selection.tags ?? []);
        const tagConstants = tags.map((tag) => `    const val ${constant(tag.name)} = "${escapeKotlin(tag.name)}"`).join('\n');
        const metadataOwner = selection.metadataOwner ?? slice.name;
        const concepts = selection.concepts ?? slice.concepts;
        const body = selection.compositeTag
            ? ` {\n    val ${selection.compositeTag.property}: String = ${selection.compositeTag.expression}\n}`
            : '';
        this.fs.write(this._kotlinPath(`${pathPrefix}/${selection.name}.kt`), `package ${packageName}

${imports}

data class ${selection.name}(
${properties}
)${body}

object ${pascal(metadataOwner)}Tags {
${tagConstants}
}

object ${pascal(metadataOwner)}Metadata {
    val concepts = ${stringList(concepts)}
}
`);
    },

    _writeReservationArtifacts(context, reservation) {
        const fields = [
            ...reservation.idFields,
            ...reservation.originalFields,
            ...reservation.normalizedFields
        ];
        const compositeTag = reservation.eventStorageMode === 'aggregate' && reservation.selectionFields.length > 1
            ? {
                name: safeIdentifier(String(reservation.concept ?? reservation.selectionName).charAt(0).toLowerCase() + String(reservation.concept ?? reservation.selectionName).slice(1)),
                property: 'consistencyKey',
                expression: compositeKeyExpression(reservation.selectionFields.map((field) => field.name))
            }
            : undefined;
        const eventImports = kotlinFieldImports(fields, this.model.rootPackage);
        const eventProperties = [
            ...fields.map((field) => {
                const tag = !compositeTag && reservation.normalizedFields.some((candidate) => candidate.name === field.name)
                ? `    @EventTag(key = "${escapeKotlin(field.tagName)}")\n`
                : '';
                return `${tag}    val ${field.name}: ${mappedType(field, false)}`;
            }),
            ...(compositeTag ? [`    @EventTag(key = "${escapeKotlin(compositeTag.name)}")\n    val ${compositeTag.property}EventTag: String = ${compositeTag.expression}`] : [])
        ].join(',\n');
        this.fs.write(this._kotlinPath(`${context}/events/${reservation.eventName}.kt`), `package ${this.model.rootPackage}.${context}.events

import org.axonframework.eventsourcing.annotation.EventTag
import org.axonframework.messaging.eventhandling.annotation.Event
${eventImports}

@Event
data class ${reservation.eventName}(
${eventProperties}
)
`);

        const selectionProperties = reservation.selectionFields.map((field) => `    val ${field.name}: String`).join(',\n');
        const selectionBody = compositeTag
            ? ` {\n    val ${compositeTag.property}: String = ${compositeTag.expression}\n}`
            : '';
        this.fs.write(this._kotlinPath(`${reservation.packagePath}/${reservation.selectionName}.kt`), `package ${reservation.packageName}

data class ${reservation.selectionName}(
${selectionProperties}
)${selectionBody}

object ${reservation.tagsName} {
${(compositeTag ? [{tagName: compositeTag.name}] : reservation.normalizedFields).map((field) => `    const val ${constant(field.tagName)} = "${escapeKotlin(field.tagName)}"`).join('\n')}
}
`);

        const criteria = compositeTag
            ? `Tag.of(${reservation.tagsName}.${constant(compositeTag.name)}, selection.${compositeTag.property})`
            : reservation.selectionFields
                .map((field) => `Tag.of(${reservation.tagsName}.${constant(field.tagName)}, selection.${field.name})`)
                .join(',\n                ');
        const sourcingAssignments = [
            '        reserved = true',
            ...reservation.idFields.map((field) => `        ${field.name} = event.${field.name}`)
        ].join('\n');
        this.fs.write(this._kotlinPath(`${reservation.packagePath}/${reservation.stateName}.kt`), `package ${reservation.packageName}

import org.axonframework.eventsourcing.annotation.EventCriteriaBuilder
import org.axonframework.eventsourcing.annotation.EventSourcingHandler
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator
import org.axonframework.extension.spring.stereotype.EventSourced
import org.axonframework.messaging.eventstreaming.EventCriteria
import org.axonframework.messaging.eventstreaming.Tag
import ${this.model.rootPackage}.${context}.events.${reservation.eventName}
${kotlinFieldImports(reservation.idFields, this.model.rootPackage)}

@EventSourced(idType = ${reservation.selectionName}::class)
class ${reservation.stateName} @EntityCreator constructor() {

    var reserved: Boolean = false
${reservation.idFields.map((field) => `    var ${field.name}: ${stateFieldType(field)} = ${stateFieldDefault(field)}`).join('\n')}

    companion object {
        @JvmStatic
        @EventCriteriaBuilder
        fun resolveCriteria(selection: ${reservation.selectionName}): EventCriteria = EventCriteria.havingTags(
                ${criteria}
        )
    }

    @EventSourcingHandler
    fun evolve(event: ${reservation.eventName}): ${reservation.stateName} = apply {
${sourcingAssignments}
    }
}
`);
    },
};

module.exports = {selectionWriterMethods};
