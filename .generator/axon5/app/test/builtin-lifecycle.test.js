const assert = require('node:assert/strict');
const test = require('node:test');
const {commandWriterMethods} = require('../command-writer');
const {readModelWriterMethods} = require('../read-model-writer');

for (const kind of ['Import', 'Export']) {
    test(`data ${kind.toLowerCase()} ports reference the modeled command slices`, () => {
        const writes = new Map();
        const commands = [`RequestData${kind}`, `MarkData${kind}Processing`, `CompleteData${kind}`, `FailData${kind}`];
        const model = {rootPackage: 'example', slices: [
            {name: `Data${kind}Job`, context: 'DataExchange', commands: [], processors: []},
            ...commands.map((name, index) => ({name: `Stage${index}`, title: `Stage ${index}`, context: 'DataExchange', commands: [{name}], processors: []}))
        ]};
        const writer = {...commandWriterMethods, ...readModelWriterMethods, model,
            fs: {write: (path, content) => writes.set(path, content)}, _kotlinPath: path => path};
        writer[`_writeData${kind}JobAxonPorts`]();
        const output = writes.get(`dataexchange/data${kind.toLowerCase()}job/Data${kind}JobPorts.kt`);
        commands.forEach((name, index) => assert(output.includes(`import example.dataexchange.stage${index}.${name}Command`)));
    });
}

const {stateWriterMethods} = require('../state-writer');
const {transitionForCommand} = require('../model-helpers');

test('event sourcing changes lifecycle only for an explicitly modeled outcome', () => {
    const events = [
        {id: 'started', name: 'WorkStarted', title: 'Work Started', fields: []},
        {id: 'viewed', name: 'ReadyStatusViewed', title: 'Ready Status Viewed', fields: []},
        {id: 'failure', name: 'WorkFailed', title: 'Work Failed', fields: []}
    ];
    const model = {rootPackage: 'example', concepts: [{name: 'Work', context: 'Jobs', states: ['Ready', 'Failed']}],
        transitions: [{owner: {name: 'Work'}, context: 'Jobs', event: {id: 'started'}, to: 'Ready'}]};
    const writes = new Map();
    const writer = {...stateWriterMethods, model, fs: {write: (path, text) => writes.set(path, text)},
        _kotlinPath: path => path, _eventPackage: () => 'example.jobs.events'};
    writer._writeState('example.jobs.work', 'jobs', 'work', {name: 'Work', context: 'Jobs', concepts: ['Work']}, {fields: []}, events);
    const code = writes.get('jobs/work/WorkState.kt');
    const handlers = code.split('@EventSourcingHandler').slice(1);
    assert.match(handlers[0], /currentState = WorkStateEnum.Ready/);
    assert.doesNotMatch(handlers[1], /currentState =/);
    assert.doesNotMatch(handlers[2], /currentState =/);
});

test('same-named commands in different contexts cannot borrow lifecycle guards', () => {
    const first = {command: {id: 'a', name: 'Update'}, context: 'One', from: 'Active'};
    const second = {command: {id: 'b', name: 'Update'}, context: 'Two', from: 'Ready'};
    const model = {transitions: [first, second]};
    assert.equal(transitionForCommand(model, {id: 'b', name: 'Update'}), second);
    assert.equal(transitionForCommand(model, {id: 'c', name: 'Update'}), undefined);
    assert.equal(transitionForCommand(model, {name: 'Update', modelContext: 'Two'}), second);
    assert.equal(transitionForCommand(model, {name: 'Update'}), undefined);
});
