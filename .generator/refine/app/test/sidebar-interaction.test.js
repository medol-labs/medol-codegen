const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const templateRoot = path.resolve(__dirname, '../templates/root/src');

test('generated sidebar keeps deep active items reachable', () => {
    const sidebar = fs.readFileSync(
        path.join(templateRoot, 'components/refine-ui/layout/sidebar.tsx'),
        'utf8',
    );

    assert.match(sidebar, /scroll-pb-8/);
    assert.match(sidebar, /data-sidebar-active/);
    assert.match(sidebar, /scrollIntoView\(\{ block: "nearest"/);
    assert.match(sidebar, /menuItemContainsKey/);
    assert.match(sidebar, /open=\{isOpen\}/);
});

test('generated sidebar uses a subdued scrollbar', () => {
    const styles = fs.readFileSync(path.join(templateRoot, 'App.css'), 'utf8');

    assert.match(styles, /\[data-sidebar="content"\]::\-webkit-scrollbar/);
    assert.match(styles, /scrollbar-width: thin/);
    assert.match(styles, /overscroll-behavior: contain/);
});
