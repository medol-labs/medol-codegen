// Generated from config.json by the refine generator.
<% if (resource.canList) { -%>
export * from "<%= resource.listImportPath %>";
<% } -%>
export * from "<%= resource.showImportPath %>";
<% if (resource.createCommand?.requiresPage) { -%>
export * from "<%= resource.createCommand.importPath %>";
<% } -%>
<% resource.routedCommands.forEach((command) => { -%>
export * from "<%= command.importPath %>";
<% }) -%>
