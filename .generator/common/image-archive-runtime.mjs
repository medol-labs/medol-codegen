import {createReadStream, lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const sha256Pattern = /^[a-f0-9]{64}$/;

function regularFile(file, description) {
    try {
        if (lstatSync(file).isFile()) return;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    throw new Error(`${description} must exist as a regular file: ${file}. Legacy archives without a sidecar require direct legacy docker load -i <archive>; automatic fallback is disabled.`);
}

// Stream multi-gigabyte archives with bounded memory, counting the bytes actually hashed.
export async function archiveChecksum(archiveFile) {
    regularFile(archiveFile, 'Image archive');
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of createReadStream(archiveFile)) {
        hash.update(chunk);
        size += chunk.length;
    }
    return {sha256: hash.digest('hex'), size};
}

function inspectImage(name, root) {
    const result = spawnSync('docker', ['image', 'inspect', name, '--format', '{{json .}}'], {cwd: root, encoding: 'utf8'});
    if (result.status !== 0) throw new Error(`Cannot inspect archive image ${name}.`);
    return JSON.parse(result.stdout);
}

function expectedLabels(manifest, image) {
    const component = manifest.components?.find((entry) => entry.images?.some((item) => item.name === image.name));
    const identity = component ?? manifest;
    const generation = identity.generation;
    const release = generation?.model?.metadata?.source?.release;
    if (release?.channel === 'stable' && (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.label ?? '')
        || !new RegExp(`^${release.label.replaceAll('.', '\\.')}\\.(0|[1-9]\\d*)$`).test(identity.imageVersion ?? ''))) {
        throw new Error('Archive sidecar stable release version mismatch.');
    }
    return {
        'org.opencontainers.image.version': identity.imageVersion,
        'tech.medol.build.identity': identity.buildIdentity,
        ...(identity.codeSha256 ? {'tech.medol.code.sha256': identity.codeSha256} : {}),
        ...(identity.git?.revision ? {'org.opencontainers.image.revision': identity.git.revision} : {}),
        ...(generation ? {
            'tech.medol.model.sha256': generation.model.sha256,
            'tech.medol.generator.sha256': generation.generator.sha256,
            ...(generation.model.metadata?.source?.sha256 ? {'tech.medol.source.sha256': generation.model.metadata.source.sha256} : {})
        } : {})
    };
}

function validateManifest(manifest, {expectedImages, imageVersion} = {}) {
    if (manifest?.schemaVersion !== 1 || !sha256Pattern.test(manifest.buildIdentity ?? '')
        || typeof manifest.imageVersion !== 'string' || !manifest.imageVersion
        || !sha256Pattern.test(manifest.archive?.sha256 ?? '')
        || !Number.isSafeInteger(manifest.archive?.size) || manifest.archive.size < 0
        || !Array.isArray(manifest.images) || !manifest.images.length) {
        throw new Error('Invalid archive sidecar: checksum, size, build identity and image identities are required.');
    }
    const names = new Set();
    for (const image of manifest.images) {
        if (typeof image.name !== 'string' || !image.name || names.has(image.name)
            || !/^sha256:[a-f0-9]{64}$/.test(image.id ?? '')
            || !image.labels || typeof image.labels !== 'object' || Array.isArray(image.labels)
            || Object.values(image.labels).some((value) => typeof value !== 'string')) {
            throw new Error('Invalid archive sidecar image identity or labels.');
        }
        names.add(image.name);
        for (const [key, value] of Object.entries(expectedLabels(manifest, image))) {
            if (typeof value !== 'string' || image.labels[key] !== value) {
                throw new Error(`Archive sidecar provenance label mismatch for ${image.name}: ${key}.`);
            }
        }
        const componentImage = manifest.components?.flatMap((entry) => entry.images ?? []).find((entry) => entry.name === image.name);
        if (componentImage && componentImage.id !== image.id) throw new Error(`Archive sidecar component image ID mismatch for ${image.name}.`);
    }
    if (imageVersion !== undefined && manifest.imageVersion !== imageVersion) throw new Error('Archive sidecar image version mismatch.');
    if (expectedImages && (expectedImages.length !== names.size || expectedImages.some((name) => !names.has(name)))) {
        throw new Error('Archive sidecar image names mismatch.');
    }
    return manifest;
}

export async function writeArchiveManifest({archiveFile, manifest, labels = {}, root = process.cwd(), dryRun = false}) {
    if (dryRun) return;
    const images = manifest.images.map((entry) => {
        const image = inspectImage(entry.name, root);
        if (image.Id !== entry.id) throw new Error(`Archive image ID changed during export: ${entry.name}.`);
        const actualLabels = image.Config?.Labels ?? {};
        // Component manifests carry their own identities; the bundle's build labels do not apply to them.
        const expected = manifest.components?.some((component) => component.images?.some((item) => item.name === entry.name))
            ? expectedLabels(manifest, entry) : {...expectedLabels(manifest, entry), ...labels};
        for (const [key, value] of Object.entries(expected)) {
            if (actualLabels[key] !== value) throw new Error(`Archive image provenance label mismatch for ${entry.name}: ${key}.`);
        }
        return {...entry, labels: actualLabels};
    });
    const sidecar = validateManifest({...manifest, images, archive: await archiveChecksum(archiveFile)});
    writeFileSync(`${archiveFile}.manifest.json`, JSON.stringify(sidecar, null, 2) + '\n');
    return sidecar;
}

export async function verifyArchiveManifest({archiveFile, expectedImages, imageVersion, dryRun = false}) {
    if (dryRun) return;
    regularFile(`${archiveFile}.manifest.json`, 'Archive sidecar');
    const manifest = validateManifest(JSON.parse(readFileSync(`${archiveFile}.manifest.json`, 'utf8')), {expectedImages, imageVersion});
    const actual = await archiveChecksum(archiveFile);
    if (actual.sha256 !== manifest.archive.sha256 || actual.size !== manifest.archive.size) {
        throw new Error('Image archive checksum or size mismatch; refusing docker load.');
    }
    return manifest;
}

export function verifyLoadedImages({manifest, root = process.cwd()}) {
    if (!manifest) return;
    validateManifest(manifest);
    for (const entry of manifest.images) {
        const image = inspectImage(entry.name, root);
        if (image.Id !== entry.id) throw new Error(`Loaded archive image ID mismatch for ${entry.name}.`);
        for (const [key, value] of Object.entries(entry.labels)) {
            if (image.Config?.Labels?.[key] !== value) throw new Error(`Loaded archive image label mismatch for ${entry.name}: ${key}.`);
        }
    }
}
