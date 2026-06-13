// Generated domain value types. Do not edit manually.
<% valueTypes.forEach((valueType) => { -%>
export type <%= valueType.name %> = <%= valueType.tsBaseType %>;
<% }) -%>
