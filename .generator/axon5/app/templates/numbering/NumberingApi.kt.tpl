package <%= rootPackage %>.shared.application.numbering

/** requestKey is stable across retries, rule versions and calendar periods. */
data class NumberAllocationRequest(
    val ruleCode: String, val requestKey: String, val ownerKey: String,
    val count: Int = 1, val tenantId: String? = null
)
data class NumberAllocationResult(val allocationId: java.util.UUID, val codes: List<String>, val ruleVersion: Long)
interface LocalNumberingAllocator { fun allocate(request: NumberAllocationRequest): NumberAllocationResult }
