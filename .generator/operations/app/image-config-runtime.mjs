import {existsSync, readFileSync} from 'node:fs';
import {basename, resolve} from 'node:path';

export function resolveImageConfig(directory, options = {}) {
    const env = options.env ?? process.env;
    const read = (name) => {
        const file = resolve(directory, name);
        return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    };
    const model = read(`../../model/${basename(directory)}/operations-model.json`);
    const recordFile = resolve(directory, '../../../.medol/generation/operations.json');
    const generation = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf8')) : undefined;
    const metadata = generation?.model?.metadata ?? model.metadata;
    const built = ['export', 'push', 'push-registry'].includes(options.operation)
        ? read('../../../.medol/build-manifest.json') : {};
    const recordedVersion = generation && built.generation?.target === 'operations'
        && built.generation?.model?.sha256 === generation.model?.sha256 ? built.imageVersion : undefined;
    const release = metadata?.source?.release;
    const baselineVersion = release?.channel === 'stable' && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.label ?? '')
        ? `${release.label}.0` : undefined;
    const privateFile = resolve(directory, `../../model/${basename(directory)}/operations-model.private.json`);
    const local = read(existsSync(privateFile)
        ? `../../model/${basename(directory)}/operations-model.private.json`
        : `../../model/${basename(directory)}/operations-model.local.json`);
    const registry = local.registry ?? model.registry;
    const clean = (value) => typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
    const configuredPrefix = clean(options.prefix) || clean(env.DOCKER_IMAGE_PREFIX);
    const registryPrefix = clean(registry?.imagePrefix)
        || (registry?.host ? [clean(registry.host), clean(registry.namespace)].filter(Boolean).join('/') : '');
    const buildPrefix = configuredPrefix || clean(model.imagePrefix);
    const imagePrefix = registryPrefix || buildPrefix;
    if (!imagePrefix || imagePrefix.includes('://') || /\s/.test(imagePrefix)) {
        throw new Error('Configure an image prefix without a URL scheme in the operations model, environment, or --prefix.');
    }
    const pushPrefix = clean(options.pushPrefix) || clean(env.DOCKER_PUSH_IMAGE_PREFIX) || (registry?.pushHost
        ? [clean(registry.pushHost), imagePrefix.includes('/') ? imagePrefix.slice(imagePrefix.indexOf('/') + 1) : ''].filter(Boolean).join('/') : imagePrefix);
    if (!pushPrefix || pushPrefix.includes('://') || /\s/.test(pushPrefix)) throw new Error('Invalid push image prefix.');
    const version = clean(options.version) || clean(env.IMAGE_VERSION) || clean(recordedVersion) || baselineVersion || clean(model.imageTag);
    if (!version || /[\s/@:]/.test(version)) throw new Error('Configure a valid image version.');
    const mode = options.mode ?? env.MEDOL_IMAGE_SOURCE ?? local.imageSource ?? (registryPrefix || hasRegistry(imagePrefix) ? 'registry' : 'import');
    if (!['import', 'registry'].includes(mode)) throw new Error('Image source must be import or registry.');
    if (mode === 'registry' && !hasRegistry(imagePrefix)) {
        throw new Error('Registry mode requires a registry-qualified image prefix.');
    }
    return {
        imagePrefix, buildPrefix, pushPrefix, version, mode, baseVersion: model.imageTag,
        applications: model.applications ?? [],
        buildImage: (image) => image.startsWith(`${imagePrefix}/`)
            ? `${pushPrefix}/${image.slice(imagePrefix.length + 1)}` : image,
    };
}

export function hasRegistry(image) {
    const first = String(image).split('/')[0];
    return String(image).includes('/') && (first === 'localhost' || /[.:]/.test(first));
}

export function registryDigest(image, inspection) {
    const repository = image.includes('@') ? image.split('@')[0] : image.replace(/:[^/:]+$/, '');
    const digest = (inspection.RepoDigests ?? []).find((value) => value.startsWith(`${repository}@sha256:`));
    if (!digest || !/@sha256:[a-f0-9]{64}$/i.test(digest)) {
        throw new Error(`Registry did not return a verifiable digest for ${image}.`);
    }
    return digest.slice(digest.indexOf('@'));
}

export function resolveImageArtifact(config, image, io) {
    const source = config.buildImage(image);
    const local = config.mode === 'registry' ? io.inspect(source) : null;
    if (config.mode === 'registry') io.pull(source);
    const inspection = io.inspect(source);
    if (!inspection?.Id) {
        throw new Error(`Configured image is unavailable: ${source}. Build or publish this exact image; no alternate prefix will be used.`);
    }
    if (local?.Id !== inspection.Id && Date.parse(local?.Created) > Date.parse(inspection.Created)) {
        io.tag(local.Id, source);
        throw new Error(`Registry image ${source} is older than the local build. Push the new build first or explicitly select import mode.`);
    }
    const repository = image.split('@')[0].replace(/:[^/:]+$/, '');
    const reference = config.mode === 'registry'
        ? `${repository}${registryDigest(source, inspection)}` : image;
    if (config.mode === 'import' && source !== image) io.tag(source, image);
    return {source, reference, id: inspection.Id};
}
