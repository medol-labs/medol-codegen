import type {ToolDefinition, SchemaInput} from '@tanstack/ai';
import type {RuntimeCapability} from './types';
export function buildToolDefinitions(capabilities: RuntimeCapability[]): Array<{
  capability?: RuntimeCapability;
  action:'context'|'query'|'open'|'form'|'prepare';
  definition: ToolDefinition<SchemaInput,undefined,string,true> | ToolDefinition<SchemaInput,undefined,string,false>;
}>;
