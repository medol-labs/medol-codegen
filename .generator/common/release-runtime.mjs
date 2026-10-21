import {existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const number = '(0|[1-9]\\d*)';
const deliveryPattern = new RegExp(`^v?${number}\\.${number}\\.${number}\\.${number}$`);
const baselinePattern = new RegExp(`^v${number}\\.${number}\\.${number}$`);

export function defaultImageVersion({root, target = 'axon5', generationRoot = root, operation = 'build', fallback = '0.0.1-SNAPSHOT'}) {
    if (!/^[a-zA-Z0-9_-]+$/.test(target)) throw new Error('Invalid generation target.');
    const file = resolve(generationRoot, '.medol/generation', `${target}.json`);
    const generation = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
    const release = generation?.model?.metadata?.source?.release;
    const builtFile = resolve(root, '.medol/build-manifest.json');
    if (['export', 'push', 'push-registry'].includes(operation) && existsSync(builtFile)) {
        const built = JSON.parse(readFileSync(builtFile, 'utf8'));
        if (built.generation?.target === target && built.generation?.model?.sha256 === generation?.model?.sha256) {
            return validateDeliveryVersion(built.imageVersion, generation?.model?.metadata).imageVersion;
        }
    }
    return release?.channel === 'stable' && baselinePattern.test(release.label ?? '') ? `${release.label}.0` : fallback;
}

function codeState(root, target) {
    const ignored = (file) => /(^|\/)(node_modules|target|dist|build|coverage|\.git|\.medol|\.work)(\/|$)/.test(file)
        || /(^|\/)(medol-build\.json|release-manifest\.json)$/.test(file)
        || /\.(tar|tar\.gz|manifest\.json)$/.test(file)
        || (target === 'operations' && (/^docs\//.test(file) || /^README(?:\.[^/]*)?$/i.test(file)));
    const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {cwd: root, encoding: 'utf8'});
    let files;
    if (listed.status === 0) files = listed.stdout.split('\0').filter(Boolean);
    else {
        files = [];
        const walk = (directory, prefix = '') => {
            for (const entry of readdirSync(directory, {withFileTypes: true})) {
                const name = prefix + entry.name;
                if (ignored(name)) continue;
                if (entry.isDirectory()) walk(resolve(directory, entry.name), name + '/');
                else if (entry.isFile()) files.push(name);
            }
        };
        walk(root);
    }
    const codeHash = createHash('sha256');
    for (const file of [...new Set(files)].filter((file) => !ignored(file)).sort()) {
        const absolute = resolve(root, file);
        codeHash.update(file).update('\0');
        codeHash.update(existsSync(absolute) && statSync(absolute).isFile() ? readFileSync(absolute) : '<deleted>').update('\0');
    }
    const changed = spawnSync('git', ['diff', 'HEAD', '--name-only', '-z'], {cwd: root, encoding: 'utf8'});
    const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {cwd: root, encoding: 'utf8'});
    return {sha256: codeHash.digest('hex'), dirty: changed.status === 0
        ? [...changed.stdout.split('\0'), ...untracked.stdout.split('\0')].some((file) => file && !ignored(file)) : null};
}

export function validateDeliveryVersion(version, metadata) {
    if (/^v?\d+\.\d+\.\d+\.\d+$/.test(version) && (!version.startsWith('v') || !deliveryPattern.test(version))) {
        throw new Error('Delivery versions require canonical vX.Y.Z.N without leading zeroes.');
    }
    const release = metadata?.source?.release;
    const match = deliveryPattern.exec(version);
    if (release?.label !== undefined && !baselinePattern.test(release.label)) throw new Error('Model release label must be vX.Y.Z.');
    if (release?.channel === 'stable' && !baselinePattern.test(release.label ?? '')) throw new Error('Stable model release requires a vX.Y.Z label.');
    if (release?.channel === 'stable' && release.label) {
        if (!match || `v${match[1]}.${match[2]}.${match[3]}` !== release.label) {
            throw new Error(`Image version must be ${release.label}.N (four numeric parts matching the model release).`);
        }
    } else if (match) {
        throw new Error('Four-part delivery versions require a stable model release label.');
    }
    return {imageVersion: version, packageVersion: release?.channel === 'stable' ? release.label?.slice(1) : undefined};
}

export function prepareRelease({root, version, target = 'axon5', generationRoot = root, buildOptions = {}, variant = '', operation = 'build', dryRun = false}) {
    root = resolve(root);
    generationRoot = resolve(generationRoot);
    if (!/^[a-zA-Z0-9_-]+$/.test(target)) throw new Error('Invalid generation target.');
    if (variant && !/^[a-zA-Z0-9_-]+$/.test(variant)) throw new Error('Invalid release variant.');
    const recordPath = resolve(generationRoot, '.medol/generation', `${target}.json`);
    const generation = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : undefined;
    const versionInfo = validateDeliveryVersion(String(version), generation?.model?.metadata);
    if (!['build', 'export', 'push'].includes(operation)) throw new Error('Invalid release operation.');
    const isDelivery = deliveryPattern.test(String(version));
    const canonicalVersion = 'v' + String(version).replace(/^v/, '') + (variant ? `--${variant}` : '');
    const claimFile = resolve(root, '.medol/releases', `${canonicalVersion}.identity.json`);
    const releaseFile = resolve(root, '.medol/releases', `${canonicalVersion}.json`);
    let recordedBuild;
    if (operation !== 'build') {
        const buildFile = isDelivery ? claimFile : resolve(root, '.medol/build-manifest.json');
        recordedBuild = existsSync(buildFile) ? JSON.parse(readFileSync(buildFile, 'utf8')) : undefined;
        if (recordedBuild?.imageVersion !== String(version) || (recordedBuild?.variant ?? '') !== variant) recordedBuild = undefined;
        if (isDelivery && !recordedBuild && !dryRun && target !== 'operations') throw new Error('No matching build record; build this delivery before export or push.');
    }
    if (versionInfo.packageVersion && target === 'refine' && existsSync(resolve(root, 'package.json'))
        && JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version !== versionInfo.packageVersion) {
        throw new Error('Frontend package version does not match stable baseline; regenerate the skeleton or sync release support.');
    }
    if (versionInfo.packageVersion && target === 'axon5') {
        const checkPoms = (directory) => {
            for (const entry of readdirSync(directory, {withFileTypes: true})) {
                if (['node_modules', '.git', 'target', '.medol'].includes(entry.name)) continue;
                const file = resolve(directory, entry.name);
                if (entry.isDirectory()) checkPoms(file);
                else if (entry.name === 'pom.xml') {
                    const ownVersion = readFileSync(file, 'utf8').match(/^    <version>([^<]+)<\/version>/m)?.[1];
                    if (ownVersion && ownVersion !== versionInfo.packageVersion) throw new Error('Maven package version does not match stable baseline; regenerate the skeleton or sync release support.');
                }
            }
        };
        checkPoms(root);
    }
    if (generation) {
        if (generation.schemaVersion !== 1 || generation.target !== target) throw new Error('Invalid generation record.');
        for (const input of generation.inputs ?? []) {
            const file = resolve(generationRoot, input.path);
            if (!existsSync(file)) throw new Error(`Generation input missing: ${input.path}; regenerate before building.`);
            if (hash(readFileSync(file)) !== input.sha256) throw new Error(`Generation input hash mismatch: ${input.path}; regenerate before building.`);
        }
        const source = generation.model?.metadata?.source;
        const sourceInput = generation.inputs?.find((input) => /(^|\/)source\.medol$/.test(input.path));
        if (source?.release?.channel === 'stable' && !sourceInput) throw new Error('Stable delivery requires a verified source.medol generation input.');
        if (sourceInput && source && sourceInput.sha256 !== source.sha256) throw new Error('source.medol hash does not match model metadata.');
    }
    const gitResult = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'});
    const revision = recordedBuild ? recordedBuild.git?.revision ?? null
        : gitResult.status === 0 ? gitResult.stdout.trim() : null;
    const code = codeState(root, target);
    const stableGeneration = generation ? {...generation, generatedAt: undefined} : null;
    const buildOptionsSha256 = recordedBuild?.buildOptionsSha256 ?? hash(JSON.stringify(buildOptions));
    const buildIdentity = hash(JSON.stringify({version: String(version).replace(/^v/, ''), variant, buildOptionsSha256, revision, code: code.sha256, generation: stableGeneration}));
    let manifest = {
        schemaVersion: 1, builtAt: new Date().toISOString(), ...versionInfo,
        buildIdentity, codeSha256: code.sha256, buildOptionsSha256, ...(variant ? {variant} : {}),
        git: recordedBuild?.git ?? {revision, dirty: code.dirty},
        generation: generation ?? null, images: []
    };
    const baseline = generation?.model?.metadata?.source?.release?.label;
    const baselineFile = baseline ? resolve(root, '.medol/baselines', `${baseline}.json`) : undefined;
    const checkBaseline = () => {
        if (!isDelivery || !baselineFile || !existsSync(baselineFile)) return;
        if (JSON.parse(readFileSync(baselineFile, 'utf8')).sourceSha256 !== generation.model.metadata.source.sha256) {
            throw new Error(`Model release ${baseline} already identifies different source; create a new baseline label.`);
        }
    };
    checkBaseline();
    const checkClaim = () => {
        if (!isDelivery || !existsSync(claimFile)) return;
        const previous = JSON.parse(readFileSync(claimFile, 'utf8'));
        if (previous.buildIdentity !== buildIdentity) throw new Error(`Delivery version ${version} is already reserved for different code or inputs; increment BUILD.`);
        manifest.builtAt = previous.builtAt;
        manifest.generation = previous.generation;
    };
    checkClaim();
    const claim = () => {
        if (!isDelivery || dryRun) return;
        mkdirSync(dirname(baselineFile), {recursive: true});
        try { writeFileSync(baselineFile, JSON.stringify({schemaVersion: 1, label: baseline, sourceSha256: generation.model.metadata.source.sha256}) + '\n', {flag: 'wx'}); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        checkBaseline();
        mkdirSync(dirname(claimFile), {recursive: true});
        try { writeFileSync(claimFile, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'}); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        checkClaim();
    };
    const labels = {
        'org.opencontainers.image.version': String(version),
        'tech.medol.build.identity': buildIdentity,
        'tech.medol.code.sha256': code.sha256,
        ...(revision ? {'org.opencontainers.image.revision': revision} : {}),
        ...(generation ? {
            'tech.medol.model.sha256': generation.model.sha256,
            'tech.medol.generator.sha256': generation.generator.sha256,
            'tech.medol.generation.sha256': hash(JSON.stringify(stableGeneration)),
            ...(generation.model.metadata ? {'tech.medol.source.sha256': generation.model.metadata.source.sha256} : {})
        } : {})
    };
    const write = (file, data) => {
        if (dryRun) return;
        mkdirSync(dirname(file), {recursive: true});
        writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    };
    const inspectImages = (names, {requireRepoDigests = false, components = manifest.components ?? []} = {}) => names.map((name) => {
        if (dryRun) return {name, id: null, repoDigests: []};
        const result = spawnSync('docker', ['image', 'inspect', name, '--format', '{{json .}}'], {cwd: root, encoding: 'utf8'});
        if (result.status !== 0) throw new Error(`Cannot inspect delivery image ${name}.`);
        const image = JSON.parse(result.stdout);
        if (!image.Id) throw new Error(`Image ${name} has no image ID.`);
        if (isDelivery) {
            const component = components.find((entry) => entry.images?.some((image) => image.name === name));
            const componentImage = component?.images.find((entry) => entry.name === name);
            if (componentImage?.id && componentImage.id !== image.Id) throw new Error(`Component image ID mismatch for ${name}.`);
            const expected = component ? {
                'org.opencontainers.image.version': component.imageVersion,
                'tech.medol.build.identity': component.buildIdentity,
                'tech.medol.code.sha256': component.codeSha256,
                'tech.medol.model.sha256': component.generation.model.sha256,
                'tech.medol.generator.sha256': component.generation.generator.sha256,
                'tech.medol.source.sha256': component.generation.model.metadata.source.sha256
            } : labels;
            for (const [key, value] of Object.entries(expected)) {
                if (image.Config?.Labels?.[key] !== value) throw new Error(`Image provenance label mismatch for ${name}: ${key}; rebuild with this delivery identity.`);
            }
            if (existsSync(releaseFile)) {
                const previous = JSON.parse(readFileSync(releaseFile, 'utf8')).images?.find((entry) => entry.name === name);
                if (previous && previous.id !== image.Id) throw new Error(`Delivery image changed for ${version}; increment BUILD.`);
            }
            const completedFile = resolve(root, '.medol/releases', `${canonicalVersion}--image-${hash(name)}.json`);
            if (existsSync(completedFile) && JSON.parse(readFileSync(completedFile, 'utf8')).id !== image.Id) {
                throw new Error(`Delivery image changed for ${version}; increment BUILD.`);
            }
            const repository = name.replace(/:[^/:]+$/, '');
            if (requireRepoDigests && !(image.RepoDigests ?? []).some((digest) => digest.startsWith(`${repository}@sha256:`) && /@sha256:[a-f0-9]{64}$/.test(digest))) {
                throw new Error(`Pushed image ${name} has no repository digest.`);
            }
        }
        return {name, id: image.Id, repoDigests: image.RepoDigests ?? []};
    });
    return {
        get manifest() { return manifest; }, labels, claim, verifyImages: inspectImages,
        dockerArgs: Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
        jibArgs: [`-Djib.container.labels=${Object.entries(labels).map(([key, value]) => `${key}=${value}`).join(',')}`],
        embed(paths) { claim(); for (const file of paths) write(resolve(root, file), manifest); },
        writeManifest(file = '.medol/build-manifest.json', images = [], options = {}) {
            claim();
            manifest.images = inspectImages(images, options);
            if (isDelivery && !dryRun) {
                const completed = {...manifest, images: manifest.images};
                if (existsSync(releaseFile)) {
                    const previous = JSON.parse(readFileSync(releaseFile, 'utf8'));
                    // Registry digests may appear after push; local image IDs must remain immutable.
                    for (const image of completed.images) {
                        const prior = previous.images.find((entry) => entry.name === image.name);
                        if (prior && prior.id !== image.id) throw new Error(`Delivery image changed for ${version}; increment BUILD.`);
                    }
                }
                // Each image has an immutable completion record so module subsets accumulate safely.
                for (const image of completed.images) {
                    const imageFile = resolve(root, '.medol/releases', `${canonicalVersion}--image-${hash(image.name)}.json`);
                    if (existsSync(imageFile)) {
                        const previous = JSON.parse(readFileSync(imageFile, 'utf8'));
                        if (previous.id !== image.id) throw new Error(`Delivery image changed for ${version}; increment BUILD.`);
                    } else writeFileSync(imageFile, JSON.stringify({...image, buildIdentity}, null, 2) + '\n', {flag: 'wx'});
                }
                if (!existsSync(releaseFile)) writeFileSync(releaseFile, JSON.stringify(completed, null, 2) + '\n', {flag: 'wx'});
            }
            write(resolve(root, file), manifest);
            return manifest;
        }
    };
}
