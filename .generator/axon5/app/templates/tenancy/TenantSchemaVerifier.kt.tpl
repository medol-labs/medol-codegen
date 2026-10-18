package <%= rootPackage %>.shared.application.tenancy

import java.sql.Connection
import java.sql.Types

data class TenantColumnDefinition(val name: String, val type: String)
data class TenantTableDefinition(
    val name: String, val columns: List<TenantColumnDefinition>,
    val primaryKey: List<String>, val indexes: List<List<String>> = emptyList()
)

object TenantSchemaVerifier {
    fun verify(connection: Connection, schema: String, tables: List<TenantTableDefinition>) {
        val h2 = connection.metaData.databaseProductName == "H2"
        for (table in tables) {
            data class Column(val type: Int, val typeName: String, val size: Int, val scale: Int, val nullable: Boolean)
            val columns = mutableMapOf<String, Column>()
            connection.metaData.getColumns(null, schema, table.name, null).use { rows ->
                while (rows.next()) if (rows.getString("TABLE_SCHEM") == schema && rows.getString("TABLE_NAME") == table.name) {
                    columns[rows.getString("COLUMN_NAME")] = Column(rows.getInt("DATA_TYPE"), rows.getString("TYPE_NAME"), rows.getInt("COLUMN_SIZE"), rows.getInt("DECIMAL_DIGITS"), rows.getInt("NULLABLE") != 0)
                }
            }
            for (expected in table.columns) {
                val actual = checkNotNull(columns[expected.name]) { "Tenant schema is missing ${table.name}.${expected.name}; add a versioned migration." }
                val compatible = when (expected.type) {
                    "uuid" -> actual.typeName.equals("uuid", ignoreCase = true)
                    "varchar(255)" -> actual.type in setOf(Types.VARCHAR, Types.NVARCHAR, Types.LONGVARCHAR) && actual.size >= 255
                    "text" -> actual.type in setOf(Types.CLOB, Types.NCLOB, Types.LONGVARCHAR) || actual.typeName.lowercase() in setOf("text", "character large object") ||
                        (h2 && actual.type == Types.VARCHAR && actual.size >= 1_000_000_000)
                    "integer" -> actual.type == Types.INTEGER
                    "bigint" -> actual.type == Types.BIGINT
                    "real" -> actual.type == Types.REAL
                    "double precision" -> actual.type == Types.DOUBLE || (actual.type == Types.FLOAT && actual.typeName.lowercase() in setOf("float8", "double precision"))
                    "numeric(38,2)" -> actual.type in setOf(Types.NUMERIC, Types.DECIMAL) && actual.scale >= 2 && actual.size - actual.scale >= 36
                    "boolean" -> actual.type in setOf(Types.BOOLEAN, Types.BIT)
                    "date" -> actual.type == Types.DATE
                    "timestamp(6)" -> actual.type == Types.TIMESTAMP && actual.scale >= 6
                    else -> false
                }
                check(compatible) { "Tenant column ${table.name}.${expected.name} does not match the generated storage contract." }
                check(!table.primaryKey.contains(expected.name) || !actual.nullable) { "Tenant primary key columns must be non-null." }
            }
            val primaryKey = mutableSetOf<String>()
            connection.metaData.getPrimaryKeys(null, schema, table.name).use { rows ->
                while (rows.next()) if (rows.getString("TABLE_SCHEM") == schema && rows.getString("TABLE_NAME") == table.name) primaryKey.add(rows.getString("COLUMN_NAME"))
            }
            check(primaryKey == table.primaryKey.toSet()) { "Tenant primary key does not match ${table.name}." }
            val indexes = mutableMapOf<String, java.util.SortedMap<Int, String>>()
            connection.metaData.getIndexInfo(null, schema, table.name, false, false).use { rows ->
                while (rows.next()) {
                    if (rows.getString("TABLE_SCHEM") != schema || rows.getString("TABLE_NAME") != table.name) continue
                    val name = rows.getString("INDEX_NAME") ?: continue
                    val column = rows.getString("COLUMN_NAME") ?: continue
                    indexes.getOrPut(name) { sortedMapOf() }[rows.getInt("ORDINAL_POSITION")] = column
                }
            }
            for (expected in table.indexes) check(indexes.values.any { it.values.toList().take(expected.size) == expected }) {
                "Tenant schema is missing a required index on ${table.name}."
            }
        }
    }
}
