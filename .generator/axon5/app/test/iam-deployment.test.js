const assert = require('node:assert/strict');
const test = require('node:test');
const {applicationWriterMethods} = require('../application-writer');

function generatorForDeployment(currentDeployment) {
    return {
        fullModel: {
            contexts: [{name: 'IdentityAccessManagement'}],
            deployments: [
                {name: 'Support', contexts: [{name: 'DictionaryMaintenance'}, {name: 'IdentityAccessManagement'}]},
                {name: 'RuntimeAgent', contexts: [{name: 'RuntimeAgentOperations'}, {name: 'IdentityAccessManagement'}]},
                {name: 'Platform', contexts: [{name: 'TrainingOrchestration'}]}
            ]
        },
        model: {
            contexts: currentDeployment.contexts
        },
        currentDeployment
    };
}

test('writes embedded IAM artifacts for every deployment that includes IAM', () => {
    assert.equal(
        applicationWriterMethods._shouldWriteIamIntoCurrentModule.call(generatorForDeployment({
            name: 'Support',
            contexts: [{name: 'DictionaryMaintenance'}, {name: 'IdentityAccessManagement'}]
        })),
        true
    );
    assert.equal(
        applicationWriterMethods._shouldWriteIamIntoCurrentModule.call(generatorForDeployment({
            name: 'RuntimeAgent',
            contexts: [{name: 'RuntimeAgentOperations'}, {name: 'IdentityAccessManagement'}]
        })),
        true
    );
    assert.equal(
        applicationWriterMethods._shouldWriteIamIntoCurrentModule.call(generatorForDeployment({
            name: 'Platform',
            contexts: [{name: 'TrainingOrchestration'}]
        })),
        false
    );
});
