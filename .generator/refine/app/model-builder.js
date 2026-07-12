/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {uniqueChapters, buildI18nModel} = require('./model-utils');
const {buildBackendModules, backendModuleForContext, withModuleResourceRoutes} = require('./backend-modules');
const {buildDomainModel, withResolvedValueTypes} = require('./domain-model');
const {buildWorkflowModel} = require('./workflow-model');
const {toReadModelResource, uniqueResourceNames} = require('./resource-model');
const {withChapterI18n, withResourceI18n} = require('./i18n-model');
const {buildCommandChoices, normalizeSelectedCommands} = require('./command-selection');
const {aggregateName} = require('./resource-naming');

function buildFrontendModel(source, selectedCommandKeys) {
    source = withResolvedValueTypes(source);
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

    return {
        appName: source.domain ?? 'Event Sourcing App',
        backendModules: modules,
        chapters,
        resources: resources.sort((a, b) => a.route.localeCompare(b.route)),
        i18n
    };
}

module.exports = {
    buildFrontendModel,
    buildDomainModel,
    buildCommandChoices,
    normalizeSelectedCommands
};
