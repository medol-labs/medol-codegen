// Generated runtime schemas for domain value types and commands.
import { z } from "zod";

<% valueTypes.forEach((valueType) => { -%>
export const <%= valueType.name %>Schema = <%- valueType.schema %>;
<% }) -%>
<% if (valueTypes.length) { -%>

<% } -%>
<% commands.forEach((command) => { -%>
export const <%= command.schemaName %> = z.object({
<% command.fields.forEach((field) => { -%>
  <%= field.name %>: <%- field.schema %>,
<% }) -%>
});
export type <%= command.inputTypeName %> = z.infer<typeof <%= command.schemaName %>>;

<% }) -%>
