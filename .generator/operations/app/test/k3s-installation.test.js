const assert = require('node:assert/strict');
const test = require('node:test');
const {spawnSync} = require('node:child_process');
const {buildOperationsModel} = require('../operations-model-builder');
const {generateOperationsFiles} = require('../operations-generator');

test('generates generic native K3s installation instructions for each environment', () => {
    const model = buildOperationsModel({domain: 'Example', deployments: [{name: 'Backend', contexts: []}]});
    for (const environment of ['local', 'test', 'prod']) {
        const files = generateOperationsFiles(model, {target: 'k3s', environment});
        const manual = files['operations/k3s/INSTALLATION.md'];
        assert.match(manual, /v1\.33\.5\+k3s1/);
        assert.match(manual, /INSTALL_K3S_SKIP_DOWNLOAD=true/);
        assert.match(manual, /sh \.\/install\.sh agent/);
        assert.match(manual, /systemd\.unified_cgroup_hierarchy=1/);
        assert.doesNotMatch(manual, /Federation Learning|OFFLINE-DEPLOYMENT\.md|SINGLE-NODE\.md|192\.168\./);
        assert.match(files['operations/k3s/README.md'], /\[K3s installation\]\(INSTALLATION\.md\)/);
        for (const block of manual.matchAll(/```bash\n([\s\S]*?)```/g)) {
            const check = spawnSync('bash', ['-n'], {input: block[1], encoding: 'utf8'});
            assert.equal(check.status, 0, check.stderr);
        }
    }
    assert.equal(generateOperationsFiles(model, {target: 'kubernetes'})['operations/k3s/INSTALLATION.md'], undefined);
});
