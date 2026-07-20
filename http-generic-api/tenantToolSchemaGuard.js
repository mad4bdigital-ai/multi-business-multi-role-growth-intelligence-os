export function inspectTenantToolInputSchema(inputSchema) {
  if (inputSchema === null || inputSchema === undefined || String(inputSchema).trim() === "") {
    return { strict: false, reason: "missing_input_schema" };
  }

  let schema = inputSchema;
  if (typeof inputSchema === "string") {
    try {
      schema = JSON.parse(inputSchema);
    } catch {
      return { strict: false, reason: "invalid_json_schema" };
    }
  }

  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { strict: false, reason: "schema_must_be_object" };
  }
  if (schema.type !== "object") {
    return { strict: false, reason: "schema_type_must_be_object" };
  }
  if (schema.additionalProperties !== false) {
    return { strict: false, reason: "additional_properties_must_be_false" };
  }
  return { strict: true, reason: null };
}

export function buildTenantToolSchemaBlocks(rows = []) {
  const blocked = new Map();
  for (const row of rows || []) {
    const toolKey = String(row?.tool_key || "").trim();
    if (!toolKey) continue;
    const result = inspectTenantToolInputSchema(row?.input_schema);
    if (!result.strict) blocked.set(toolKey, result.reason);
  }
  return blocked;
}

export async function loadTenantToolSchemaBlocks(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A SQL pool is required to resolve Tenant tool input schemas.");
  }
  const [rows] = await pool.query(
    `SELECT tool_key, input_schema
     FROM tenant_platform_endpoint_tools
     WHERE is_enabled = 1`
  );
  return buildTenantToolSchemaBlocks(rows);
}

export function filterTenantToolsByStrictSchema(rows = [], blockedSchemas = new Map()) {
  return (rows || []).filter((row) => !blockedSchemas.has(String(row?.tool_key || "").trim()));
}

export function assertTenantToolSchemaAllows(callerType, toolKey, blockedSchemas = new Map()) {
  if (callerType !== "tenant") return;
  const normalizedToolKey = String(toolKey || "").trim();
  if (!normalizedToolKey || !blockedSchemas.has(normalizedToolKey)) return;

  const error = new Error("This Tenant tool is blocked because its input schema is not strict.");
  error.status = 403;
  error.code = "tenant_tool_input_schema_not_strict";
  error.details = {
    tool_key: normalizedToolKey,
    reason: blockedSchemas.get(normalizedToolKey),
    required_contract: {
      type: "object",
      additionalProperties: false,
    },
  };
  throw error;
}
