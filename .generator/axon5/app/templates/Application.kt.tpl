package <%= rootPackage %>

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class <%= applicationClass %>

fun main(args: Array<String>) {
    runApplication<<%= applicationClass %>>(*args)
}
