function serviceCatalogFiles(model) {
    return {
        'operations/model/services.json': JSON.stringify({
            services: [
                ...model.applications.map(app => ({ name: app.name, source: 'generated', kind: app.kind, image: app.imageName })),
                ...model.infrastructure.filter(item => item.enabled !== false).map(item => ({ name: item.name, source: 'external-image', kind: item.type }))
            ]
        }, null, 2) + '\n'
    };
}
module.exports = { serviceCatalogFiles };
