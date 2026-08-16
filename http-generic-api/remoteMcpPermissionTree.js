import { getRemoteMcpScopeCatalog, resolveRemoteMcpToolScopeBinding } from "./remoteMcpScopeCatalog.js";

function clone(value) {
  return structuredClone(value);
}

export function buildRemoteMcpPermissionTree(catalog = getRemoteMcpScopeCatalog()) {
  const root = {
    kind: "oauth_grant",
    children: [{
      kind: "principal",
      children: [{
        kind: "tenant_workspace",
        children: [{
          kind: "container",
          children: [{
            kind: "resource_type",
            children: [{
              kind: "resource_instance",
              children: [{
                kind: "operation",
                children: [{ kind: "effect_class" }, { kind: "provider_environment" }, { kind: "conditions" }],
              }],
            }],
          }],
        }],
      }],
    }],
  };

  root.scope_bindings = (catalog.resource_operation_bindings || []).map((binding) => ({
    resource_key: binding.resource_key,
    operation_key: binding.operation_key,
    scope_key: binding.scope_key,
    effect_class: binding.effect_class,
    environment_class: binding.environment_class,
    status: binding.status,
  }));
  root.implications = clone(catalog.implications || []);
  root.revision = catalog.revision || null;
  root.secrets_included = false;
  return root;
}

export function explainRemoteMcpPermissionDecision({
  tokenScopes = [],
  toolKey,
  resourceKey,
  operationKey,
  effectClass = "read_only",
  environmentClass = "all",
  subjectActive = true,
  membershipActive = true,
  resourceAuthority = true,
  approvalSatisfied = true,
  capabilitySatisfied = true,
  leaseActive = true,
  catalog = getRemoteMcpScopeCatalog(),
} = {}) {
  const binding = resolveRemoteMcpToolScopeBinding(toolKey, catalog);
  const normalizedScopes = new Set((Array.isArray(tokenScopes) ? tokenScopes : String(tokenScopes || "").split(/\s+/u))
    .map((scope) => String(scope || "").trim()).filter(Boolean));
  const requiredScopes = binding?.scope_keys || [];
  const checks = [
    { key: "catalog_binding", ok: Boolean(binding && binding.status === "active"), detail: binding ? "active" : "MCP_TOOL_SCOPE_BINDING_MISSING" },
    { key: "oauth_scope", ok: requiredScopes.every((scope) => normalizedScopes.has(scope)), detail: requiredScopes },
    { key: "subject_active", ok: subjectActive, detail: subjectActive ? "active" : "inactive" },
    { key: "membership_active", ok: membershipActive, detail: membershipActive ? "active" : "inactive" },
    { key: "resource_authority", ok: resourceAuthority, detail: resourceAuthority ? "bound" : "unbound" },
    { key: "operation_eligibility", ok: Boolean(binding && binding.resource_key === resourceKey && binding.operation_key === operationKey), detail: `${resourceKey || ""}:${operationKey || ""}` },
    { key: "effect_policy", ok: effectClass === (binding?.effect_class || effectClass), detail: effectClass },
    { key: "environment_policy", ok: environmentClass === "all" || environmentClass === (binding?.environment_class || environmentClass), detail: environmentClass },
    { key: "approval", ok: approvalSatisfied, detail: approvalSatisfied ? "satisfied" : "required" },
    { key: "capability", ok: capabilitySatisfied, detail: capabilitySatisfied ? "satisfied" : "missing" },
    { key: "lease", ok: leaseActive, detail: leaseActive ? "active" : "expired" },
  ];
  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    code: failed[0]?.detail === "MCP_TOOL_SCOPE_BINDING_MISSING" ? "MCP_TOOL_SCOPE_BINDING_MISSING" : failed.length ? "MCP_AUTHORIZATION_DENIED" : "MCP_AUTHORIZATION_ALLOWED",
    tool_key: toolKey || null,
    required_scopes: requiredScopes,
    decision_path: checks,
    revision: catalog.revision || null,
    secrets_included: false,
  };
}
