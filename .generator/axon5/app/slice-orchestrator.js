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

const sliceOrchestratorMethods = {
    _writeSlice(slice) {
        const context = contextPackage(slice.context);
        const slicePackage = _sliceTitle(slice.title);
        const packageName = `${this.model.rootPackage}.${context}.${slicePackage}`;
        if (slice.commands.length > 0) {
            const selection = selectionFor(slice, this.model);
            const selectionTarget = selectionTargetFor(this.model, slice);
            const relatedEvents = relatedEventsForSlice(this.model, slice);
            const reservations = uniqueReservationsForSlice(slice, this.model);
            this._writeSelection(selectionTarget.packageName, selectionTarget.pathPrefix, slice, selection);
            reservations.forEach((reservation) => this._writeReservationArtifacts(context, reservation));
            slice.commands.forEach((command) => this._writeCommand(packageName, context, slicePackage, command, selection, selectionTarget.packageName, reservations));
            slice.commands.forEach((command) => this._writeInfrastructurePortArtifacts(slice, command, relatedEvents));
            relatedEvents.forEach((event) => this._writeEvent(event, slice, selection));
            if (!primaryConcept(slice)) {
                this._writeState(packageName, context, slicePackage, slice, selection, relatedEvents);
            }
            this._writeDecision(packageName, context, slicePackage, slice, selection, relatedEvents, reservations);
            this._writeCommandHandlers(packageName, context, slicePackage, slice, selection, relatedEvents, reservations);
            this._writeCommandResource(packageName, context, slicePackage, slice);
        }
        slice.readmodels.forEach((readmodel) => this._writeReadModel(packageName, context, slicePackage, slice, readmodel));
        this._writeProcessors(slice);
    },
};

module.exports = {sliceOrchestratorMethods};
