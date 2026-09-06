import test from "node:test";
import assert from "node:assert/strict";

import { resolveSurfaceAuthority, SURFACE_KEYS } from "./surfaceAuthorityResolver.js";

function row(overrides = {}) {
  return {
    surface_id: "surface.execution_policy_sheet",
    logical_surface_key: null,
    surface_name: "Execution Policy Registry",
    surface_type: null,
    surface_scope: null,
    storage_type: null,
    active_status: "active",
    authority_status: "authoritative",
    required_for_execution: "TRUE",
    resolution_rule: null,
    owner_layer: null,
    schema_ref: "row_audit_schema:Execution Policy Registry",
    schema_version: "v1",
    binding_mode: "gid_based",
    sheet_role: "authority_surface",
    source_surface_id: null,
    source_surface_role: null,
    retired_replacement_surface_id: null,
    backend_type: null,
    backend_adapter: null,
    authority_model: null,
    portability_class: null,
    repair_candidate_types: null,
    repair_priority: null,
    updated_at: null,
    ...overrides,
  };
}

function poolFor({ canonical = null, legacy = row() } = {}) {
  return {
    async query(_sql, params) {
      const key = params?.[0];
      if (key === SURFACE_KEYS.EXECUTION_POLICY_REGISTRY) return [canonical ? [canonical] : []];
      if (key === "surface.execution_policy_sheet") return [legacy ? [legacy] : []];
      return [[]];
    },
  };
}

test("execution-policy canonical key uses the repository-declared SQL legacy alias only when canonical authority is absent", async () => {
  const result = await resolveSurfaceAuthority(
    SURFACE_KEYS.EXECUTION_POLICY_REGISTRY,
    { requireExecution: true },
    { pool: poolFor() },
  );
  assert.equal(result.ok, true);
  assert.equal(result.code, "surface_authorized");
  assert.equal(result.requested_surface_key, SURFACE_KEYS.EXECUTION_POLICY_REGISTRY);
  assert.equal(result.resolved_surface_key, "surface.execution_policy_sheet");
  assert.equal(result.compatibility_alias_used, true);
  assert.equal(result.compatibility_alias_key, "surface.execution_policy_sheet");
  assert.deepEqual(result.resolution_chain, ["surface.execution_policy_sheet"]);
  assert.equal(result.secrets_included, false);
});

test("canonical execution-policy row wins over the legacy SQL alias", async () => {
  const canonical = row({
    surface_id: SURFACE_KEYS.EXECUTION_POLICY_REGISTRY,
    authority_model: "sql_runtime_authority",
    backend_adapter: "governance_validation_engine.execution_policies",
  });
  const result = await resolveSurfaceAuthority(
    SURFACE_KEYS.EXECUTION_POLICY_REGISTRY,
    { requireExecution: true },
    { pool: poolFor({ canonical }) },
  );
  assert.equal(result.ok, true);
  assert.equal(result.resolved_surface_key, SURFACE_KEYS.EXECUTION_POLICY_REGISTRY);
  assert.equal(result.compatibility_alias_used, false);
  assert.equal(result.compatibility_alias_key, null);
});

test("unknown surface keys and missing legacy rows remain fail-closed", async () => {
  const missingAlias = await resolveSurfaceAuthority(
    SURFACE_KEYS.EXECUTION_POLICY_REGISTRY,
    { requireExecution: true },
    { pool: poolFor({ legacy: null }) },
  );
  assert.equal(missingAlias.ok, false);
  assert.equal(missingAlias.code, "surface_not_found");
  assert.equal(missingAlias.compatibility_alias_used, false);

  const unknown = await resolveSurfaceAuthority(
    "surface.not_registered_anywhere",
    { requireExecution: true },
    { pool: poolFor() },
  );
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "surface_not_found");
  assert.equal(unknown.compatibility_alias_used, false);
});
