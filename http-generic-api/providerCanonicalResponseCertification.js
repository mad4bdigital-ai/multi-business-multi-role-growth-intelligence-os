function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    if (["description", "title", "example", "examples", "externalDocs", "deprecated"].includes(key)) return out;
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function localRef(root, ref) {
  if (!String(ref || "").startsWith("#/")) return null;
  return String(ref).slice(2).split("/").reduce((node, part) => node?.[part.replaceAll("~1", "/").replaceAll("~0", "~")], root);
}

export function dereferenceLocalSchema(schema, root, depth = 0) {
  if (depth > 12) throw new Error("Provider canonical schema reference depth exceeded.");
  if (Array.isArray(schema)) return schema.map((item) => dereferenceLocalSchema(item, root, depth + 1));
  if (!schema || typeof schema !== "object") return schema;
  if (schema.$ref) {
    const resolved = localRef(root, schema.$ref);
    if (!resolved) return { $ref: schema.$ref, unresolved: true };
    const siblings = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$ref"));
    return dereferenceLocalSchema({ ...resolved, ...siblings }, root, depth + 1);
  }
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, dereferenceLocalSchema(value, root, depth + 1)]));
}

function operationResponseSchema(operation = {}, status) {
  const response = operation?.responses?.[String(status)] || operation?.responses?.[Number(status)] || null;
  if (!response) return null;
  return response?.content?.["application/json"]?.schema || response?.schema || null;
}

function runtimeResponseSchema(runtimeSchema = {}, status) {
  const response = runtimeSchema?.responses?.[String(status)] || runtimeSchema?.responses?.[Number(status)] || null;
  if (!response) return null;
  return response?.content?.["application/json"]?.schema || response?.schema || null;
}

export function assessProviderCanonicalResponseSchemaParity({
  canonicalOpenApi,
  path,
  method,
  status,
  runtimeSchema,
} = {}) {
  const normalizedMethod = String(method || "").toLowerCase();
  const operation = canonicalOpenApi?.paths?.[path]?.[normalizedMethod] || null;
  if (!operation) {
    return { status: "block", parity: false, reason_code: "provider_canonical_operation_missing", secrets_included: false };
  }
  const canonicalRaw = operationResponseSchema(operation, status);
  const runtimeRaw = runtimeResponseSchema(runtimeSchema, status);
  if (!canonicalRaw) {
    return { status: "block", parity: false, reason_code: "provider_canonical_response_schema_missing", response_status: String(status), secrets_included: false };
  }
  if (!runtimeRaw) {
    return { status: "block", parity: false, reason_code: "runtime_response_schema_missing", response_status: String(status), secrets_included: false };
  }
  const canonical = stable(dereferenceLocalSchema(canonicalRaw, canonicalOpenApi));
  const runtime = stable(dereferenceLocalSchema(runtimeRaw, runtimeSchema));
  const parity = JSON.stringify(canonical) === JSON.stringify(runtime);
  return {
    contract: "mad4b.provider-canonical-response-schema-certification.v1",
    status: parity ? "pass" : "block",
    parity,
    reason_code: parity ? null : "provider_canonical_response_schema_drift",
    path,
    method: normalizedMethod.toUpperCase(),
    response_status: String(status),
    canonical_schema: canonical,
    runtime_schema: runtime,
    secrets_included: false,
  };
}
