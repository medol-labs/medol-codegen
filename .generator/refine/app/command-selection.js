/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {cleanTitle} = require('./model-utils');
const {buildAutomationCommandKeys, isAutomationCommand} = require('./workflow-model');
const {aggregateName} = require('./resource-naming');

function buildCommandChoices(source) {
    const slices = source.slices ?? [];
    const choicesByKey = new Map();
    const automationCommandKeys = buildAutomationCommandKeys(slices);

    slices.forEach((slice) => {
        (slice.commands ?? [])
            .filter((command) => command?.title)
            .filter((command) => !isAutomationCommand(command, automationCommandKeys))
            .forEach((command) => {
                const key = commandKey(command);
                if (!choicesByKey.has(key)) {
                    choicesByKey.set(key, {
                        name: `${aggregateName(command, slice, source.aggregates ?? [], source.contexts ?? source.context ?? []).title} -> ${cleanTitle(command.title)}`,
                        value: key,
                        checked: true
                    });
                }
            });
    });

    return Array.from(choicesByKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSelectedCommands(commands) {
    if (!commands) {
        return undefined;
    }
    if (Array.isArray(commands)) {
        return commands;
    }
    return String(commands)
        .split(',')
        .map((command) => command.trim())
        .filter(Boolean);
}

function commandKey(command) {
    return String(command.id ?? command.title);
}

module.exports = {
    buildCommandChoices,
    normalizeSelectedCommands
};
