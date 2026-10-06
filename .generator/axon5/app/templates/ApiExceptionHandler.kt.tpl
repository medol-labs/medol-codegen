package <%= rootPackage %>.shared.infrastructure.web

import org.springframework.http.HttpStatus
import org.springframework.http.ProblemDetail
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.server.ResponseStatusException
import <%= rootPackage %>.shared.domain.CommandRejectedException
import java.util.concurrent.CompletionException

@RestControllerAdvice
class ApiExceptionHandler {
    @ExceptionHandler(ResponseStatusException::class)
    fun responseStatus(exception: ResponseStatusException): ProblemDetail =
        ProblemDetail.forStatusAndDetail(
            exception.statusCode,
            exception.reason ?: exception.message ?: "Request failed."
        ).apply {
            title = exception.statusCode.toString()
            setProperty("code", "HTTP_${exception.statusCode.value()}")
            setProperty("i18nKey", "errors.http.${exception.statusCode.value()}")
            setProperty("args", mapOf("status" to exception.statusCode.value()))
        }

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun validationError(exception: MethodArgumentNotValidException): ProblemDetail =
        ProblemDetail.forStatusAndDetail(
            HttpStatus.BAD_REQUEST,
            exception.bindingResult.fieldErrors.joinToString("; ") {
                "${it.field}: ${it.defaultMessage ?: "invalid value"}"
            }
        ).apply {
            title = "Validation failed"
            setProperty("code", "VALIDATION_FAILED")
            setProperty("i18nKey", "errors.validationFailed")
            setProperty(
                "args",
                mapOf(
                    "fields" to exception.bindingResult.fieldErrors.joinToString(", ") { it.field }
                )
            )
        }

    @ExceptionHandler(IllegalArgumentException::class)
    fun rejectedCommand(exception: IllegalArgumentException): ProblemDetail {
        if (exception is CommandRejectedException) {
            return ProblemDetail.forStatusAndDetail(
                HttpStatus.UNPROCESSABLE_ENTITY,
                exception.message ?: "The command was rejected."
            ).apply {
                title = "Command rejected"
                setProperty("code", exception.code)
                setProperty("i18nKey", exception.i18nKey)
                setProperty("args", exception.args)
            }
        }
        return ProblemDetail.forStatusAndDetail(
            HttpStatus.UNPROCESSABLE_ENTITY,
            exception.message ?: "The command was rejected."
        ).apply {
            title = "Command rejected"
            setProperty("code", "COMMAND_REJECTED")
            setProperty("i18nKey", "errors.commandRejected")
            setProperty("args", emptyMap<String, Any?>())
        }
    }

    @ExceptionHandler(CompletionException::class)
    fun commandFailure(exception: CompletionException): ProblemDetail {
        val cause = exception.cause ?: exception
        if (cause is CommandRejectedException) {
            return rejectedCommand(cause)
        }
        return ProblemDetail.forStatusAndDetail(
            HttpStatus.UNPROCESSABLE_ENTITY,
            cause.message ?: "Command execution failed."
        ).apply {
            title = "Command failed"
            setProperty("code", "COMMAND_FAILED")
            setProperty("i18nKey", "errors.commandFailed")
            setProperty("args", emptyMap<String, Any?>())
        }
    }
}
