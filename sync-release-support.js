#!/usr/bin/env node

// Focused delivery-support refresh: no application source or deployment configuration is generated.
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('./.generator/node_modules/ejs');
const {generationRecord} = require('./.generator/common/core/generation-provenance');
const {loadMedolWorkspace} = require('./.generator/common/core/medol-workspace');

function syncReleaseSupport({cwd = process.cwd(), root, target, model, modules, image, environment = 'dev'}) {
    root = path.resolve(root ?? cwd);
    const options = {codegenModel: model, environment, scope: 'release-support'};
    const record = generationRecord(cwd, root, target, options);
    const files = new Map();
    const runtime = fs.readFileSync(path.join(__dirname, '.generator/common/release-runtime.mjs'), 'utf8');
    files.set('scripts/release-runtime.mjs', runtime);
    files.set('scripts/image-archive-runtime.mjs', fs.readFileSync(path.join(__dirname, '.generator/common/image-archive-runtime.mjs'), 'utf8'));
    if (target === 'axon5' || target === 'refine') {
        if (target === 'axon5' && (!modules?.length || modules.some((name) => !/^[\w-]+$/.test(name)))) {
            throw new Error('Pass --modules with the existing deployable backend modules (comma separated).');
        }
        if (target === 'refine' && !/^[\w-]+$/.test(image ?? '')) throw new Error('Pass --image with the existing frontend image name.');
        const templateRoot = path.join(__dirname, '.generator', target, 'app/templates', target === 'refine' ? 'root/scripts' : '');
        const template = fs.readFileSync(path.join(templateRoot, target === 'axon5' ? 'image-bundle.mjs.tpl' : 'image-bundle.mjs'), 'utf8');
        files.set('scripts/image-bundle.mjs', ejs.render(template, {
            imageModules: modules, imageName: image, imageTarName: `${target === 'axon5' ? path.basename(root) : image}-images.tar`
        }));
        for (const name of ['build', 'export', 'import', 'push']) {
            files.set(`scripts/${name}-images.mjs`, fs.readFileSync(path.join(templateRoot, `${name}-images.mjs`), 'utf8'));
        }
    } else if (target === 'operations') {
        const {loadGeneratorModel} = require('./.generator/common/core/config-loader');
        const {loadOperationsConfig} = require('./.generator/operations/app/operations-config');
        const {buildOperationsModel} = require('./.generator/operations/app/operations-model-builder');
        const {generateOperationsFiles} = require('./.generator/operations/app/operations-generator');
        const loaded = loadGeneratorModel(cwd, options);
        const workspace = loadMedolWorkspace(cwd, options);
        const generated = generateOperationsFiles(buildOperationsModel(loaded.codegenModel, loadOperationsConfig(cwd, workspace)), {target: 'model', environment});
        for (const [file, text] of Object.entries(generated)) {
            if (/\/(images|image-config|release-runtime|image-archive-runtime)\.mjs$/.test(file)) files.set(file, text);
        }
    }
    files.set(`.medol/generation/${target}.json`, JSON.stringify(record, null, 2) + '\n');
    const release = record.model.metadata?.source?.release;
    if (release?.channel === 'stable' && release.label) {
        const version = release.label.slice(1);
        const pkgPath = path.join(root, 'package.json');
        if (target === 'refine' && fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            pkg.version = version;
            files.set('package.json', JSON.stringify(pkg, null, 2) + '\n');
        }
        // Generated Maven POMs put the project version at exactly four spaces.
        const rootPom = path.join(root, 'pom.xml');
        const previousVersion = fs.existsSync(rootPom) ? fs.readFileSync(rootPom, 'utf8').match(/^    <version>([^<]+)<\/version>/m)?.[1] : undefined;
        const visitPoms = (directory) => {
            for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
                if (['node_modules', '.git', 'target', '.medol', 'operations'].includes(entry.name)) continue;
                const file = path.join(directory, entry.name);
                if (entry.isDirectory()) visitPoms(file);
                else if (entry.name === 'pom.xml') {
                    const text = fs.readFileSync(file, 'utf8');
                    let updated = text.replace(/^    <version>[^<]+<\/version>/m, `    <version>${version}</version>`);
                    for (const old of new Set(['0.0.1-SNAPSHOT', previousVersion].filter(Boolean))) {
                        updated = updated.replaceAll(`<version>${old}</version>`, `<version>${version}</version>`);
                    }
                    if (updated !== text) files.set(path.relative(root, file), updated);
                }
            }
        };
        if (target === 'axon5') visitPoms(root);
    }
    // Build the complete plan before any write, including validation and template rendering.
    for (const [file, text] of files) {
        const output = path.join(root, file);
        fs.mkdirSync(path.dirname(output), {recursive: true});
        fs.writeFileSync(output, text);
    }
    return [...files.keys()];
}

if (require.main === module) {
    try {
        const args = require('node:util').parseArgs({options: {
            root: {type: 'string'}, cwd: {type: 'string'}, target: {type: 'string'}, model: {type: 'string'},
            modules: {type: 'string'}, image: {type: 'string'}, environment: {type: 'string'}
        }}).values;
        if (!args.target) throw new Error('Required: --target axon5|refine|operations|<custom-target> --root <existing-output> --model <model-path> [--cwd <workspace>] [--modules a,b | --image name]');
        console.log(syncReleaseSupport({...args, modules: args.modules?.split(',').filter(Boolean)}).join('\n'));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = {syncReleaseSupport};
