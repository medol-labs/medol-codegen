package <%= rootPackage %>.shared.domain

class CommandRejectedException(
    val code: String,
    val i18nKey: String,
    val args: Map<String, Any?> = emptyMap(),
    message: String
) : IllegalArgumentException(message)
