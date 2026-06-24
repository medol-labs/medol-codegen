package <%= rootPackage %>.support

import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.info.Info
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration
class OpenApiConfig {
    @Bean
    fun medolOpenApi(): OpenAPI = OpenAPI()
        .info(
            Info()
                .title("<%= domain %> API")
                .description("HTTP API generated from the Medol domain model.")
                .version("1.0.0")
        )
}
