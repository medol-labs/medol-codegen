export type CommandBehavior<T> = {
  beforeSubmit?: (value: T) => Promise<T | void> | T | void;
  afterSubmit?: (value: T, result: unknown) => Promise<void> | void;
  validate?: (value: T) => Promise<Record<string, string> | void> | Record<string, string> | void;
  mapCommandPayload?: (value: T) => unknown;
};

/** Runs exactly once before approval; execute never transforms the approved payload again. */
export async function prepareCommand<T>(
  values: T,
  behavior: CommandBehavior<T> | undefined,
  submit: (payload: T) => Promise<unknown>,
) {
  const input = structuredClone(values);
  const errors = await behavior?.validate?.(input);
  if (errors && Object.keys(errors).length) {
    throw new Error(Object.entries(errors).map(([field, message]) => `${field}: ${message}`).join('; '));
  }
  const next = structuredClone((await behavior?.beforeSubmit?.(input)) ?? input);
  const final = structuredClone(behavior?.mapCommandPayload ? await behavior.mapCommandPayload(next) : next) as T;
  let consumed = false;
  return {
    // Display snapshot is detached from the executor's private final payload.
    payload: structuredClone(final),
    async execute() {
      if (consumed) throw new Error('Prepared command already consumed');
      consumed = true;
      const result = await submit(structuredClone(final));
      try {
        await behavior?.afterSubmit?.(next, result);
      } catch (cause) {
        throw Object.assign(new Error('Command accepted, but afterSubmit failed', {cause}), {commandAccepted: true, result});
      }
      return result;
    },
  };
}
