const assert = require('node:assert/strict');
const test = require('node:test');

const { _test } = require('../index');

const model = {
    domain: 'FederationLearningPlatform',
    frontendApplications: [{
        name: 'FederationLearningConsole',
        title: 'Federation Learning Console'
    }, {
        name: 'FederationLearningParticipantConsole',
        title: 'Federation Learning Participant Console'
    }]
};

test('derives a frontend project root from the selected frontend application', () => {
    assert.equal(
        _test.defaultFrontendOutputRoot(model, 'FederationLearningParticipantConsole'),
        'federation-learning-participant-console'
    );
    assert.equal(
        _test.defaultFrontendOutputRoot(model, 'Federation Learning Participant Console'),
        'federation-learning-participant-console'
    );
});

test('does not override configured output when no frontend application is selected', () => {
    assert.equal(_test.defaultFrontendOutputRoot(model), undefined);
    assert.equal(_test.defaultFrontendOutputRoot(model, '__all__'), undefined);
});

test('expands all frontend resources to every modeled frontend application', () => {
    assert.deepEqual(
        _test.frontendApplicationsForSelection(model, '__all__'),
        ['FederationLearningConsole', 'FederationLearningParticipantConsole']
    );
    assert.deepEqual(
        _test.frontendApplicationsForSelection(model, 'FederationLearningParticipantConsole'),
        ['FederationLearningParticipantConsole']
    );
});

test('keeps legacy generation as one project when no frontend applications are modeled', () => {
    assert.deepEqual(_test.frontendApplicationsForSelection({domain: 'Legacy'}, '__all__'), [undefined]);
});
