package <%= _packageName%>.<%=_slice%>.internal

import <%= _packageName%>.<%=_slice%>.<%=_name%>
import org.springframework.stereotype.Component
import <%= _packageName%>.<%=_slice%>.internal.<%=_name%>Repository
import org.axonframework.queryhandling.QueryHandler
import <%= _packageName%>.<%=_slice%>.<%= _name%>Query
import <%= _packageName%>.<%=_slice%>.<%= _name%>Key
<%= _typeImports %>

/*
Boardlink: <%- link%>
*/
@Component
class <%=_name%>QueryHandler(private val repository: <%=_name%>Repository) {

    @QueryHandler
    fun handleQuery(query: <%=_name%>Query): <%=_name%>? {

        if (!repository.existsById(<%=_name%>Key(<%-_fields%>))) {
            <% if (_listElement) { %>
            return <%=_name%>(emptyList())
            <% } else { %>
            return null
            <% } %>
        }
        <% if (_listElement) { %>
        return <%=_name%>(listOf(repository.findById(<%=_name%>Key(<%-_fields%>)).get()))
        <% } else { %>
        return <%=_name%>(repository.findById(<%=_name%>Key(<%-_fields%>)).get())
        <% } %>
    }

}
