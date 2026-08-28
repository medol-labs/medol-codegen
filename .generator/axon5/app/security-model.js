const {kebab} = require('./model-helpers');

function roleCode(actorName) {
    return `ACTOR_${String(actorName ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase()}`;
}

function resourceCode(name) {
    return kebab(name)
        .replace(/-/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

function titleOf(item) {
    return item?.title ?? item?.name ?? '';
}

function uniqBy(items, key) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const value = key(item);
        if (seen.has(value)) continue;
        seen.add(value);
        result.push(item);
    }
    return result;
}

function actorSecurityModel(model) {
    const slices = model.slices ?? [];
    const actorNames = uniqBy(
        [
            ...(model.actors ?? []),
            ...slices.flatMap((slice) => slice.actors ?? [])
        ].filter((actor) => actor?.name),
        (actor) => actor.name
    ).map((actor) => ({
        name: actor.name,
        title: actor.title ?? actor.name,
        roleCode: roleCode(actor.name)
    }));
    const actorsByName = new Map(actorNames.map((actor) => [actor.name, actor]));
    const permissions = new Map();
    const grants = new Map();
    const contextActors = new Map();

    function addPermission(code, description) {
        if (!code) return;
        permissions.set(code, {code, description});
    }

    function grant(actorName, permissionCode) {
        const actor = actorsByName.get(actorName);
        if (!actor || !permissionCode) return;
        addPermission(permissionCode, permissionCode);
        const key = `${actor.roleCode}:${permissionCode}`;
        grants.set(key, {roleCode: actor.roleCode, permissionCode});
    }

    for (const slice of slices) {
        for (const actor of slice.actors ?? []) {
            if (!actor?.name) continue;
            if (!contextActors.has(slice.context)) {
                contextActors.set(slice.context, new Set());
            }
            contextActors.get(slice.context).add(actor.name);

            for (const command of slice.commands ?? []) {
                const commandCode = resourceCode(command.name ?? command.title);
                grant(actor.name, `${commandCode}:execute`);

                for (const readModel of slice.readmodels ?? []) {
                    const readModelCode = resourceCode(titleOf(readModel));
                    grant(actor.name, `${readModelCode}:read`);
                    grant(actor.name, `${readModelCode}:list`);
                    grant(actor.name, `${readModelCode}:${command.name}`);
                }
            }
        }
    }

    for (const slice of slices) {
        for (const readModel of slice.readmodels ?? []) {
            const readModelCode = resourceCode(titleOf(readModel));
            addPermission(`${readModelCode}:read`, `Read ${titleOf(readModel)}`);
            addPermission(`${readModelCode}:list`, `List ${titleOf(readModel)}`);

            const actorNamesForContext = contextActors.get(slice.context) ?? new Set();
            for (const actorName of actorNamesForContext) {
                grant(actorName, `${readModelCode}:read`);
                grant(actorName, `${readModelCode}:list`);
            }
        }
    }

    addPermission('*:*', 'All permissions');

    return {
        actors: actorNames.sort((left, right) => left.roleCode.localeCompare(right.roleCode)),
        permissions: Array.from(permissions.values()).sort((left, right) => left.code.localeCompare(right.code)),
        grants: Array.from(grants.values()).sort((left, right) =>
            left.roleCode.localeCompare(right.roleCode) || left.permissionCode.localeCompare(right.permissionCode)
        )
    };
}

module.exports = {
    actorSecurityModel
};
