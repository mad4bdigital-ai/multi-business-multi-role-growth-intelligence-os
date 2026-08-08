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
    if (variants.length === 1) {
      const [variant] = variants;
      properties[name] = variant;
    } else if (variants.length > 1) {
      properties[name] = { anyOf: variants };
    }
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

function boolish(value) {
  if (value === true || value === false) return value;
  const normalized = normalizedText(value).toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function mutationApproval(args = {}) {
  const approval = args?.mutation_approval || args?.operator_approval || {};
  return approval && typeof approval === "object" && !Array.isArray(approval) ? approval : {};
}

function hasExplicitMutationApproval(args = {}) {
  const approval = mutationApproval(args);
  return (
    boolish(args?.operator_approved) ||
    boolish(args?.operator_approval_granted) ||
    boolish(approval.approved) ||
    boolish(approval.operator_approved) ||
    boolish(approval.operator_approval_granted)
  );
}

function hasCompletedMutationPreflight(args = {}) {
  const approval = mutationApproval(args);
  return (
    boolish(args?.dry_run_preflight_completed) ||
    boolish(args?.approved_preflight_dry_run_validated) ||
    boolish(approval.dry_run_preflight_completed) ||
    boolish(approval.approved_preflight_dry_run_validated)
  );
}

function hasLiveMutationApproval(args = {}) {
  const approval = mutationApproval(args);
  return (
    boolish(args?.live_execution_approved) ||
    boolish(args?.execute_live) ||
    boolish(approval.live_execution_approved) ||
    boolish(approval.execute_live)
  );
}

function hasRequiredSameCycleReadback(args = {}) {
  const readback = args?.readback;
  if (!readback || typeof readback !== "object" || Array.isArray(readback)) return false;
  const mode = normalizedText(readback.mode).toLowerCase();
  return boolish(readback.required) && Boolean(mode) && mode !== "none";
}

function isGithubIssueCommentMutation(row = {}) {
  return (
    normalizedText(row.tool_name) === "github_rest_endpoint_dispatch" &&
    normalizedText(row.parent_action_key) === "github_api_mcp" &&
    normalizedText(row.endpoint_key) === "github_create_issue_comment" &&
    normalizedText(row.method).toUpperCase() === "POST"
  );
}

function enforceGithubIssueCommentMutationGate(row = {}, args = {}) {
  if (!isGithubIssueCommentMutation(row)) return;

  const details = {
    tool_name: "github_rest_endpoint_dispatch",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_create_issue_comment",
    provider_call_allowed: false,
  };

  if (boolish(args?.dry_run) || boolish(args?.preflight_only)) {
    throw createSelectionError(
      409,
      "github_issue_comment_mutation_preflight_requires_preview",
      "GitHub issue-comment preflight must use runtime_endpoint_preview so the preflight cannot perform a provider write.",
      {
        ...details,
        preview_tool: "runtime_endpoint_preview",
      },
    );
  }

  if (!hasExplicitMutationApproval(args)) {
    throw createSelectionError(
      403,
      "github_issue_comment_mutation_approval_required",
      "GitHub issue-comment mutation requires explicit operator approval before provider dispatch.",
      details,
    );
  }

  if (!hasCompletedMutationPreflight(args)) {
    throw createSelectionError(
      403,
      "github_issue_comment_mutation_preflight_required",
      "GitHub issue-comment mutation requires completed dry-run/preflight evidence before provider dispatch.",
      details,
    );
  }

  if (!hasLiveMutationApproval(args)) {
    throw createSelectionError(
      403,
      "github_issue_comment_mutation_live_approval_required",
      "GitHub issue-comment mutation requires explicit live_execution_approved=true before provider dispatch.",
      details,
    );
  }

  if (!hasRequiredSameCycleReadback(args)) {
    throw createSelectionError(
      403,
      "github_issue_comment_mutation_readback_required",
      "GitHub issue-comment mutation requires a non-none same-cycle readback contract before provider dispatch.",
      details,
    );
  }
}

function buildMultiBindingSchema(rows, normalizeInputSchema) {
  const endpointKeys = allowedEndpointKeys(rows);
  const normalizedSchemas = rows.map((row) => normalizeInputSchema(row.input_schema_json));
  return {
    type: "object",
    properties: {
      ...mergePropertySchemas(normalizedSchemas),
      endpoint_key: {
        type: "string",
        enum: endpointKeys,
        description: "Select the active endpoint binding exposed through this public system tool.",
      },
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
    if (bindings.length < 1) {
      throw createSelectionError(
        500,
        "platform_endpoint_tool_descriptor_binding_missing",
        "A public platform endpoint tool descriptor cannot be built without an active binding.",
        { tool_name: toolName },
      );
    }

    const [first] = bindings;
    const endpointKeys = allowedEndpointKeys(bindings);
    const multiBinding = bindings.length > 1;
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

  const candidateToolNames = [
    ...new Set(candidates.map((row) => normalizedText(row.tool_name)).filter(Boolean)),
  ];
  if (candidateToolNames.length !== 1) {
    throw createSelectionError(
      409,
      "platform_endpoint_tool_name_ambiguous",
      "The candidate bindings do not resolve to exactly one public platform endpoint tool name.",
      {
        requested_tool_name: normalizedText(name) || null,
        candidate_tool_names: candidateToolNames,
        candidate_count: candidates.length,
      },
    );
  }

  const [candidateToolName] = candidateToolNames;
  const requestedToolName = normalizedText(name);
  if (requestedToolName && requestedToolName !== candidateToolName) {
    throw createSelectionError(
      409,
      "platform_endpoint_tool_name_mismatch",
      "The requested public tool name does not match the candidate endpoint bindings.",
      {
        requested_tool_name: requestedToolName,
        candidate_tool_name: candidateToolName,
      },
    );
  }

  const toolName = requestedToolName || candidateToolName;
  const endpointKeys = allowedEndpointKeys(candidates);
  const requestedEndpointKey = normalizedText(args?.endpoint_key);

  if (candidates.length === 1) {
    const [row] = candidates;
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
    enforceGithubIssueCommentMutationGate(row, args);
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

  const [row] = selected;
  enforceGithubIssueCommentMutationGate(row, args);
  return row;
}
