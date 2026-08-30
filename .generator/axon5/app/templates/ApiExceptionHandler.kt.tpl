package <%= rootPackage %>.shared.infrastructure.web

import org.springframework.http.HttpStatus
import org.springframework.http.ProblemDetail
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.server.ResponseStatusException
import java.util.concurrent.CompletionException

@RestControllerAdvice
class ApiExceptionHandler {
    @ExceptionHandler(ResponseStatusException::class)
    fun responseStatus(exception: ResponseStatusException): ProblemDetail =
        ProblemDetail.forStatusAndDetail(
            exception.statusCode,
            exception.reason ?: exception.message ?: "Request failed."
        ).apply { title = exception.statusCode.toString() }

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun validationError(exception: MethodArgumentNotValidException): ProblemDetail =
        ProblemDetail.forStatusAndDetail(
            HttpStatus.BAD_REQUEST,
            exception.bindingResult.fieldErrors.joinToString("; ") {
                "${it.field}: ${it.defaultMessage ?: "invalid value"}"
            }
        ).apply { title = "Validation failed" }

    @ExceptionHandler(IllegalArgumentException::class)
    fun rejectedCommand(exception: IllegalArgumentException): ProblemDetail =
        ProblemDetail.forStatusAndDetail(
            HttpStatus.UNPROCESSABLE_ENTITY,
            exception.message ?: "The command was rejected."
        ).apply { title = "Command rejected" }

    @ExceptionHandler(CompletionException::class)
    fun commandFailure(exception: CompletionException): ProblemDetail {
        val cause = exception.cause ?: exception
        return ProblemDetail.forStatusAndDetail(
            HttpStatus.UNPROCESSABLE_ENTITY,
            cause.message ?: "Command execution failed."
        ).apply { title = "Command failed" }
    }
}
