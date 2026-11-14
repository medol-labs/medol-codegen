function serviceCatalogFiles(model) {
    const managedEnvironments = model.environments.filter(environment =>
        (environment.observability?.mode ?? model.observability?.mode) === 'managed').map(environment => environment.name);
    return {
        'operations/model/services.json': JSON.stringify({
            services: [
                ...model.applications.map(app => ({ name: app.name, source: 'generated', kind: app.kind, image: app.imageName })),
                ...model.infrastructure.filter(item => item.enabled !== false).map(item => ({ name: item.name, source: 'external-image', kind: item.type })),
                ...(managedEnvironments.length ? [{name: 'medol-observability', source: 'external-image', kind: 'observability', environments: managedEnvironments}] : [])
            ]
        }, null, 2) + '\n'
    };
}
module.exports = { serviceCatalogFiles };
