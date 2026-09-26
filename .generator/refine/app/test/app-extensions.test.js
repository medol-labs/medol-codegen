const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const templates = path.resolve(__dirname, '../templates');

const readTemplate = (relativePath) =>
    fs.readFileSync(path.join(templates, relativePath), 'utf8');

const occurrences = (content, value) => content.split(value).length - 1;

test('generated frontend framework delegates application-specific behavior to stable extensions', () => {
    assert.match(readTemplate('root/src/App.tsx'), /AppExtensionProvider/);
    assert.match(readTemplate('root/src/App.tsx'), /resolveBackendBaseUrl/);
    assert.match(readTemplate('root/src/components/refine-ui/layout/header.tsx'), /HeaderExtensionActions/);
    const sidebar = readTemplate('root/src/components/refine-ui/layout/sidebar.tsx');
    assert.match(sidebar, /useAppExtensions/);
    assert.match(sidebar, /filterBackendModules\(backendModules\)/);
    assert.match(readTemplate('EXTENSIONS.md.tpl'), /Blueprint/);
    assert.match(readTemplate('EXTENSIONS.md.tpl'), /src\/domain\/page-overrides\.tsx/);
    assert.match(readTemplate('EXTENSIONS.md.tpl'), /src\/domain\/app-extensions\.tsx/);
    assert.match(readTemplate('EXTENSIONS.md.tpl'), /src\/app\/composition\/composition\.custom\.ts/);
    const router = readTemplate('root/src/providers/app-router.tsx');
    assert.equal(occurrences(router, 'import { AuthenticatedRouteExtension }'), 1);
    assert.equal(occurrences(router, '<AuthenticatedRouteExtension>'), 1);
    assert.equal(occurrences(router, '</AuthenticatedRouteExtension>'), 1);
    assert.match(readTemplate('root/src/providers/permify-access-control-provider.ts'), /evaluateAdditionalAccess/);

    const defaultExtensions = readTemplate('app-extensions.tsx');
    assert.doesNotMatch(defaultExtensions, /federation-learning|runtime-agent|organizationId/i);
    assert.match(defaultExtensions, /module\.resources\.length > 0/);
});

test('custom application extensions are created only when missing', () => {
    const generatorSource = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');

    assert.match(generatorSource, /if \(!fs\.existsSync\(appExtensionsPath\)\)/);
    assert.match(generatorSource, /templates\/app-extensions\.tsx|app-extensions\.tsx/);
    assert.match(generatorSource, /if \(!fs\.existsSync\(pageOverridesPath\)\)/);
    assert.match(generatorSource, /if \(!fs\.existsSync\(resourceOverridesPath\)\)/);
    assert.match(generatorSource, /if \(!fs\.existsSync\(customCompositionPath\)\)/);
    assert.ok(fs.existsSync(path.join(templates, 'page-overrides.tsx')));
    assert.ok(fs.existsSync(path.join(templates, 'resource-overrides.tsx')));
    assert.ok(fs.existsSync(path.join(templates, 'composition.custom.ts')));
    assert.ok(fs.existsSync(path.join(templates, 'composition.resolved.ts')));
});

test('frontend application selection is available to runtime configuration', () => {
    const runtimeConfig = readTemplate('root/docker-entrypoint.d/40-runtime-config.sh');

    assert.match(runtimeConfig, /VITE_FRONTEND_APP/);
    assert.match(runtimeConfig, /\$\{VITE_FRONTEND_APP:-\}/);
});

test('frontend package declares directly imported peer dependencies', () => {
    const packageTemplate = JSON.parse(readTemplate('root/package.json'));

    assert.equal(packageTemplate.dependencies['@supabase/supabase-js'], '2.90.1');
    assert.equal(packageTemplate.dependencies['@tanstack/react-query'], '5.90.16');
});

test('command button template supports generated interaction modes', () => {
    const commandButton = readTemplate('root/src/components/refine-ui/buttons/command.tsx');
    const commandHook = readTemplate('root/src/hooks/command/useCommandButton.ts');
    const resourcesTemplate = readTemplate('src/providers/resources.tsx.tpl');

    assert.match(commandHook, /CommandInteractionMode/);
    assert.match(commandHook, /useCreate/);
    assert.match(commandHook, /interactionMode/);
    assert.match(commandButton, /interactionMode === "confirm"/);
    assert.match(commandButton, /interactionMode === "direct"/);
    assert.match(commandButton, /PopoverContent/);
    assert.match(resourcesTemplate, /uiPattern/);
    assert.match(resourcesTemplate, /requiresPage/);
});

test('frontend extension manifest model lists resources, commands, and fields', () => {
    const { _test } = require('../index');
    const manifest = _test.buildExtensionManifestModel({
        appName: 'Participant Console',
        frontendApplication: {
            name: 'FederationLearningParticipantConsole',
            title: 'Federation Learning Participant Console'
        },
        backendModules: [{
            name: 'runtime-agent',
            label: 'Runtime Agent',
            dataProviderName: 'runtime-agent',
            homeRoute: '/dashboard'
        }],
        resources: [{
            route: 'dataset-readiness',
            name: 'dataset_readiness',
            label: 'Dataset Readiness',
            component: 'DatasetReadiness',
            moduleName: 'runtime-agent',
            dataProviderName: 'runtime-agent',
            canList: true,
            listPagePath: 'runtimeagentoperations/slices/dataset-readiness',
            listFile: 'list',
            showPagePath: 'runtimeagentoperations/slices/dataset-readiness',
            showFile: 'show',
            fields: [{ name: 'datasetId', label: 'Dataset Id', tsType: 'string' }],
            commands: [{
                name: 'approveDatasetForTraining',
                pagePath: 'runtimeagentoperations/slices/approve-dataset-for-training',
                file: 'approve-dataset-for-training',
                fields: [{ name: 'datasetId', label: 'Dataset Id', tsType: 'string' }]
            }],
            itemCommands: [],
        }]
    });

    assert.equal(manifest.appName, 'FederationLearningParticipantConsole');
    assert.equal(manifest.resources[0].pageOverrides[0].key, 'dataset-readiness:list');
    assert.equal(manifest.resources[0].pageOverrides[2].key, 'dataset-readiness:approveDatasetForTraining');
    assert.equal(manifest.resources[0].commandOverrides[0].overrideKey, 'dataset-readiness:approveDatasetForTraining');
    assert.equal(manifest.resources[0].fieldOverrides[0].overrideId, 'field:datasetId');
});

test('frontend templates include typed composition and blueprint skeleton', () => {
    const compositionTemplate = readTemplate('src/app/composition/composition.generated.ts.tpl');
    const platformComposition = readTemplate('root/src/platform/composition/index.ts');
    const blueprintContract = readTemplate('root/src/platform/blueprint/contracts/index.ts');
    const blueprintResolver = readTemplate('root/src/platform/blueprint/resolver/index.ts');
    const pageOverrides = readTemplate('page-overrides.tsx');

    assert.match(compositionTemplate, /frontendCompositionGenerated/);
    assert.match(platformComposition, /ExtensionDefinition/);
    assert.match(platformComposition, /OverrideDefinition/);
    assert.match(platformComposition, /resolveFrontendComposition/);
    assert.match(platformComposition, /renderFieldOverride/);
    assert.match(platformComposition, /renderSlotExtensions/);
    assert.match(platformComposition, /runFormBehavior/);
    assert.match(platformComposition, /MEDOL-FE-EXT-001/);
    assert.match(readTemplate('composition.resolved.ts'), /frontendCompositionGenerated/);
    assert.match(readTemplate('composition.resolved.ts'), /frontendCompositionCustom/);
    assert.match(blueprintContract, /FrontendBlueprint/);
    assert.match(blueprintContract, /ResolvedFrontendBlueprint/);
    assert.match(blueprintContract, /ListPageModel/);
    assert.match(blueprintResolver, /MEDOL-FE-BLUEPRINT-002/);
    assert.match(blueprintResolver, /MEDOL-FE-BLUEPRINT-004/);
    assert.match(pageOverrides, /PageOverrideTarget/);
    assert.match(pageOverrides, /frontendComposition\.overrides/);
});
