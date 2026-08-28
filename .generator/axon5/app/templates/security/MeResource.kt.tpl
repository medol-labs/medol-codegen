package <%= rootPackage %>.shared.security

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api")
class MeResource(
    private val currentUserProvider: CurrentUserProvider,
) {
    @GetMapping("/me")
    fun me(): CurrentUser = currentUserProvider.currentUser()
}
