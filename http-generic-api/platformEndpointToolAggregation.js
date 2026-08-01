function normalizedText(value) {
  return String(value || "").trim();
}

function uniqueSorted(values = []) {
  return [...new Set(values.map(normalizedText).filter(Boolean))].sort();
}

function endpointSelectorSchema(values = []) {
  const endpointKeys = uniqueSorted(values);
  return {
    type: "string",
    enum: endpointKeys,
  };
}

function parentActionSelectorSchema(values = []) {
  const parentActionKeys = uniqueSorted(values);
  if (parentActionKeys.length === 1) {
    return { type: "string", const: parentActionKeys[0], default: parentActionKeys[0] };
  }
  return { type: "string", enum: parentActionKeys };
}

function groupedDispatcherInputSchema(rows = []) {
  return {
    type: "object",
    required: ["endpoint_key"],
    properties: {
      parent_action_key: parentActionSelectorSchema(rows.map((row) => row.parent_action_key)),
      endpoint_key: endpointSelectorSchema(rows.map((row) => row.endpoint_key)),
      path_params: { type: "object", additionalProperties: true },
      query: { type: "object", additionalProperties: true },
      body: { type: "object", additionalProperties: true },
      headers: { type: "object", additionalProperties: true },
      credential_scope: { type: "string", enum: ["platform", "tenant", "user", "connection", "auto"] },
      connection_id: { type: "string" },
      app_key: { type: "string" },
      scopes: { type: "array", items: { type: "string" } },
      auth_type: { type: "string" },
      allow_platform_fallback: { type: "boolean" },
      auth_context: { type: "object", additionalProperties: true },
      mutation_approval: { type: "object", additionalProperties: true },
      dry_run: { type: "boolean" },
      preflight_only: { type: "boolean" },
      dry_run_preflight_completed: { type: "boolean" },
      approved_preflight_dry_run_validated: { type: "boolean" },
      live_execution_approved: { type: "boolean" },
      readback: { type: "object", additionalProperties: true },
      timeout_seconds: { type: "integer", minimum: 1, maximum: 120 },
    },
    additionalProperties: false,
  };
}

function bindingMetadata(row = {}, normalizeInputSchema = (value) => value) {
  return {
    parent_action_key: normalizedText(row.parent_action_key),
    endpoint_key: normalizedText(row.endpoint_key),
    scope_class: normalizedText(row.scope_class) || null,
    method: normalizedText(row.method).toUpperCase() || null,
    inputSchema: normalizeInputSchema(row.input_schema_json),
  };
}

export function aggregatePlatformEndpointToolRows(rows = [], options = {}) {
  const existingNames = options.existingNames instanceof Set
    ? options.existingNames
    : new Set(options.existingNames || []);
  const blockedNames = options.blockedNames instanceof Set
    ? options.blockedNames
    : new Set(options.blockedNames || []);
  const isAdmin = options.isAdmin === true;
  const normalizeInputSchema = typeof options.normalizeInputSchema === "function"
    ? options.normalizeInputSchema
    : (value) => value;
  const groups = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const toolName = normalizedText(row?.tool_name);
    const endpointKey = normalizedText(row?.endpoint_key);
    const parentActionKey = normalizedText(row?.parent_action_key);
    if (!toolName || !endpointKey || !parentActionKey) continue;
    if (existingNames.has(toolName)) continue;
    if (!isAdmin && blockedNames.has(toolName)) continue;
    if (!groups.has(toolName)) groups.set(toolName, []);
    groups.get(toolName).push(row);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([toolName, groupRows]) => {
      const sortedRows = [...groupRows].sort((left, right) =>
        `${normalizedText(left.parent_action_key)}\u0000${normalizedText(left.endpoint_key)}\u0000${normalizedText(left.scope_class)}`
          .localeCompare(`${normalizedText(right.parent_action_key)}\u0000${normalizedText(right.endpoint_key)}\u0000${normalizedText(right.scope_class)}`));
      const bindings = sortedRows.map((row) => bindingMetadata(row, normalizeInputSchema));
      const endpointKeys = uniqueSorted(bindings.map((binding) => binding.endpoint_key));
      const parentActionKeys = uniqueSorted(bindings.map((binding) => binding.parent_action_key));
      return {
        name: toolName,
        description: `Registry endpoint dispatcher ${toolName} with ${bindings.length} governed endpoint binding${bindings.length === 1 ? "" : "s"}.`,
        requires_admin: sortedRows.every((row) => normalizedText(row.scope_class) === "admin"),
        inputSchema: groupedDispatcherInputSchema(sortedRows),
        x_platform_endpoint: {
          source: "platform_endpoint_tool_exports",
          grouped: true,
          endpoint_count: bindings.length,
          parent_action_keys: parentActionKeys,
          endpoint_keys: endpointKeys,
          bindings,
        },
      };
    });
}

function selectionError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

export function resolvePlatformEndpointToolBinding(rows = [], options = {}) {
  const toolName = normalizedText(options.toolName);
  const args = options.args && typeof options.args === "object" ? options.args : {};
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter((row) => normalizedText(row?.tool_name) === toolName)
    .sort((left, right) =>
      `${normalizedText(left.parent_action_key)}\u0000${normalizedText(left.endpoint_key)}`
        .localeCompare(`${normalizedText(right.parent_action_key)}\u0000${normalizedText(right.endpoint_key)}`));
  if (!candidates.length) return null;

  const requestedEndpointKey = normalizedText(args.endpoint_key);
  const requestedParentActionKey = normalizedText(args.parent_action_key);
  const allowedEndpointKeys = uniqueSorted(candidates.map((row) => row.endpoint_key));

  if (candidates.length > 1 && !requestedEndpointKey) {
    throw selectionError(
      400,
      "platform_endpoint_tool_endpoint_key_required",
      "This grouped platform endpoint tool requires endpoint_key.",
      { tool_name: toolName, allowed_endpoint_keys: allowedEndpointKeys },
    );
  }

  let matches = requestedEndpointKey
    ? candidates.filter((row) => normalizedText(row.endpoint_key) === requestedEndpointKey)
    : candidates;
  if (!matches.length) {
    throw selectionError(
      400,
      "platform_endpoint_tool_endpoint_key_not_allowed",
      "endpoint_key is not exported by this platform endpoint tool.",
      { tool_name: toolName, endpoint_key: requestedEndpointKey || null, allowed_endpoint_keys: allowedEndpointKeys },
    );
  }

  if (requestedParentActionKey) {
    const parentMatches = matches.filter((row) => normalizedText(row.parent_action_key) === requestedParentActionKey);
    if (!parentMatches.length) {
      throw selectionError(
        400,
        "platform_endpoint_tool_parent_action_mismatch",
        "parent_action_key does not match the selected endpoint export.",
        {
          tool_name: toolName,
          endpoint_key: requestedEndpointKey || normalizedText(matches[0]?.endpoint_key),
          parent_action_key: requestedParentActionKey,
          allowed_parent_action_keys: uniqueSorted(matches.map((row) => row.parent_action_key)),
        },
      );
    }
    matches = parentMatches;
  }

  if (matches.length > 1) {
    throw selectionError(
      409,
      "platform_endpoint_tool_binding_ambiguous",
      "The selected platform endpoint tool binding is ambiguous.",
      {
        tool_name: toolName,
        endpoint_key: requestedEndpointKey || null,
        candidate_count: matches.length,
        parent_action_keys: uniqueSorted(matches.map((row) => row.parent_action_key)),
      },
    );
  }

  return matches[0];
}
