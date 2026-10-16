/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const { resolveOperationsModel } = require('../environment-resolver');

function renderNetworkTopology(model, environmentName = 'dev') {
    const resolved = resolveOperationsModel(model, environmentName);
    if (resolved.networkTopology?.sites?.length) return renderPlacedNetworkTopology(resolved);
    return renderFlatNetworkTopology(resolved);
}

function renderFlatNetworkTopology(resolved) {
    const nodes = [];
    const edges = new Set();
    const ids = new Map();
    const addNode = (key, label) => {
        if (!ids.has(key)) {
            const id = `N${ids.size + 1}`;
            ids.set(key, id);
            nodes.push(`  ${id}["${escapeLabel(label)}"]`);
        }
        return ids.get(key);
    };
    const addEdge = (source, target) => edges.add(`  ${source} --> ${target}`);
    const applications = new Map(resolved.applications.map((application) => [application.name, application]));
    const infrastructure = new Map(resolved.infrastructure
        .filter((component) => component.enabled !== false)
        .map((component) => [component.name, component]));

    const client = addNode('client', 'Client / Browser');
    if (resolved.gateway?.enabled) {
        const gateway = addNode('gateway', `${resolved.gateway.name} :${resolved.gateway.servicePort}`);
        addEdge(client, gateway);
        for (const route of resolved.gateway.routes ?? []) {
            const upstream = resolved.gateway.upstreams?.find((candidate) => candidate.id === route.upstreamId);
            const application = upstream && applications.get(upstream.serviceName);
            if (!application) continue;
            addEdge(gateway, addNode(`app:${application.name}`, `${application.name} :${application.servicePort}`));
        }
    } else {
        for (const application of resolved.applications.filter((candidate) => candidate.exposePorts)) {
            addEdge(client, addNode(`app:${application.name}`, `${application.name} :${application.servicePort}`));
        }
    }

    for (const application of resolved.applications) {
        const source = addNode(`app:${application.name}`, `${application.name} :${application.servicePort}`);
        for (const dependency of application.dependencies ?? []) {
            const component = infrastructure.get(dependency);
            if (!component) continue;
            addEdge(source, addNode(`infra:${component.name}`, `${component.name} :${component.servicePort}`));
        }
    }

    return [
        `# ${resolved.title || resolved.name} - Network Topology (${resolved.environment.name})`,
        '',
        'This diagram shows configured entry points, gateway routes, and application service dependencies for this environment. Arrows do not assert observed traffic. Service ports are container/service ports; host exposure and security rules must be checked in deployment manifests.',
        '',
        '```mermaid',
        'flowchart LR',
        ...nodes,
        ...edges,
        '```',
        ''
    ].join('\n');
}

function renderPlacedNetworkTopology(resolved) {
    const topology = resolved.networkTopology;
    const applications = new Map(resolved.applications.map((application) => [application.name, application]));
    const infrastructure = new Map(resolved.infrastructure
        .filter((component) => component.enabled !== false)
        .map((component) => [component.name, component]));
    const siteByApplication = new Map(topology.sites.flatMap((site) =>
        site.applications.map((name) => [name, site.name])));
    const siteByName = new Map(topology.sites.map((site) => [site.name, site]));
    const gatewaySite = topology.sites.find((site) => site.gateway);
    const ids = new Map();
    const node = (key, label) => {
        if (!ids.has(key)) ids.set(key, { id: `N${ids.size + 1}`, label });
        return ids.get(key).id;
    };
    const client = node('client', 'Client / Browser');
    const gateway = resolved.gateway?.enabled && gatewaySite
        ? node('gateway', `${resolved.gateway.name} :${resolved.gateway.servicePort}`)
        : undefined;
    const edges = new Set();
    const notes = new Set();
    const edge = (from, to, label, crossSite) => {
        const caption = label ? `|${escapeEdgeLabel(label)}|` : '';
        edges.add(`  ${from} ${crossSite ? '-.->' : '-->'}${caption} ${to}`);
    };
    const infraNode = (siteName, name) => {
        const component = infrastructure.get(name);
        return component ? node(`infra:${siteName}:${name}`, `${name} :${component.servicePort}`) : undefined;
    };

    if (gateway) edge(client, gateway);
    for (const application of resolved.applications) {
        node(`app:${application.name}`, `${application.name} :${application.servicePort}`);
    }
    for (const site of topology.sites) {
        for (const name of site.infrastructure) infraNode(site.name, name);
    }

    if (gateway) {
        for (const route of resolved.gateway.routes ?? []) {
            const upstream = resolved.gateway.upstreams?.find((candidate) => candidate.id === route.upstreamId);
            if (!upstream || !applications.has(upstream.serviceName)) continue;
            const targetSite = siteByApplication.get(upstream.serviceName);
            const crossSite = gatewaySite.name !== targetSite;
            edge(gateway, ids.get(`app:${upstream.serviceName}`).id,
                crossSite ? 'configured cross-site route' : undefined, crossSite);
            if (crossSite) {
                notes.add(`Gateway route ${route.paths.join(', ')} targets ${upstream.serviceName} in ${targetSite}; a routable upstream is required. A container service name alone will not resolve across sites.`);
            }
        }
    } else {
        for (const application of resolved.applications.filter((candidate) => candidate.exposePorts)) {
            edge(client, ids.get(`app:${application.name}`).id, undefined, true);
        }
    }

    for (const application of resolved.applications) {
        const sourceSite = siteByApplication.get(application.name);
        for (const dependency of application.dependencies ?? []) {
            if (!infrastructure.has(dependency)) continue;
            const local = siteByName.get(sourceSite)?.infrastructure.includes(dependency);
            const targets = local
                ? [sourceSite]
                : topology.sites.filter((site) => site.infrastructure.includes(dependency)).map((site) => site.name);
            if (targets.length !== 1) {
                notes.add(`${application.name} depends on ${dependency}, but its infrastructure instance is ambiguous across sites.`);
                continue;
            }
            edge(ids.get(`app:${application.name}`).id, infraNode(targets[0], dependency),
                local ? undefined : 'cross-site dependency', !local);
        }
    }

    for (const connection of topology.connections ?? []) {
        const sourceSite = siteByApplication.get(connection.from);
        const targetSite = siteByApplication.get(connection.to);
        const label = [connection.protocol, connection.label].filter(Boolean).join(' / ');
        edge(ids.get(`app:${connection.from}`).id, ids.get(`app:${connection.to}`).id,
            label || undefined, sourceSite !== targetSite);
    }

    const siteLines = topology.sites.flatMap((site, index) => [
        `  subgraph Site${index + 1}["${escapeLabel(site.title)}"]`,
        ...(site.gateway && gateway ? [`    ${gateway}["${escapeLabel(ids.get('gateway').label)}"]`] : []),
        ...site.applications.map((name) => {
            const value = ids.get(`app:${name}`);
            return `    ${value.id}["${escapeLabel(value.label)}"]`;
        }),
        ...site.infrastructure.flatMap((name) => {
            const value = ids.get(`infra:${site.name}:${name}`);
            return value ? [`    ${value.id}["${escapeLabel(value.label)}"]`] : [];
        }),
        '  end'
    ]);
    return [
        `# ${resolved.title || resolved.name} - Network Topology (${resolved.environment.name})`,
        '',
        'Sites are configured deployment locations, not inferred physical hosts or subnets. Solid arrows stay within a site; dashed arrows cross site boundaries. Arrows describe configured routes and dependencies, not observed traffic or verified firewall access.',
        '',
        '```mermaid',
        'flowchart LR',
        `  ${client}["Client / Browser"]`,
        ...siteLines,
        ...edges,
        '```',
        '',
        ...(notes.size ? ['## Deployment checks', '', ...[...notes].map((note) => `- ${note}`), ''] : []),
        'This diagram does not assign IP addresses or verify network isolation. Generated single-stack Compose/Kubernetes manifests must be split or configured separately for the stated site placement.',
        ''
    ].join('\n');
}

function escapeEdgeLabel(value) {
    return escapeLabel(value).replace(/\|/g, '/');
}

function escapeLabel(value) {
    return String(value).replace(/[\r\n]+/g, ' ').replace(/"/g, "'");
}

module.exports = {
    renderNetworkTopology
};
