package <%= rootPackage %>.shared.security

import feign.RequestInterceptor
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration
@ConditionalOnClass(RequestInterceptor::class)
class MedolFeignSecurityConfiguration {
    @Bean
    fun medolInternalTokenRequestInterceptor(properties: MedolSecurityProperties): RequestInterceptor =
        RequestInterceptor { template ->
            val token = properties.internalToken.trim()
            if (token.isNotBlank()) {
                template.header(InternalTokenAuthenticationFilter.INTERNAL_TOKEN_HEADER, token)
            }
        }
}
