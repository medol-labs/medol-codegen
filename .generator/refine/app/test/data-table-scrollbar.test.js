const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const templateRoot = path.resolve(__dirname, '../templates/root/src');

test('generated data tables keep pagination from creating a horizontal scrollbar', () => {
    const pagination = fs.readFileSync(
        path.join(templateRoot, 'components/data-table/data-table-pagination.tsx'),
        'utf8',
    );
    const dataTable = fs.readFileSync(
        path.join(templateRoot, 'components/data-table/data-table.tsx'),
        'utf8',
    );

    assert.match(pagination, /overflow-visible/);
    assert.doesNotMatch(pagination, /overflow-auto/);
    assert.match(dataTable, /min-w-0 flex-col/);
    assert.doesNotMatch(dataTable, /flex-col gap-2\.5 overflow-auto/);
});

test('generated table container uses a subdued horizontal scrollbar', () => {
    const styles = fs.readFileSync(path.join(templateRoot, 'App.css'), 'utf8');

    assert.match(styles, /\[data-slot="table-container"\]/);
    assert.match(styles, /scrollbar-width: thin/);
    assert.match(styles, /background-clip: content-box/);
});
