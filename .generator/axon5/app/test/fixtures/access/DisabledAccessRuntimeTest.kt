package example

import example.shared.security.*
import example.shared.application.export.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.support.DefaultListableBeanFactory
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.Sort
import java.util.UUID

class DisabledAccessRuntimeTest {
    @Test
    fun `export works without any data scope beans while keeping file ownership`() {
        val actor = CurrentUser(UUID.randomUUID(), "reader", null, emptySet(), emptySet())
        val users = object : CurrentUserProvider { override fun currentUser() = actor }
        val beans = DefaultListableBeanFactory()
        var owner: String? = null
        beans.registerSingleton("port", object : DataExportJobRequestPort {
            override fun request(message: DataExportJobRequestMessage) { owner = message.requestedBy }
        })
        val properties = DataExportProperties().apply { asyncThreshold = 0; storagePath = java.nio.file.Files.createTempDirectory("plain-export-").toString() }
        val mapper = com.fasterxml.jackson.databind.ObjectMapper().registerModule(com.fasterxml.jackson.datatype.jsr310.JavaTimeModule())
        val service = DataExportService(properties, mapper, beans.getBeanProvider(DataExportJobRequestPort::class.java), beans.getBeanProvider(DataExportDictionaryLabelProvider::class.java), users)
        val page = PageImpl(listOf(OrderEntity()))
        val columns = listOf(DataExportColumn("id"))
        assertEquals(202, service.export("orders", columns, emptyMap<String, String>(), Sort.unsorted(), page, { page }).statusCode.value())
        assertEquals(actor.id.toString(), owner)
        val file = service.writeCsvFile("orders.csv", columns, page, requestedBy = actor.id.toString()) { page }
        assertTrue(java.nio.file.Files.isRegularFile(service.ownedDownload(file.filePath)))
    }
}
