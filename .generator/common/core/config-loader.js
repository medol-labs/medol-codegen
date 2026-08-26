/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const fs = require('fs');
const { fromCodegenModel, fromConfig, toGeneratorConfig } = require('./codegen-model');

function loadGeneratorModel(cwd) {
    const codegenModelPath = `${cwd}/codegen-model.json`;
    const configPath = `${cwd}/config.json`;
    const translationBundle = loadTranslationBundle(cwd);

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
        throw new Error(`❌ No codegen-model.json or config.json found in ${cwd}. Please export codegen-model.json from Event Modeling Toolkit first.`);
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

function loadTranslationBundle(cwd) {
    const bundles = translationBundleCandidates(cwd)
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

function translationBundleCandidates(cwd) {
    const fixed = [
        `${cwd}/translations.json`,
        `${cwd}/model-translations.json`
    ];
    const localeBundles = fs.existsSync(cwd)
        ? fs.readdirSync(cwd)
            .filter((file) => /^model-translations\..+\.json$/.test(file))
            .map((file) => `${cwd}/${file}`)
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
