import type {FieldValues, UseFormReturn, Path, PathValue} from 'react-hook-form';
import type {z} from 'zod';
import {prepareCommand} from '../platform/composition/command-execution.ts';
import type {FrontendComposition, FormBehaviorExtension} from '../platform/composition';
import type {FormSession} from './store';

export type AgentFormOptions<T extends FieldValues> = {
  capability: string;
  writableFields: string[];
  form: Pick<UseFormReturn<T>, 'getValues' | 'setValue' | 'watch' | 'trigger'>;
  schema: z.AnyZodObject;
  defaultValues: Partial<T>;
  composition: FrontendComposition;
  behaviorTarget: string;
  submit: (values: T) => Promise<unknown>;
};
export function createFormSession<T extends FieldValues>(options: () => AgentFormOptions<T>) {
    let undo: {before: Record<string, unknown>; revision: number} | undefined;
    const session: FormSession = {
      instance: crypto.randomUUID(), revision:0,
      inspect: () => Object.fromEntries(options().writableFields.map(name => [name, structuredClone(options().form.getValues()[name])])),
      fill: (values, revision) => {
        if (revision !== session.revision) throw new Error('Form changed; inspect it again before filling');
        const {schema, form, writableFields} = options();
        const names = Object.keys(values);
        if (names.some(name => !writableFields.includes(name))) throw new Error('Field is not writable by this assistant');
        const mask = Object.fromEntries(names.map(name => [name,true as const]));
        const validated = schema.pick(mask).strict().parse(values);
        const before = Object.fromEntries(names.map(name=>[name,structuredClone(form.getValues()[name])]));
        for (const name of names) form.setValue(name as Path<T>, validated[name] as PathValue<T,Path<T>>, {shouldDirty:true,shouldValidate:true});
        undo = {before,revision:session.revision};
        return {revision:session.revision,values:session.inspect()};
      },
      undo: revision => {
        if (!undo || revision !== session.revision || undo.revision !== session.revision) throw new Error('Cannot undo after another edit');
        const before = undo.before; undo = undefined;
        for (const [name,value] of Object.entries(before)) options().form.setValue(name as Path<T>,value as PathValue<T,Path<T>>,{shouldDirty:true,shouldValidate:true});
        return {revision:session.revision,values:session.inspect()};
      },
      validate: () => options().form.trigger(),
      prepare: async () => {
        const {form,schema,defaultValues,composition,behaviorTarget,submit} = options();
        if (!await form.trigger()) throw new Error('Complete the invalid fields before submitting');
        const values = schema.parse({...defaultValues,...form.getValues()}) as T;
        const behavior = composition.overrides.find(item=>item.type==='behavior' && item.target===behaviorTarget)?.implementation as FormBehaviorExtension<T> | undefined;
        return prepareCommand(values,behavior,submit);
      },
    };
    const subscription = options().form.watch(()=>{session.revision++;});
    return {session,dispose:()=>subscription.unsubscribe()};
}
