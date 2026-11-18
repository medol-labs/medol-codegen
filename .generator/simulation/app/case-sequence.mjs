import {resolveInputs} from './flow-values.mjs';

// A sequence owns ordering and bindings; the host supplies transport and seed data.
export async function runCaseSequence(sequence, context, execute, adapters = {}) {
  if (!Array.isArray(sequence) || !sequence.length) throw new Error('Expected a non-empty case sequence');
  const ids = new Set();
  for (const step of sequence) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(step.case || '') || !step.endpoint || ids.has(step.case)) throw new Error('Invalid or duplicate case reference');
    ids.add(step.case);
    if (step.onResult && (!Object.hasOwn(adapters, step.onResult) || typeof adapters[step.onResult] !== 'function')) throw new Error('Unknown result adapter: ' + step.onResult);
  }
  const outputs = Object.create(null);
  for (const step of sequence) {
    const scope = {...context, outputs};
    if (step.when !== undefined && !resolveInputs(step.when, scope)) continue;
    outputs[step.case] = await execute(step.case, step.endpoint, resolveInputs(step.inputs, scope));
    if (step.onResult && outputs[step.case] !== undefined) await adapters[step.onResult](outputs[step.case]);
  }
  return outputs;
}
