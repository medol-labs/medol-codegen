const extensions = new Map([
    ['system-notification', require('./system-notification-projection')]
]);

function projectionExtension(readmodel) {
    const contract = readmodel.projectionExtension;
    if (!contract) return;
    const roles = extensions.get(contract.capability);
    if (!roles || !Object.hasOwn(roles, contract.role)) {
        throw new Error(`Unknown projection extension: ${contract.capability}/${contract.role}`);
    }
    return roles[contract.role];
}

module.exports = {projectionExtension};
