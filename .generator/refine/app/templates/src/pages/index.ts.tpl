// Generated from config.json by the refine generator.
export * from "./list";
export * from "./show";
<% if (resource.createCommand) { -%>
export * from "./create";
<% } -%>
<% if (resource.editCommand) { -%>
export * from "./edit";
<% } -%>
<% resource.routedCommands.forEach((command) => { -%>
export * from "./<%= command.file %>";
<% }) -%>
