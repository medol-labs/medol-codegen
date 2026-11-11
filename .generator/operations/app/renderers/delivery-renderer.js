const { readFileSync } = require('node:fs');
const path = require('node:path');

function deliveryFiles(model) {
    return {
        'operations/scripts/pipeline.mjs': readFileSync(path.join(__dirname, '../templates/pipeline.mjs'), 'utf8'),
        'delivery/.gitignore': 'reports/\n*.private.json\n',
        'delivery/generated/services.json': JSON.stringify({
            services: [
                ...model.applications.map(app => ({ name: app.name, source: 'generated', kind: app.kind, image: app.imageName })),
                ...model.infrastructure.filter(item => item.enabled !== false).map(item => ({ name: item.name, source: 'external-image', kind: item.type }))
            ]
        }, null, 2) + '\n',
        'delivery/pipeline.json-example': JSON.stringify({
            services: [], hosts: { local: { transport: 'local' } }, placements: [],
            steps: [
                { id: 'build-images', phase: 'build', command: ['node', 'operations/images/images.mjs', 'build'] },
                { id: 'publish-images', phase: 'publish', command: ['node', 'operations/images/images.mjs', 'push'] }
            ]
        }, null, 2) + '\n'
    };
}
module.exports = { deliveryFiles };
