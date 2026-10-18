package <%= rootPackage %>.tenancy

import org.springframework.context.ApplicationContextInitializer
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource

class TenantOperationsControlInitializer : ApplicationContextInitializer<ConfigurableApplicationContext> {
    override fun initialize(context: ConfigurableApplicationContext) {
        val environment = context.environment
        val schema = environment.getRequiredProperty("medol.tenancy.control-schema")
        check(schema.matches(Regex("[a-z][a-z0-9_]{0,62}")))
        val source = DriverManagerDataSource(
            environment.getRequiredProperty("spring.datasource.url"),
            environment.getRequiredProperty("spring.datasource.username"),
            environment.getRequiredProperty("spring.datasource.password")
        )
        // Operations requires the control schema before Hikari establishes connections.
        JdbcTemplate(source).execute("CREATE SCHEMA IF NOT EXISTS \"$schema\"")
    }
}
