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
    fun medolInternalTokenRestClientCustomizer(properties: MedolSecurityProperties): RestClientCustomizer =
        RestClientCustomizer { builder ->
            val token = properties.internalToken.trim()
            if (token.isNotBlank()) {
                builder.defaultHeader(InternalTokenAuthenticationFilter.INTERNAL_TOKEN_HEADER, token)
            }
        }
}
