package <%= rootPackage %>.shared.security

interface CurrentUserProvider {
    fun currentUser(): CurrentUser
}
