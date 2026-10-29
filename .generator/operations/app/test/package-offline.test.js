const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');

test('offline packaging renders public manifests and checksums without building images', async () => {
    const {packageOffline, packageOfflineAll} = await import(pathToFileURL(path.resolve(__dirname, '../templates/package-offline.mjs')));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'package-test-'));
    try {
        fs.mkdirSync(path.join(root, 'operations/k3s/base'), {recursive: true});
        fs.mkdirSync(path.join(root, 'operations/k3s/environments/test'), {recursive: true});
        fs.mkdirSync(path.join(root, 'operations/k3s/environments/test-registry'), {recursive: true});
        fs.writeFileSync(path.join(root, 'operations/k3s/environments/test/kustomization.yaml'), 'resources: []\n');
        fs.writeFileSync(path.join(root, 'operations/k3s/environments/test-registry/kustomization.yaml'), 'resources: []\n');
        for (const environment of ['test', 'test-registry']) {
            for (const site of ['platform-site', 'participant-site']) {
                const siteRoot = path.join(root, 'operations/k3s/environments', environment, 'sites', site);
                fs.mkdirSync(siteRoot, {recursive: true});
                fs.writeFileSync(path.join(siteRoot, 'kustomization.yaml'), 'resources: []\n');
            }
        }
        fs.mkdirSync(path.join(root, 'operations/model/test'), {recursive: true});
        fs.writeFileSync(path.join(root, 'operations/model/test/operations-model.json'), JSON.stringify({
            applications: [{name: 'platform'}, {name: 'participant'}],
            networkTopology: {sites: [
                {name: 'platform-site', applications: ['platform'], infrastructure: [], gateway: true},
                {name: 'participant-site', applications: ['participant'], infrastructure: [], gateway: false}
            ]}
        }));
        fs.writeFileSync(path.join(root, 'operations/k3s/environments/test/secrets.example.yaml'), 'kind: Secret\nstringData:\n  password: change-me\n');
        fs.writeFileSync(path.join(root, 'operations/k3s/environments/test/sites/platform-site/secrets.example.yaml'), 'kind: Secret\nmetadata:\n  name: platform-secret\n');
        fs.writeFileSync(path.join(root, 'operations/k3s/environments/test/sites/participant-site/secrets.example.yaml'), 'kind: Secret\nmetadata:\n  name: participant-secret\n');
        fs.writeFileSync(path.join(root, 'operations/k3s/environments/test/secrets.test.yaml'), 'private');
        const archive = path.join(root, 'images.tar');
        fs.writeFileSync(archive, 'image archive fixture');
        const output = await packageOffline({root, environment: 'test', archives: [archive]}, (directory) => {
            assert(!fs.existsSync(path.join(directory, 'environments/test/secrets.test.yaml')));
            return 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: test\n';
        });
        assert(fs.existsSync(path.join(output, 'images/images.tar')));
        assert(fs.existsSync(path.join(output, 'config/secrets.example.yaml')));
        assert.match(fs.readFileSync(path.join(output, 'SHA256SUMS'), 'utf8'), /[a-f0-9]{64}  manifests\/deployment.yaml/);
        assert.match(fs.readFileSync(path.join(output, 'SHA256SUMS'), 'utf8'), /[a-f0-9]{64}  config\/secrets\.example\.yaml/);
        await assert.rejects(packageOffline({root, environment: 'test', archives: [archive]}), /Output exists/);
        await assert.rejects(packageOffline({root, environment: 'local', archives: [archive]}), /non-local/);
        await assert.rejects(packageOffline({root, environment: 'test', archives: [archive], output: path.join(root, 'rejected')}, () => 'kind: Secret\n'), /contain a Secret/);
        const participantOutput = await packageOffline({root, environment: 'test', site: 'participant-site', archives: [archive]}, (directory) => {
            const deployment = JSON.parse(fs.readFileSync(path.join(directory, 'kustomization.yaml'), 'utf8'));
            assert.deepEqual(deployment.resources, ['environments/test/sites/participant-site']);
            assert.equal(fs.readdirSync(directory).some((name) => name.startsWith('site-delete-')), false);
            return 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: participant\n';
        });
        assert.match(fs.readFileSync(path.join(participantOutput, 'README.txt'), 'utf8'), /Deployment site: participant-site/);
        assert.match(fs.readFileSync(path.join(participantOutput, 'config/secrets.example.yaml'), 'utf8'), /participant-secret/);
        assert.doesNotMatch(fs.readFileSync(path.join(participantOutput, 'config/secrets.example.yaml'), 'utf8'), /platform-secret/);
        await assert.rejects(packageOffline({root, environment: 'test', site: 'missing', archives: [archive], output: path.join(root, 'missing')}), /Unknown deployment site/);
        const platformArchive = path.join(root, 'platform-site-images.tar');
        const participantArchive = path.join(root, 'participant-site-images.tar');
        fs.writeFileSync(platformArchive, 'platform');
        fs.writeFileSync(participantArchive, 'participant');
        const outputs = await packageOfflineAll({
            root, environment: 'test', archives: [platformArchive, participantArchive], output: path.join(root, 'all-sites')
        }, () => 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: site\n');
        assert.equal(outputs.length, 2);
        assert(fs.existsSync(path.join(root, 'all-sites/platform-site/README.txt')));
        assert(fs.existsSync(path.join(root, 'all-sites/participant-site/README.txt')));
        const registryOutputs = await packageOfflineAll({
            root, environment: 'test', imageSource: 'registry', archives: [], output: path.join(root, 'registry-sites')
        }, (directory) => {
            assert(fs.existsSync(path.join(directory, 'environments/test-registry')));
            const deployment = JSON.parse(fs.readFileSync(path.join(directory, 'kustomization.yaml'), 'utf8'));
            assert.match(deployment.resources[0], /^environments\/test-registry\/sites\//);
            return 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: registry-site\n';
        });
        assert.equal(registryOutputs.length, 2);
        assert(!fs.existsSync(path.join(root, 'registry-sites/platform-site/images')));
        assert.match(fs.readFileSync(path.join(root, 'registry-sites/platform-site/README.txt'), 'utf8'), /Image source: registry/);
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});
