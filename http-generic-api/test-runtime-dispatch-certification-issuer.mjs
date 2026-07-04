import assert from "node:assert/strict";
import {
  issueRuntimeDispatchCertification,
  runtimeDispatchCertificationIssueConfirmation,
} from "./runtimeDispatchCertificationIssuer.js";

function makePool({ targetRows = [{ source: "virtual_admin_tool_catalog" }], readbackOverride = null } = {}) {
  const calls = [];
  let stored = null;
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("FROM admin_platform_endpoint_tools")) return [targetRows];
      if (String(sql).startsWith("INSERT INTO runtime_dispatch_certification_registry")) {
        stored = {
          certification_key: params[0],
          surface_key: params[1],
          surface_family: params[2],
          tool_or_action_key: params[3],
          risk_class: params[4],
          certification_status: params[5],
          smoke_strategy: params[6],
          dispatch_allowed: params[7],
          apply_allowed: params[8],
          requires_resource_authority: params[9],
          requires_dry_run: params[10],
          requires_audit_evidence: params[11],
          requires_readback: params[12],
          last_evidence_ref: params[13],
          last_certified_at: new Date(),
          expires_at: new Date(Date.now() + 86400000),
          notes: params[14],
        };
        return [{ affectedRows: 1 }];
      }
      if (String(sql).includes("FROM runtime_dispatch_certification_registry")) return [[readbackOverride || stored]];
      throw new Error(`Unexpected SQL: ${String(sql).slice(0, 120)}`);
    },
  };
}

const baseArgs = {
  certification_key: "github_pr_finalize_ci_certified_v1",
  surface_key: "github_pr_finalize",
  surface_family: "github",
  tool_or_action_key: "github_pr_finalize",
  risk_class: "D",
  certification_status: "ci_certified",
  smoke_strategy: "github_pr_ci_gate_required_checks_and_finalize_ancestry_readback",
  dispatch_allowed: true,
  apply_allowed: false,
  requires_resource_authority: true,
  requires_dry_run: true,
  requires_audit_evidence: true,
  requires_readback: true,
  last_evidence_ref: "PR 2083 CI pass on required checks for a pinned head SHA",
  expires_in_days: 30,
  notes: "No secrets. Dispatch certification only.",
};

assert.equal(
  runtimeDispatchCertificationIssueConfirmation(baseArgs.certification_key),
  "ISSUE_RUNTIME_DISPATCH_CERTIFICATION_GITHUB_PR_FINALIZE_CI_CERTIFIED_V1"
);

let pool = makePool();
let result = await issueRuntimeDispatchCertification(
  { ...baseArgs, confirm: runtimeDispatchCertificationIssueConfirmation(baseArgs.certification_key) },
  { pool, allowedToolKeys: ["github_pr_finalize"] }
);
assert.equal(result.ok, true);
assert.equal(result.certification_key, baseArgs.certification_key);
assert.equal(result.certification.apply_allowed, 0);
assert.equal(result.readback_verified, true);
assert.equal(pool.calls.some((call) => call.sql.includes("runtime_dispatch_certification_registry")), true);
assert.equal(pool.calls.every((call) => !call.sql.includes("platform_resource_authority_bindings")), true);

await assert.rejects(
  () => issueRuntimeDispatchCertification(
    { ...baseArgs, apply_allowed: true, confirm: runtimeDispatchCertificationIssueConfirmation(baseArgs.certification_key) },
    { pool: makePool(), allowedToolKeys: ["github_pr_finalize"] }
  ),
  /cannot grant apply_allowed=true/
);

await assert.rejects(
  () => issueRuntimeDispatchCertification(
    { ...baseArgs, confirm: "WRONG" },
    { pool: makePool(), allowedToolKeys: ["github_pr_finalize"] }
  ),
  /requires confirm=/
);

await assert.rejects(
  () => issueRuntimeDispatchCertification(
    { ...baseArgs, tool_or_action_key: "missing_tool", confirm: runtimeDispatchCertificationIssueConfirmation(baseArgs.certification_key) },
    { pool: makePool({ targetRows: [] }), allowedToolKeys: [] }
  ),
  /does not resolve/
);

await assert.rejects(
  () => issueRuntimeDispatchCertification(
    { ...baseArgs, last_evidence_ref: "too short", confirm: runtimeDispatchCertificationIssueConfirmation(baseArgs.certification_key) },
    { pool: makePool(), allowedToolKeys: ["github_pr_finalize"] }
  ),
  /last_evidence_ref/
);

console.log("runtime dispatch certification issuer tests passed");
