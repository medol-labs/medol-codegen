package <%= rootPackage %>

import org.axonframework.extension.springboot.autoconfig.JpaEventStoreAutoConfiguration
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationPropertiesScan
import org.springframework.boot.runApplication
import org.springframework.cloud.openfeign.EnableFeignClients
import org.springframework.data.web.config.EnableSpringDataWebSupport

@SpringBootApplication(exclude = [JpaEventStoreAutoConfiguration::class])
@ConfigurationPropertiesScan
@EnableFeignClients
@EnableSpringDataWebSupport(pageSerializationMode = EnableSpringDataWebSupport.PageSerializationMode.VIA_DTO)
class <%= applicationClass %>

fun main(args: Array<String>) {
    runApplication<<%= applicationClass %>>(*args)
}
