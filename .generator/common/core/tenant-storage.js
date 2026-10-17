const crypto = require('node:crypto');

function tenantDatabaseName(model) {
    if (model.tenancy === undefined) return undefined;
    if (model.tenancy?.enabled !== true) throw new Error('Invalid tenant storage configuration.');
    const name = `${model.domain ?? model.name ?? 'MedolApplication'}_shared`
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();
    return name.length <= 63 ? name : `${name.slice(0, 52)}_${crypto.createHash('sha1').update(name).digest('hex').slice(0, 10)}`;
}

module.exports = {tenantDatabaseName};
