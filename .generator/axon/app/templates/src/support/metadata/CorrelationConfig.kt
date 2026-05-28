package <%= rootPackageName%>.support.metadata

import org.axonframework.commandhandling.CommandMessage
import org.axonframework.messaging.correlation.MessageOriginProvider
import org.axonframework.messaging.correlation.SimpleCorrelationDataProvider
import org.axonframework.messaging.interceptors.CorrelationDataInterceptor
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

const val SESSION_ID_HEADER = "X-Session-Id"

// @Configuration
class CorrelationConfig {

  @Bean
  fun lawFirmCorrelationDataProvider(): SimpleCorrelationDataProvider {
    return SimpleCorrelationDataProvider(SESSION_ID_HEADER) //
  }

  @Bean
  fun messageOriginProvider(): MessageOriginProvider {
    return MessageOriginProvider()
  }

  @Bean
  fun correlationDataInterceptor(): CorrelationDataInterceptor<CommandMessage<Any>> {
    return CorrelationDataInterceptor(messageOriginProvider(), lawFirmCorrelationDataProvider())
  }
}