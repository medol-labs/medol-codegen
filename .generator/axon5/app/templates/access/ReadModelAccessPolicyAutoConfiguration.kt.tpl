package __ROOT__.shared.application.access

import __ROOT__.shared.security.CurrentUserProvider
import org.springframework.beans.factory.ObjectProvider
import org.springframework.boot.autoconfigure.AutoConfiguration
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.context.annotation.Bean

@AutoConfiguration
class ReadModelAccessPolicyAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean(BackgroundDataAccess::class)
    fun backgroundDataAccess(users: CurrentUserProvider, resolvers: ObjectProvider<BackgroundAccessActorResolver>): BackgroundDataAccess =
        BackgroundDataAccess(users, resolvers)

    @Bean
    @ConditionalOnMissingBean(IdentityAccessAttributes::class)
    fun identityAccessAttributes(): IdentityAccessAttributes = CurrentUserAccessAttributes()

    @Bean
    @ConditionalOnMissingBean(AuthorizationScopeResolver::class)
    fun authorizationScopeResolver(attributes: IdentityAccessAttributes, sources: ObjectProvider<BusinessAccessScopeSource>): AuthorizationScopeResolver =
        DefaultAuthorizationScopeResolver(attributes, sources)

    @Bean
    @ConditionalOnMissingBean(ReadModelAccessPolicyFilter::class)
    fun readModelAccessPolicyFilter(users: CurrentUserProvider, resolver: AuthorizationScopeResolver): ReadModelAccessPolicyFilter =
        ScopedReadModelAccessPolicyFilter(users, resolver)
}
