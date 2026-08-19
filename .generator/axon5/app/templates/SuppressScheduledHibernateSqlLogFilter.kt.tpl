package <%= rootPackage %>.shared.application.logging

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.turbo.TurboFilter
import ch.qos.logback.core.spi.FilterReply
import org.slf4j.Marker

class SuppressScheduledHibernateSqlLogFilter : TurboFilter() {
    private val suppressedTokenEntryBindCount = ThreadLocal.withInitial { 0 }

    override fun decide(
        marker: Marker?,
        logger: Logger?,
        level: Level?,
        format: String?,
        params: Array<out Any>?,
        throwable: Throwable?
    ): FilterReply {
        val loggerName = logger?.name ?: return FilterReply.NEUTRAL
        if (loggerName != "org.hibernate.SQL" && loggerName != "org.hibernate.orm.jdbc.bind") {
            return FilterReply.NEUTRAL
        }

        val threadName = Thread.currentThread().name
        if (threadName.startsWith("scheduling-")) {
            return FilterReply.DENY
        }

        if (loggerName == "org.hibernate.SQL" && format?.contains("token_entry", ignoreCase = true) == true) {
            suppressedTokenEntryBindCount.set(TOKEN_ENTRY_BIND_PARAMETER_COUNT)
            return FilterReply.DENY
        }

        if (loggerName == "org.hibernate.orm.jdbc.bind") {
            val remaining = suppressedTokenEntryBindCount.get()
            if (remaining > 0) {
                suppressedTokenEntryBindCount.set(remaining - 1)
                return FilterReply.DENY
            }
        }

        return FilterReply.NEUTRAL
    }

    private companion object {
        private const val TOKEN_ENTRY_BIND_PARAMETER_COUNT = 6
    }
}
