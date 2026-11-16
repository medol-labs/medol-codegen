import {existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, realpathSync, lstatSync, unlinkSync} from 'node:fs';
import {resolve, dirname, relative} from 'node:path';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';

function safePath(root, path) {
    if (typeof path !== 'string' || !path) throw new Error('Output path is required');
    const target = resolve(root, path), rel = relative(root, target);
    if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('/')) throw new Error('Credential path escapes workspace');
    let current = target;
    while (current !== root) {
        try { if (lstatSync(current).isSymbolicLink()) throw new Error('Credential paths cannot contain symlinks'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        current = dirname(current);
    }
    return target;
}
function materialize(value, credentials) {
    if (Array.isArray(value)) return value.map(item => materialize(item, credentials));
    if (!value || typeof value !== 'object') return value;
    if (Object.hasOwn(value, '$secret')) {
        if (Object.keys(value).length !== 1 || !Object.hasOwn(credentials, value.$secret)) throw new Error('Unknown credential reference');
        return credentials[value.$secret];
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item, credentials)]));
}
export function prepareTestCredentials(config, {root}) {
    root = realpathSync(root);
    if (config.schemaVersion !== 1 || !config.environment || !Array.isArray(config.generate) || !config.generate.length
        || config.generate.some(key => !/^[A-Za-z][A-Za-z0-9]*$/.test(key)) || new Set(config.generate).size !== config.generate.length
        || !Array.isArray(config.outputs) || !config.outputs.length) throw new Error('Invalid test credential configuration');
    const state = safePath(root, config.stateFile), lock = safePath(root, config.stateFile + '.lock');
    const outputs = config.outputs.map(output => {
        if (!['env', 'json'].includes(output.format)) throw new Error('Unsupported credential output format');
        return {...output, path: safePath(root, output.path)};
    });
    if (new Set([state, lock, ...outputs.map(o => o.path)]).size !== outputs.length + 2) throw new Error('Credential paths must be distinct');
    mkdirSync(dirname(lock), {recursive: true});
    writeFileSync(lock, '', {flag: 'wx', mode: 0o600});
    try {
        if (!existsSync(state) && outputs.some(output => existsSync(output.path))) throw new Error('Refusing to replace unmanaged credentials');
        const credentials = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8'))
            : Object.fromEntries(config.generate.map(key => [key, randomBytes(32).toString('hex')]));
        for (const key of config.generate) if (!/^[a-f0-9]{64}$/.test(credentials[key] || '')) throw new Error('Invalid stored credential: ' + key);
        const rendered = outputs.map(output => {
            const value = materialize(output.template, credentials);
            let content;
            if (output.format === 'env') {
                if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Environment template must be an object');
                for (const [key, item] of Object.entries(value)) {
                    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof item !== 'string' || /[\r\n#"'\\]/.test(item) || item.trim() !== item) throw new Error('Invalid environment entry');
                }
                content = Object.entries(value).map(([key, item]) => key + '=' + item).join('\n') + '\n';
            } else content = JSON.stringify(value, null, 2) + '\n';
            if (existsSync(output.path)) {
                const previous = readFileSync(output.path, 'utf8');
                const differs = output.format === 'env'
                    ? Object.entries(value).some(([key, item]) => parseEnv(previous)[key] !== item)
                    : previous !== content;
                if (differs) throw new Error('Existing managed credential output differs; refusing overwrite');
            }
            return {...output, content};
        });
        if (!existsSync(state)) writeFileSync(state, JSON.stringify(credentials), {flag: 'wx', mode: 0o600});
        for (const output of rendered) {
            mkdirSync(dirname(output.path), {recursive: true});
            if (!existsSync(output.path)) writeFileSync(output.path, output.content, {flag: 'wx', mode: 0o600});
            chmodSync(output.path, 0o600);
        }
        chmodSync(state, 0o600);
        return {status: 'ready', environment: config.environment};
    } finally { unlinkSync(lock); }
}
