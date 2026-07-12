/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {
    normalizeArray,
    findAggregate,
    contextName,
    cleanTitle,
    kebab
} = require('./model-utils');

function aggregateName(command, slice, aggregates = [], contexts = []) {
    const title = cleanTitle(
        command.concept
        ?? command.concepts?.[0]
        ?? slice?.concepts?.[0]
        ?? command.aggregateName
        ?? command.aggregate
        ?? slice?.title
        ?? 'app'
    );
    const aggregate = findAggregate(command, title, aggregates);
    const context = contextName(
        command.modelContext
        ?? aggregate?.modelContext
        ?? findContextForAggregate(title, contexts)
        ?? slice?.context
        ?? slice?.modelContext
    );

    return {
        key: kebab(title),
        title,
        chapter: context
    };
}

function findContextForAggregate(aggregateTitle, contexts) {
    const normalizedAggregateTitle = cleanTitle(aggregateTitle).toLowerCase();
    return normalizeArray(contexts).find((context) => {
        return normalizeArray(context?.aggregates)
            .map((aggregate) => cleanTitle(typeof aggregate === 'string' ? aggregate : aggregate.title ?? aggregate.name).toLowerCase())
            .includes(normalizedAggregateTitle);
    });
}

module.exports = {
    aggregateName,
    findContextForAggregate
};
