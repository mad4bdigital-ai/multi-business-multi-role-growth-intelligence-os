import assert from "node:assert/strict";
import {
  issueRuntimeDispatchCertification,
  runtimeDispatchCertificationIssueConfirmation,
} from "./runtimeDispatchCertificationIssuer.js";

function buildArgs(overrides = {}) {
  const certification_key = overrides.certification_key || "capability_resolution_envelope_approve_diag_20260707";
  return {
    certification_key,
    surface_key: overrides.surface_key || "capability_resolution_envelope_approve",
    surface_family: overrides.surface_family || "capability_resolution.approval",
    tool_or_action_key: overrides.tool_or_action_key || "capability_resolution_envelope_approve",
    risk_class: overrides.risk_class || "governance_mutation",
    certification_status: overrides.certification_status || "diagnostic_repro",
    smoke_strategy: overrides.smoke_strategy || "envelope_ready_for_dispatch_readback",
    dispatch_allowed: true,
    apply_allowed: false,
    requires_resource_authority: true,
    requires_dry_run: true,
    requires_audit_evidence: true,
    requires_readback: true,
    last_evidence_ref:
      overrides.last_evidence_ref ||
      "Diagnostic evidence: approval envelope reached ready_for_dispatch with approval hold readback and no secrets.",
    notes: overrides.notes || "Regression certification for admin/control alias target.",
    expires_in_days: 1,
    confirm: runtimeDispatchCertificationIssueConfirmation(certification_key),
    ...overrides,
  };
}

function buildPool({ targetRows = [{ source: "admin_platform_endpoint_tools" }] } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (String(sql).includes("AS governed_targets")) {
        return [targetRows];
      }
      if (String(sql).startsWith("INSERT INTO runtime_dispatch_certification_registry")) {
        return [{ affectedRows: 1 }];
      }
      if (String(sql).includes("FROM runtime_dispatch_certification_registry")) {
        const args = buildArgs();
        return [[{
          certification_key: args.certification_key,
          surface_key: args.surface_key,
          surface_family: args.surface_family,
          tool_or_action_key: args.tool_or_action_key,
          risk_class: args.risk_class,
          certification_status: args.certification_status,
          smoke_strategy: args.smoke_strategy,
          dispatch_allowed: 1,
          apply_allowed: 0,
          requires_resource_authority: 1,
          requires_dry_run: 1,
          requires_audit_evidence: 1,
          requires_readback: 1,
          last_evidence_ref: args.last_evidence_ref,
          last_certified_at: new Date("2026-07-07T00:00:00Z"),
          expires_at: new Date("2026-07-08T00:00:00Z"),
          notes: args.notes,
        }]];
      }
      throw new Error(`Unexpected SQL in test pool: ${sql}`);
    },
  };
}

async function testAdminControlAliasCertificationTarget() {
  const pool = buildPool({ targetRows: [{ source: "admin_platform_endpoint_tools" }] });
  const result = await issueRuntimeDispatchCertification(buildArgs(), { pool });
  assert.equal(result.ok, true);
  assert.equal(result.target_source, "admin_platform_endpoint_tools");
  assert.equal(result.readback_verified, true);
  const lookupSql = pool.queries.find((entry) => String(entry.sql).includes("AS governed_targets"))?.sql || "";
  assert.match(lookupSql, /FROM \(\s*SELECT 'admin_platform_endpoint_tools'/);
  assert.doesNotMatch(lookupSql, /LIMIT 1\s+UNION ALL/i);
  assert.match(lookupSql, /ORDER BY source_rank ASC\s+LIMIT 1/);
}

async function testAllowedVirtualToolShortCircuit() {
  const pool = buildPool();
  const result = await issueRuntimeDispatchCertification(
    buildArgs({ tool_or_action_key: "github_pr_finalize", surface_key: "github_pr_finalize" }),
    { pool, allowedToolKeys: ["github_pr_finalize"] }
  );
  assert.equal(result.target_source, "virtual_admin_tool_catalog");
  assert.equal(
    pool.queries.some((entry) => String(entry.sql).includes("AS governed_targets")),
    false,
    "allowed virtual tools should not hit SQL target lookup"
  );
}

async function testMissingTargetReturnsStructuredError() {
  const pool = buildPool({ targetRows: [] });
  await assert.rejects(
    () => issueRuntimeDispatchCertification(buildArgs({ tool_or_action_key: "missing_cert_target" }), { pool }),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(error.code, "runtime_dispatch_certification_target_missing");
      assert.deepEqual(error.details.supported_target_sources, [
        "virtual_admin_tool_catalog",
        "admin_platform_endpoint_tools",
        "tenant_platform_endpoint_tools",
        "endpoints",
      ]);
      assert.equal(error.details.secrets_included, false);
      return true;
    }
  );
}

await testAdminControlAliasCertificationTarget();
await testAllowedVirtualToolShortCircuit();
await testMissingTargetReturnsStructuredError();

console.log("runtime dispatch certification issuer regression tests passed");
