package <%= packageName %>

<% if (imports) { -%>
<%= imports %>

<% } -%>
@JvmInline
value class <%= name %>(val value: <%= baseType %>) {
<% if (validations) { -%>
    init {
<%- validations %>
    }

<% } -%>
    override fun toString(): String = value.toString()
}
