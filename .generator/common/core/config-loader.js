/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const fs = require('fs');
const path = require('path');
const { fromCodegenModel, fromConfig, toGeneratorConfig } = require('./codegen-model');
const { loadMedolWorkspace } = require('./medol-workspace');

function loadGeneratorModel(cwd, options = {}) {
    const workspace = loadMedolWorkspace(cwd, options);
    const codegenModelPath = workspace.codegenModelPath;
    const configPath = `${cwd}/config.json`;
    const translationBundle = loadTranslationBundle(cwd, workspace);

    if (fs.existsSync(codegenModelPath)) {
        const rawCodegenModel = readJson(codegenModelPath);
        const codegenModel = withTranslationBundle(fromCodegenModel(rawCodegenModel), translationBundle);
        return {
            inputKind: 'codegen-model',
            rawCodegenModel,
            rawTranslations: translationBundle,
            rawConfig: undefined,
            codegenModel,
            config: toGeneratorConfig(codegenModel)
        };
    }

    if (!fs.existsSync(configPath)) {
        throw new Error(`❌ No .medol/codegen-model.json, codegen-model.json, or config.json found in ${cwd}. Please export codegen-model.json from Medol first.`);
    }

    const rawConfig = readJson(configPath);
    const codegenModel = withTranslationBundle(fromConfig(rawConfig), translationBundle);
    return {
        inputKind: 'config',
        rawConfig,
        rawTranslations: translationBundle,
        rawCodegenModel: undefined,
        codegenModel,
        config: toGeneratorConfig(codegenModel, rawConfig)
    };
}

function readJson(path) {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function loadTranslationBundle(cwd, workspace = {}) {
    const bundles = translationBundleCandidates(cwd, workspace)
        .filter((candidate) => fs.existsSync(candidate))
        .map((candidate) => normalizeTranslationBundle(readJson(candidate)))
        .filter(Boolean);
    if (bundles.length === 0) {
        return undefined;
    }

    return mergeTranslationBundles(bundles);
}

function normalizeTranslationBundle(bundle) {
    if (!bundle || typeof bundle !== 'object') {
        return undefined;
    }

    const source = bundle.codegen && typeof bundle.codegen === 'object'
        ? bundle.codegen
        : bundle;
    const translations = source.translations && typeof source.translations === 'object'
        ? source.translations
        : undefined;
    if (!translations) {
        return undefined;
    }

    return {
        translations,
        ...(Array.isArray(source.locales) ? {locales: source.locales} : {}),
        ...(typeof source.defaultLocale === 'string' ? {defaultLocale: source.defaultLocale} : {})
    };
}

function withTranslationBundle(codegenModel, translationBundle) {
    if (!translationBundle) {
        return codegenModel;
    }

    const translations = mergeTranslationMaps(translationBundle.translations, codegenModel.translations);
    const locales = [
        ...(codegenModel.locales ?? []),
        ...(translationBundle.locales ?? Object.keys(translationBundle.translations ?? {}))
    ].filter(Boolean);

    return {
        ...codegenModel,
        translations,
        ...(locales.length > 0 ? {locales: Array.from(new Set(locales))} : {}),
        defaultLocale: translationBundle.defaultLocale ?? codegenModel.defaultLocale
    };
}

function translationBundleCandidates(cwd, workspace = {}) {
    const fixed = [
        workspace.translationsPath,
        `${cwd}/.medol/translations.json`,
        `${cwd}/.medol/model-translations.json`,
        `${cwd}/translations.json`,
        `${cwd}/model-translations.json`
    ].filter(Boolean);
    const directories = [`${cwd}/.medol`, cwd].filter((directory) => fs.existsSync(directory));
    const localeBundles = directories.length > 0
        ? directories.flatMap((directory) => fs.readdirSync(directory)
            .filter((file) => /^model-translations\..+\.json$/.test(file))
            .map((file) => path.join(directory, file)))
        : [];
    return Array.from(new Set([...fixed, ...localeBundles]));
}

function mergeTranslationBundles(bundles) {
    return bundles.reduce((merged, bundle) => ({
        translations: mergeTranslationMaps(merged.translations, bundle.translations),
        locales: Array.from(new Set([
            ...(merged.locales ?? []),
            ...(bundle.locales ?? Object.keys(bundle.translations ?? {}))
        ].filter(Boolean))),
        defaultLocale: bundle.defaultLocale ?? merged.defaultLocale
    }), {
        translations: {},
        locales: [],
        defaultLocale: undefined
    });
}

function mergeTranslationMaps(...translationMaps) {
    const merged = {};
    translationMaps.filter(Boolean).forEach((translationMap) => {
        Object.entries(translationMap).forEach(([locale, translations]) => {
            merged[locale] = {
                ...(merged[locale] ?? {}),
                ...(translations ?? {})
            };
        });
    });
    return merged;
}

module.exports = {
    loadGeneratorModel
};
