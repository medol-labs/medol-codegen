package <%= rootPackage %>.shared.application.tenancy

import jakarta.persistence.EntityManagerFactory
import org.hibernate.Session
import org.springframework.aop.framework.ProxyFactory
import org.springframework.aop.support.AopUtils
import org.springframework.beans.factory.BeanFactory
import org.springframework.beans.factory.config.BeanPostProcessor
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.orm.jpa.EntityManagerHolder
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.transaction.support.TransactionTemplate

@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class TenantControlRepository

@Configuration(proxyBeanMethods = false)
class TenantControlPersistence {
    companion object {
        @Bean
        @JvmStatic
        fun tenantControlRepositoryBoundary(): BeanPostProcessor = object : BeanPostProcessor, org.springframework.beans.factory.BeanFactoryAware {
            private lateinit var factory: BeanFactory
            override fun setBeanFactory(beanFactory: BeanFactory) { factory = beanFactory }
            override fun postProcessAfterInitialization(bean: Any, name: String): Any {
                if (!AopUtils.getTargetClass(bean).isAnnotationPresent(TenantControlRepository::class.java) &&
                    org.springframework.util.ClassUtils.getAllInterfacesForClass(bean.javaClass).none { it.isAnnotationPresent(TenantControlRepository::class.java) }) return bean
                val proxy = ProxyFactory(bean)
                proxy.addAdvice(org.aopalliance.intercept.MethodInterceptor { invocation ->
                    val properties = factory.getBean(TenantStorageProperties::class.java)
                    if (properties.mode == TenantStorageMode.SHARED_SCHEMA) return@MethodInterceptor invocation.proceed()
                    val emf = factory.getBean(EntityManagerFactory::class.java)
                    val holder = TransactionSynchronizationManager.getResource(emf) as? EntityManagerHolder
                    TenantScope.control {
                        if (holder == null || holder.entityManager.unwrap(Session::class.java).tenantIdentifierValue == "__medol_control__") invocation.proceed()
                        else TransactionTemplate(factory.getBean(PlatformTransactionManager::class.java)).apply {
                            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
                        }.execute { invocation.proceed() }
                    }
                })
                return proxy.proxy
            }
        }
    }
}
