import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

export function normalizePlatform(value) {
    const [os, rawArch, variant, ...extra] = String(value).split('/');
    const arch = ({x86_64: 'amd64', aarch64: 'arm64'})[rawArch] || rawArch;
    if (os !== 'linux' || !['amd64', 'arm64', 'arm', 'ppc64le', 's390x', 'riscv64'].includes(arch)
        || extra.length || (variant && !/^v[0-9]+$/.test(variant))) throw new Error(`Invalid Docker platform: ${value}`);
    return [os, arch, variant].filter(Boolean).join('/');
}

export function platformReference(reference, platform) {
    const key = createHash('sha256').update(reference).digest('hex').slice(0, 32);
    return `medol-platform-cache/${key}:${normalizePlatform(platform).replaceAll('/', '-')}`;
}

export function createPlatformCache({dryRun = false, execute, log = console.log} = {}) {
    const invoke = execute || ((args, optional = false) => {
        const result = spawnSync('docker', args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
        if (result.error) throw result.error;
        if (result.status !== 0) {
            if (optional && /No such (image|object)/i.test(result.stderr)) return undefined;
            throw new Error(result.stderr || `docker ${args[0]} failed`);
        }
        return result.stdout;
    });
    const inspect = ref => {
        const result = invoke(['image', 'inspect', ref], true);
        return result === undefined ? undefined : JSON.parse(result)[0];
    };
    const actualPlatform = info => normalizePlatform(`${info.Os}/${info.Architecture}${info.Variant ? '/' + info.Variant : ''}`);
    const matches = (info, platform) => info && (actualPlatform(info) === platform
        || (platform === 'linux/arm64' && actualPlatform(info) === 'linux/arm64/v8'));
    const tag = (id, ref) => invoke(['tag', id, ref]);
    function nativePlatform() {
        if (dryRun) {
            log('[platform-cache] dry-run assumes client architecture; use --platform for a remote Docker Engine');
            return normalizePlatform(`linux/${process.arch === 'x64' ? 'amd64' : process.arch}`);
        }
        return normalizePlatform(invoke(['info', '--format', '{{.OSType}}/{{.Architecture}}']).trim());
    }
    function pin(ref) {
        if (dryRun) return;
        const info = inspect(ref);
        if (info) {
            tag(info.Id, platformReference(ref, actualPlatform(info)));
            if (actualPlatform(info) === 'linux/arm64/v8') tag(info.Id, platformReference(ref, 'linux/arm64'));
        }
        return info;
    }
    function find(ref, platform) {
        platform = normalizePlatform(platform);
        const current = inspect(ref);
        if (matches(current, platform)) {
            tag(current.Id, platformReference(ref, platform));
            return current;
        }
        const cached = inspect(platformReference(ref, platform));
        if (matches(cached, platform)) return cached;
        return undefined;
    }
    function ensure(ref, platform, {refresh = false} = {}) {
        platform = normalizePlatform(platform);
        if (dryRun) { log(`[platform-cache] ensure ${ref} ${platform}; refresh=${refresh}`); return; }
        const cached = find(ref, platform);
        if (cached && !refresh) { log(`[platform-cache] reuse ${ref} ${platform}`); return cached; }
        const original = pin(ref);
        try {
            log(`[platform-cache] pull ${ref} ${platform}`);
            invoke(['pull', '--platform', platform, ref]);
            const pulled = inspect(ref);
            if (!matches(pulled, platform)) throw new Error(`Pulled image platform mismatch: ${ref}`);
            tag(pulled.Id, platformReference(ref, platform));
            return pulled;
        } finally {
            if (original && !matches(original, platform) && !ref.includes('@')) tag(original.Id, ref);
        }
    }
    function withImages(refs, platform, action) {
        platform = normalizePlatform(platform);
        if (dryRun) { log(`[platform-cache] use ${platform}: ${refs.join(', ')}`); return action(); }
        const originals = [];
        try {
            // Validate every image before changing any public tag.
            const selected = refs.map(ref => {
                const info = find(ref, platform);
                if (!info) throw new Error(`Missing cached ${platform} image: ${ref}; build or pull this platform first`);
                return info;
            });
            refs.forEach((ref, i) => {
                if (ref.includes('@')) return;
                originals.push([ref, pin(ref)]);
                tag(selected[i].Id, ref);
            });
            const result = action();
            if (result?.then) return result.finally(restore);
            restore();
            return result;
        } catch (error) { restore(); throw error; }
        function restore() {
            for (const [ref, original] of originals.splice(0).reverse()) {
                if (original) tag(original.Id, ref);
                else invoke(['image', 'rm', ref]);
            }
        }
    }
    function activate(refs, platform) {
        platform = normalizePlatform(platform);
        if (dryRun) { log(`[platform-cache] select ${platform}: ${refs.join(', ')}`); return; }
        const images = refs.map(ref => {
            if (ref.includes('@')) throw new Error('select requires a tag, not an immutable digest');
            const info = find(ref, platform);
            if (!info) throw new Error(`Missing cached ${platform} image: ${ref}`);
            return info;
        });
        refs.forEach((ref, i) => { pin(ref); tag(images[i].Id, ref); });
    }
    return {nativePlatform, pin, find, ensure, withImages, activate, reference: platformReference};
}
