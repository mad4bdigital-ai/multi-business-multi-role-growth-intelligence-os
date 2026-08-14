import assert from "node:assert/strict";
import { buildTenantGptEffectiveCapabilitySurface } from "./tenantGptEffectiveCapabilitySurface.js";

const base = {
  context: {
    tenant_id: "tenant-a",
    workspace_id: "workspace-a",
    principal_id: "user-a",
    context_hash: "ctx-a",
    internal_note: "not an authority input",
  },
  capability_manifest: {
    revision: "cap-7",
    capabilities: [{ key: "wordpress.read", state: "available" }],
    access_token: "must-not-leak",
    nested: { client_secret: "must-not-leak-either", safe: true },
  },
  authority_preflight: {
    decision: "allow",
    preflight_id: "pf-1",
    authorization: "Bearer must-not-leak",
  },
  plan: { plan_id: "plan-1", effect: "read" },
  approval_or_delegation: { status: "not_required" },
  final_authority: {
    decision: "allow",
    allowed: true,
    authority_revision: "auth-9",
    credential: "must-not-leak",
  },
  durable_execution: { status: "not_started", token: "must-not-leak" },
  adapter: { key: "wordpress", password: "must-not-leak" },
  readback: { status: "not_started", raw_rows: [{ tenant_id: "tenant-b" }] },
  readiness: {
    ready: true,
    checks: { database_contract_ready: true, schema_parity_ready: true },
    environment: "staging",
    migrations_applied: false,
    production_allowed: false,
  },
  questionnaire_schema: {
    questions: [
      { key: "site_url", label: "Site URL", type: "url", public: true, required: true },
      { key: "api_key", label: "API key", type: "text", public: true },
      { key: "internal_route", label: "Internal", type: "text", public: true, internal: true },
      { key: "credential_hint", label: "Credential", type: "text", public: true },
      { key: "private_note", label: "Private", type: "text", public: false },
    ],
  },
};

{
  const surface = buildTenantGptEffectiveCapabilitySurface({
    ...base,
    caller_context: { tenant_id: "tenant-b", workspace_id: "workspace-b", principal_id: "attacker" },
  });
  assert.equal(surface.surface_ready, true);
  assert.equal(surface.identity.tenant_id, "tenant-a");
  assert.equal(surface.identity.workspace_id, "workspace-a");
  assert.equal(surface.identity.principal_id, "user-a");
  assert.equal(surface.caller_identity_used_for_authority, false);
  assert.equal(surface.final_authority.allowed, true, "surface may project A's decision but must not mint a grant");
  assert.equal(surface.execution_grant_emitted, false);
  assert.equal(surface.execution_credentials_emitted, false);
  assert.equal(surface.selects_connection, false);
  assert.equal(surface.executes_provider, false);
  assert.equal(surface.secrets_included, false);

  const encoded = JSON.stringify(surface);
  for (const forbidden of [
    "must-not-leak",
    "must-not-leak-either",
    "Bearer must-not-leak",
    "\"tenant_id\":\"tenant-b\"",
  ]) {
    assert.equal(encoded.includes(forbidden), false, `${forbidden} must not appear in the public projection`);
  }

  assert.deepEqual(surface.questionnaire.questions.map((question) => question.key), ["site_url"]);
}

{
  const surface = buildTenantGptEffectiveCapabilitySurface({
    context: base.context,
    capability_manifest: base.capability_manifest,
    readiness: { ready: false, blocking_checks: ["MIGRATION_READBACK_NOT_READY"] },
  });
  assert.equal(surface.surface_ready, false);
  assert(surface.blockers.some((entry) => entry.code === "AUTHORITY_PREFLIGHT_MISSING"));
  assert(surface.blockers.some((entry) => entry.code === "FINAL_AUTHORITY_MISSING"));
  assert(surface.blockers.some((entry) => entry.code === "MIGRATION_READBACK_NOT_READY"));
  assert.equal(surface.final_authority, null);
  assert.equal(surface.execution_grant_emitted, false);
}

{
  const surface = buildTenantGptEffectiveCapabilitySurface({
    ...base,
    authority_preflight: {
      preflight_id: "pf-denied",
      decision: "deny",
      allowed: false,
    },
  });
  assert.equal(surface.surface_ready, false);
  assert(surface.blockers.some((entry) => entry.code === "AUTHORITY_PREFLIGHT_DENIED"));
  assert.equal(surface.final_authority.allowed, true);
  assert.equal(surface.execution_grant_emitted, false);
}

{
  const surface = buildTenantGptEffectiveCapabilitySurface({
    ...base,
    final_authority: {
      decision: "deny",
      allowed: false,
      blockers: [{
        code: "TENANT_SCOPE_DENIED",
        public_message: "Requested resource is outside the effective tenant scope",
        raw_rows: [{ secret: "x" }],
      }],
    },
  });
  assert.equal(surface.surface_ready, false);
  assert.equal(surface.final_authority.allowed, false);
  assert(surface.blockers.some((entry) => entry.code === "TENANT_SCOPE_DENIED"));
  assert.equal(JSON.stringify(surface).includes("\"secret\":\"x\""), false);
}

console.log(JSON.stringify({
  ok: true,
  gate: "tenant_gpt_effective_capability_surface",
  tenant_identity_isolation: true,
  caller_identity_widening_denied: true,
  authority_preflight_denial_fails_closed: true,
  no_secret_projection: true,
  questionnaire_sensitive_field_filter: true,
  alternate_authority_created: false,
  alternate_connection_selector_created: false,
}));
