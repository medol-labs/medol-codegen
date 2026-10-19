const test = require('node:test');
const assert = require('node:assert/strict');
const {renderStateGuard, transitionUsesConceptState} = require('../model-helpers');

test('multi-source lifecycle guards reject every state outside the modeled set', () => {
    const model = {rootPackage: 'example', concepts: [{name: 'Device', context: 'Equipment', states: ['Registered', 'Available', 'Expired', 'Retired']}]};
    const transition = {context: 'Equipment', owner: {type: 'concept', name: 'Device'}, command: {name: 'Calibrate'}, from: 'Registered', fromStates: ['Registered', 'Available', 'Expired']};
    const code = renderStateGuard(model, transition);
    assert.match(code, /state.currentState !in setOf\(DeviceStateEnum.Registered, DeviceStateEnum.Available, DeviceStateEnum.Expired\)/);
    assert.match(code, /expectedState.*Registered, Available, Expired/);
    assert.doesNotMatch(code, /DeviceStateEnum.Retired/);
    assert.equal(renderStateGuard(model, {...transition, from: undefined}), code);
    assert.equal(transitionUsesConceptState(model, {...transition, fromStates: ['Registered', 'Unknown']}), false);
    assert.match(renderStateGuard(model, {...transition, fromStates: undefined}), /state.currentState != DeviceStateEnum.Registered/);
});
