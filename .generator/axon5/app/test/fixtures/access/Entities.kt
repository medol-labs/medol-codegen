package example
import jakarta.persistence.*
import java.util.UUID
@Entity
open class MemberEntity(
    @Id open var id: UUID = UUID.randomUUID(),
    open var userId: UUID = UUID.randomUUID(),
    open var organizationId: UUID = UUID.randomUUID(),
    open var state: String = "Active"
)
@Entity
open class OrderEntity(
    @Id open var id: UUID = UUID.randomUUID(),
    open var ownerOrganizationId: UUID = UUID.randomUUID(),
    open var ownerId: UUID = UUID.randomUUID()
)
