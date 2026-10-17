package <%= rootPackage %>.shared.security

import org.springframework.boot.autoconfigure.condition.ConditionalOnClass
import org.springframework.boot.web.client.RestClientCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient

@Configuration
@ConditionalOnClass(RestClient::class)
class MedolRestClientSecurityConfiguration {
    @Bean
    fun medolInternalTokenRestClientCustomizer(properties: MedolSecurityProperties<% if (typeof tenancyEnabled !== 'undefined' && tenancyEnabled) { %>, relay: <%= rootPackage %>.shared.application.tenancy.TenantRelay<% } %>): RestClientCustomizer =
        RestClientCustomizer { builder ->
            val token = properties.internalToken.trim()
            if (token.isNotBlank()) {
                builder.defaultHeader(InternalTokenAuthenticationFilter.INTERNAL_TOKEN_HEADER, token)
            }
<% if (typeof tenancyEnabled !== 'undefined' && tenancyEnabled) { %>
            builder.requestInterceptor { request, body, execution ->
                <%= rootPackage %>.shared.application.tenancy.TenantScope.current()?.let { identity ->
                    request.headers.set(<%= rootPackage %>.shared.application.tenancy.TenantRelay.HEADER, relay.issue(identity))
                }
                execution.execute(request, body)
            }
<% } %>
        }

    @Bean
    fun medolInternalRestClient(
        restClientBuilder: RestClient.Builder,
        properties: MedolSecurityProperties<% if (typeof tenancyEnabled !== 'undefined' && tenancyEnabled) { %>,
        relay: <%= rootPackage %>.shared.application.tenancy.TenantRelay<% } %>
    ): RestClient {
        val token = properties.internalToken.trim()
        if (token.isNotBlank()) {
            restClientBuilder.defaultHeader(InternalTokenAuthenticationFilter.INTERNAL_TOKEN_HEADER, token)
        }
<% if (typeof tenancyEnabled !== 'undefined' && tenancyEnabled) { %>
        restClientBuilder.requestInterceptor { request, body, execution ->
            <%= rootPackage %>.shared.application.tenancy.TenantScope.current()?.let { identity ->
                request.headers.set(<%= rootPackage %>.shared.application.tenancy.TenantRelay.HEADER, relay.issue(identity))
            }
            execution.execute(request, body)
        }
<% } %>
        return restClientBuilder.build()
    }
}
