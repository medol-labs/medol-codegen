// Generated runtime schemas for domain value types and commands.
import { z } from "zod";

const dateTimeLocalSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}, z.string().datetime({ local: true }));

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
