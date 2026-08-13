import { getRemoteMcpScopeCatalog, resolveRemoteMcpToolScopeBinding } from "./remoteMcpScopeCatalog.js";

function clone(value) {
  return structuredClone(value);
}

export function projectRemoteMcpTools(toolDefinitions = [], catalog = getRemoteMcpScopeCatalog()) {
  const tools = [];
  const excluded = [];
  for (const definition of toolDefinitions) {
    const toolKey = String(definition?.name || "").trim();
    const binding = resolveRemoteMcpToolScopeBinding(toolKey, catalog);
    if (!binding || binding.status !== "active" || !binding.scope_keys?.length) {
      excluded.push({ tool_key: toolKey || null, code: "MCP_TOOL_SCOPE_BINDING_MISSING" });
      continue;
    }
    tools.push({
      ...clone(definition),
      securitySchemes: [{ type: "oauth2", scopes: [...binding.scope_keys] }],
      _meta: {
        "mad4b/scope_catalog_revision": catalog.revision || null,
        "mad4b/resource_key": binding.resource_key || null,
        "mad4b/operation_key": binding.operation_key || null,
        "mad4b/effect_class": binding.effect_class || "read_only",
        secrets_included: false,
      },
    });
  }
  return {
    tools,
    excluded,
    revision: catalog.revision || null,
    secrets_included: false,
  };
}

export function requiredRemoteMcpScopesForTool(toolKey, catalog = getRemoteMcpScopeCatalog()) {
  const binding = resolveRemoteMcpToolScopeBinding(toolKey, catalog);
  return binding?.status === "active" ? [...binding.scope_keys] : null;
}
