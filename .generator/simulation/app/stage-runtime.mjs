export function validateStages(scenario, adapter) {
  if (!Array.isArray(scenario.steps) || !scenario.steps.length) throw new Error('Scenario requires steps');
  const ids = new Set();
  for (const step of scenario.steps) {
    if (!step.id || ids.has(step.id) || !Object.hasOwn(adapter, step.action) || typeof adapter[step.action] !== 'function') throw new Error(`Invalid step: ${step.id}`);
    if (['cleanup', 'snapshot'].includes(step.action)) throw new Error(`Reserved action: ${step.action}`);
    const count = step.repeat ? adapter[step.repeat] : 1;
    if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid repetition: ${step.id}`);
    ids.add(step.id);
  }
}

export async function executeSteps(scenario, adapter, record = () => {}) {
  try {
    validateStages(scenario, adapter);
    for (const step of scenario.steps) {
      const count = step.repeat ? adapter[step.repeat] : 1;
      for (let index = 1; index <= count; index++) {
        const id = step.repeat ? `${step.id}-${index}` : step.id;
        record({ id, status: 'running' });
        try {
          await adapter[step.action](index);
          record({ id, status: 'passed', snapshot: adapter.snapshot?.() });
        } catch (error) {
          record({ id, status: 'failed' });
          throw error;
        }
      }
    }
  } finally { await adapter.cleanup?.(); }
}
