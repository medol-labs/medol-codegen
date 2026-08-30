package <%= rootPackage %>.shared.security

import org.springframework.security.oauth2.jwt.Jwt

interface CurrentUserJwtResolver {
    fun resolve(jwt: Jwt, fallback: CurrentUser): CurrentUser
}
