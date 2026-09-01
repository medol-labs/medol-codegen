/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {uniqueChapters, buildI18nModel, normalizeFields, axonRoute, cleanTitle, titleCase, pascal, constant} = require('./model-utils');
const {buildBackendModules, backendModuleForContext, withModuleResourceRoutes} = require('./backend-modules');
const {buildDomainModel, withResolvedValueTypes} = require('./domain-model');
const {buildWorkflowModel} = require('./workflow-model');
const {toReadModelResource, uniqueResourceNames} = require('./resource-model');
const {withChapterI18n, withResourceI18n} = require('./i18n-model');
const {buildCommandChoices, normalizeSelectedCommands} = require('./command-selection');
const {aggregateName} = require('./resource-naming');

function buildFrontendModel(source, selectedCommandKeys) {
    source = withResolvedValueTypes(source);
    source = withStateFieldOptions(source);
    const slices = source.slices ?? [];
    const allAggregates = source.aggregates ?? [];
    const allContexts = source.contexts ?? source.context ?? [];
    const allEvents = slices.flatMap((slice) => slice.events ?? []);
    const selected = selectedCommandKeys ? new Set(selectedCommandKeys) : null;
    const backendModules = buildBackendModules(source);
    const workflow = buildWorkflowModel(slices, allAggregates, allContexts, selected, backendModules, source.transitions ?? []);
    const resources = withResourceI18n(uniqueResourceNames(slices
        .flatMap((slice) => (slice.readmodels ?? [])
            .filter((readModel) => readModel?.title && readModel.listElement)
            .map((readModel) => toReadModelResource({
                ...aggregateName(readModel, slice, allAggregates, allContexts),
                deployment: backendModuleForContext(slice.context ?? slice.chapter, backendModules),
                slice,
                commands: workflow.commandsForReadModel(readModel),
                producerCommandKeys: workflow.producerCommandKeys(readModel),
                itemCommandKeys: workflow.itemCommandKeys(readModel)
            }, readModel, allEvents, workflow)))
        .filter(Boolean)));
    const modules = withModuleResourceRoutes(backendModules, resources);
    const chapters = withChapterI18n(uniqueChapters(resources.map((resource) => resource.chapter).filter(Boolean)));
    const i18n = buildI18nModel(source, chapters, resources);
    const fileUploadCapability = buildFileUploadCapability(slices, allAggregates, allContexts, backendModules);
    const authBackendModule = buildAuthBackendModule(modules);

    return {
        appName: source.domain ?? 'Event Sourcing App',
        backendModules: modules,
        authBackendModule,
        fileUploadCapability,
        chapters,
        resources: resources.sort((a, b) => a.route.localeCompare(b.route)),
        i18n
    };
}

function buildAuthBackendModule(backendModules) {
    return backendModules.find((module) => (module.contexts ?? []).includes('IdentityAccessManagement'))
        ?? backendModules[0]
        ?? {
            name: 'default',
            label: 'Backend',
            dataProviderName: 'command',
            envName: 'VITE_AXON_API_URL',
            defaultApiUrl: 'http://localhost:8080',
            apiUrl: 'http://localhost:8080'
        };
}

function withStateFieldOptions(source) {
    const stateOptionsByType = buildStateOptionsByType(source);
    if (stateOptionsByType.size === 0) {
        return source;
    }

    const enrichFields = (fields = []) => fields.forEach((field) => {
        if (!field?.name) {
            return;
        }

        const options = stateOptionsByType.get(field.type);
        if (options && !field.optionSet && !field.options && !field.enumOptions) {
            field.enumOptions = options;
        }

        if (field.valueType?.fields) {
            enrichFields(field.valueType.fields);
        }
    });

    (source.slices ?? []).forEach((slice) => {
        (slice.commands ?? []).forEach((command) => enrichFields(command.fields));
        (slice.events ?? []).forEach((event) => enrichFields(event.fields));
        (slice.readmodels ?? []).forEach((readModel) => enrichFields(readModel.fields));
    });
    (source.valueTypes ?? []).forEach((valueType) => enrichFields(valueType.fields));

    return source;
}

function buildStateOptionsByType(source) {
    const stateOptionsByType = new Map();
    const concepts = [
        ...(source.concepts ?? []),
        ...(source.contexts ?? []).flatMap((context) => context.concepts ?? []),
        ...(source.slices ?? []).flatMap((slice) => slice.concepts ?? [])
    ];

    concepts
        .filter((concept) => concept?.name && (concept.states ?? []).length > 0)
        .forEach((concept) => {
            const options = concept.states.map((state) => ({
                value: constant(state),
                label: titleCase(state)
            }));
            [
                `${concept.name}.State`,
                `${concept.title}.State`,
                `${cleanTitle(concept.name)}.State`,
                `${cleanTitle(concept.title)}.State`,
                `${pascal(concept.name)}.State`,
                `${pascal(concept.title)}.State`
            ].filter(Boolean).forEach((type) => stateOptionsByType.set(type, options));
        });

    return stateOptionsByType;
}

function buildFileUploadCapability(slices, aggregates, contexts, backendModules) {
    const candidates = slices
        .flatMap((slice) => (slice.commands ?? []).map((command) => ({slice, command})))
        .map(({slice, command}) => {
            const rawFields = command.fields ?? [];
            const fields = normalizeFields(rawFields);
            const fileField = fields.find((field) => field.uploadFile)
                ?? rawFields.find((field) => field.uploadFile);
            const idField = rawFields.find((field) => field.generated && field.idAttribute);

            if (!fileField || !idField) {
                return null;
            }

            const aggregate = aggregateName({
                title: command.concept ?? command.aggregateName ?? command.aggregate ?? command.title
            }, slice, aggregates, contexts);
            const deployment = backendModuleForContext(slice.context ?? slice.chapter, backendModules);
            return {
                dataProviderName: deployment.dataProviderName,
                aggregateRoute: axonRoute(cleanTitle(aggregate.title)),
                commandRoute: axonRoute(cleanTitle(command.title)),
                fileField: fileField.name,
                idField: idField.name,
                additionalFields: fields
                    .filter((field) => field.name !== fileField.name && field.name !== idField.name)
                    .filter((field) => !field.generated && !field.optional && !field.technicalAttribute && !field.uploadFile)
                    .map((field) => ({
                        name: field.name,
                        type: field.type ?? 'String'
                    }))
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.dataProviderName.localeCompare(right.dataProviderName)
            || left.aggregateRoute.localeCompare(right.aggregateRoute)
            || left.commandRoute.localeCompare(right.commandRoute));

    const capability = candidates[0];
    if (!capability) {
        return null;
    }

    return {
        dataProviderName: capability.dataProviderName,
        path: `/${capability.aggregateRoute}/${capability.commandRoute}/file`,
        fileField: capability.fileField,
        idField: capability.idField,
        additionalFields: capability.additionalFields ?? []
    };
}

module.exports = {
    buildFrontendModel,
    buildDomainModel,
    buildCommandChoices,
    normalizeSelectedCommands
};
