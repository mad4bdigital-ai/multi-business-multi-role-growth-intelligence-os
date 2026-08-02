function normalizedText(value) {
  return String(value || "").trim();
}

function stableRows(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])]
    .filter((row) => normalizedText(row?.tool_name))
    .sort((left, right) => {
      const leftKey = [left.tool_name, left.endpoint_key, left.parent_action_key]
        .map(normalizedText)
        .join("\u0000");
      const rightKey = [right.tool_name, right.endpoint_key, right.parent_action_key]
        .map(normalizedText)
        .join("\u0000");
      return leftKey.localeCompare(rightKey);
    });
}

function uniqueJsonSchemas(values = []) {
  const seen = new Set();
  const unique = [];
  for (const value of values) {
    const serialized = JSON.stringify(value);
    if (seen.has(serialized)) continue;
    seen.add(serialized);
    unique.push(value);
  }
  return unique;
}

function mergePropertySchemas(schemas = []) {
  const properties = {};
  const propertyNames = new Set();
  for (const schema of schemas) {
    for (const name of Object.keys(schema?.properties || {})) propertyNames.add(name);
  }

  for (const name of [...propertyNames].sort()) {
    const variants = uniqueJsonSchemas(
      schemas
        .map((schema) => schema?.properties?.[name])
        .filter((value) => value !== undefined),
    );
    if (variants.length === 1) properties[name] = variants[0];
    else if (variants.length > 1) properties[name] = { anyOf: variants };
  }
  return properties;
}

function publicBinding(row = {}) {
  return {
    parent_action_key: normalizedText(row.parent_action_key),
    endpoint_key: normalizedText(row.endpoint_key),
    method: normalizedText(row.method).toUpperCase() || null,
    scope_class: normalizedText(row.scope_class) || null,
  };
}

function allowedEndpointKeys(rows = []) {
  return [...new Set(rows.map((row) => normalizedText(row.endpoint_key)).filter(Boolean))].sort();
}

function createSelectionError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = {
    ...details,
    secrets_included: false,
  };
  return error;
}

function buildMultiBindingSchema(rows, normalizeInputSchema) {
  const endpointKeys = allowedEndpointKeys(rows);
  const normalizedSchemas = rows.map((row) => normalizeInputSchema(row.input_schema_json));
  return {
    type: "object",
    properties: {
      endpoint_key: {
        type: "string",
        enum: endpointKeys,
        description: "Select the active endpoint binding exposed through this public system tool.",
      },
      ...mergePropertySchemas(normalizedSchemas),
    },
    required: ["endpoint_key"],
    additionalProperties: normalizedSchemas.some((schema) => schema?.additionalProperties !== false),
  };
}

export function buildPlatformEndpointToolDescriptors(
  rows = [],
  { normalizeInputSchema = (value) => value } = {},
) {
  const groups = new Map();
  for (const row of stableRows(rows)) {
    const toolName = normalizedText(row.tool_name);
    const group = groups.get(toolName) || [];
    group.push(row);
    groups.set(toolName, group);
  }

  return [...groups.entries()].map(([toolName, bindings]) => {
    const endpointKeys = allowedEndpointKeys(bindings);
    const multiBinding = bindings.length > 1;
    const first = bindings[0];
    const inputSchema = multiBinding
      ? buildMultiBindingSchema(bindings, normalizeInputSchema)
      : normalizeInputSchema(first.input_schema_json);

    return {
      name: toolName,
      description: multiBinding
        ? `Registry endpoint tool facade exposing ${bindings.length} active bindings. Select endpoint_key.`
        : `Registry endpoint tool ${first.parent_action_key}/${first.endpoint_key}.`,
      requires_admin: bindings.every((row) => row.scope_class === "admin"),
      inputSchema,
      x_platform_endpoint: {
        source: "platform_endpoint_tool_exports",
        binding_count: bindings.length,
        endpoint_keys: endpointKeys,
        bindings: bindings.map(publicBinding),
        ...(multiBinding
          ? { selection_field: "endpoint_key" }
          : {
              parent_action_key: first.parent_action_key,
              endpoint_key: first.endpoint_key,
            }),
      },
    };
  });
}

export function selectPlatformEndpointToolBinding(rows = [], args = {}, name = "") {
  const candidates = stableRows(rows);
  if (!candidates.length) return null;

  const toolName = normalizedText(name) || normalizedText(candidates[0].tool_name);
  const endpointKeys = allowedEndpointKeys(candidates);
  const requestedEndpointKey = normalizedText(args?.endpoint_key);

  if (candidates.length === 1) {
    const row = candidates[0];
    if (requestedEndpointKey && requestedEndpointKey !== normalizedText(row.endpoint_key)) {
      throw createSelectionError(
        400,
        "platform_endpoint_tool_endpoint_key_unknown",
        "endpoint_key does not match the active endpoint binding for this public tool.",
        {
          tool_name: toolName,
          endpoint_key: requestedEndpointKey,
          allowed_endpoint_keys: endpointKeys,
        },
      );
    }
    return row;
  }

  if (!requestedEndpointKey) {
    throw createSelectionError(
      400,
      "platform_endpoint_tool_endpoint_key_required",
      "endpoint_key is required because this public tool exposes more than one active endpoint binding.",
      {
        tool_name: toolName,
        allowed_endpoint_keys: endpointKeys,
      },
    );
  }

  if (!endpointKeys.includes(requestedEndpointKey)) {
    throw createSelectionError(
      400,
      "platform_endpoint_tool_endpoint_key_unknown",
      "endpoint_key is not an active binding exposed by this public tool.",
      {
        tool_name: toolName,
        endpoint_key: requestedEndpointKey,
        allowed_endpoint_keys: endpointKeys,
      },
    );
  }

  const selected = candidates.filter(
    (row) => normalizedText(row.endpoint_key) === requestedEndpointKey,
  );
  if (selected.length !== 1) {
    throw createSelectionError(
      409,
      "platform_endpoint_tool_binding_ambiguous",
      "The selected endpoint_key resolves to more than one active platform endpoint binding.",
      {
        tool_name: toolName,
        endpoint_key: requestedEndpointKey,
        candidate_count: selected.length,
        allowed_endpoint_keys: endpointKeys,
      },
    );
  }

  return selected[0];
}
