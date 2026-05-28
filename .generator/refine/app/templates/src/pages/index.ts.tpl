// Generated from config.json by the refine generator.
<% if (resource.canList) { -%>
export * from "./list";
<% } -%>
export * from "./show";
<% if (resource.createCommand) { -%>
export * from "./<%= resource.createCommand.file %>";
<% } -%>
<% if (resource.editCommand) { -%>
export * from "./edit";
<% } -%>
<% resource.routedCommands.forEach((command) => { -%>
export * from "./<%= command.file %>";
<% }) -%>
