const SECRET_PATTERN = /(secret|credential|password|passwd|private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|bearer)/i;
const PII_PATTERN = /(^|_)(email|phone|mobile|address|first_name|last_name|full_name|birth|dob|national_id|passport|ip_address|user_agent)($|_)/i;
const OPERATIONAL_PATTERN = /(^|_)(audit|log|event|history|session|job|queue|run|receipt|evidence|outbox)($|_)/i;
const IDENTITY_PATTERN = /^(users|tenants|memberships|role_assignments|user_roles|tenant_users)$/i;
const REFERENCE_PATTERN = /(^|_)(registry|catalog|policy|policies|workflow|route|type|profile|configuration|config)($|_)/i;
const COMPLEX_TYPES = new Set(["blob", "tinyblob", "mediumblob", "longblob", "binary", "varbinary"]);

function normalizedColumn(row) {
  return {
    name: String(row.COLUMN_NAME || ""),
    ordinal_position: Number(row.ORDINAL_POSITION || 0),
    data_type: String(row.DATA_TYPE || "").toLowerCase(),
    column_type: String(row.COLUMN_TYPE || ""),
    nullable: String(row.IS_NULLABLE || "").toUpperCase() === "YES",
    key: String(row.COLUMN_KEY || ""),
    extra: String(row.EXTRA || ""),
  };
}

export function classifySchemaMetadataTable(tableName, columns) {
  const names = [tableName, ...columns.map((column) => column.name)];
  if (names.some((name) => SECRET_PATTERN.test(name))) {
    return { candidate_classification: "exclude_secret", confidence: "high", reason: "secret_metadata_pattern" };
  }
  if (IDENTITY_PATTERN.test(tableName)) {
    return { candidate_classification: "synthetic_only", confidence: "high", reason: "identity_or_tenant_authority" };
  }
  if (OPERATIONAL_PATTERN.test(tableName)) {
    return { candidate_classification: "exclude_operational", confidence: "high", reason: "operational_or_ephemeral_surface" };
  }
  if (columns.some((column) => PII_PATTERN.test(column.name))) {
    return { candidate_classification: "copy_sanitized", confidence: "medium", reason: "direct_pii_metadata_pattern" };
  }
  if (columns.some((column) => COMPLEX_TYPES.has(column.data_type))) {
    return { candidate_classification: "manual_review", confidence: "high", reason: "binary_or_opaque_payload" };
  }
  if (REFERENCE_PATTERN.test(tableName)) {
    return { candidate_classification: "copy_direct", confidence: "medium", reason: "reference_or_policy_surface" };
  }
  return { candidate_classification: "manual_review", confidence: "high", reason: "unclassified_fail_closed" };
}

export async function collectFullSchemaMetadataCensus(pool) {
  const [tableRows] = await pool.query(`
    SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME
  `);
  const [columnRows] = await pool.query(`
    SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, COLUMN_TYPE,
           IS_NULLABLE, COLUMN_KEY, EXTRA
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);
  const [relationRows] = await pool.query(`
    SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME,
           CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION
  `);

  const columnsByTable = new Map();
  for (const row of columnRows) {
    const tableName = String(row.TABLE_NAME || "");
    const columns = columnsByTable.get(tableName) || [];
    columns.push(normalizedColumn(row));
    columnsByTable.set(tableName, columns);
  }

  const relationsByTable = new Map();
  for (const row of relationRows) {
    const tableName = String(row.TABLE_NAME || "");
    const relations = relationsByTable.get(tableName) || [];
    relations.push({
      constraint_name: String(row.CONSTRAINT_NAME || ""),
      column: String(row.COLUMN_NAME || ""),
      referenced_table: String(row.REFERENCED_TABLE_NAME || ""),
      referenced_column: String(row.REFERENCED_COLUMN_NAME || ""),
    });
    relationsByTable.set(tableName, relations);
  }

  const tables = tableRows.map((row) => {
    const tableName = String(row.TABLE_NAME || "");
    const columns = columnsByTable.get(tableName) || [];
    return {
      table: tableName,
      table_type: String(row.TABLE_TYPE || ""),
      engine: row.ENGINE ? String(row.ENGINE) : null,
      estimated_row_count: row.TABLE_ROWS == null ? null : Number(row.TABLE_ROWS),
      estimated_row_count_source: "information_schema.TABLES.TABLE_ROWS",
      data_length_bytes: row.DATA_LENGTH == null ? null : Number(row.DATA_LENGTH),
      index_length_bytes: row.INDEX_LENGTH == null ? null : Number(row.INDEX_LENGTH),
      columns,
      foreign_keys: relationsByTable.get(tableName) || [],
      ...classifySchemaMetadataTable(tableName, columns),
    };
  });

  const classifications = {};
  for (const table of tables) {
    classifications[table.candidate_classification] =
      (classifications[table.candidate_classification] || 0) + 1;
  }

  return {
    contract: "mad4b.production-full-schema-metadata-census.v1",
    scope: "full_schema_metadata",
    summary: {
      total_tables: tables.length,
      estimated_total_rows: tables.reduce(
        (sum, table) => sum + (Number.isFinite(table.estimated_row_count) ? table.estimated_row_count : 0),
        0
      ),
      classifications,
    },
    classification_policy: {
      status: "preliminary_fail_closed",
      final_copy_authorization_required: true,
      row_value_scan_performed: false,
    },
    tables,
    row_values_read: false,
    exact_row_counts_performed: false,
    database_mutation: false,
    production_mutation: false,
    staging_mutation: false,
    secrets_included: false,
  };
}
