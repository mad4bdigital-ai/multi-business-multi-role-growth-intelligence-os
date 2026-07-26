import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./releaseReadiness.js", import.meta.url), "utf8");

assert(source.includes("async function checkApprovalHoldIdentityCollationReadiness()"));
assert(source.includes("v_approval_hold_identity_collation_readiness"));
assert(source.includes("approval_hold_identity_collation_view_missing"));
assert(source.includes("approval_hold_identity_collation_blocked"));
assert(source.includes("approval_hold_identity_collation_check_failed"));
assert(source.includes("expected === 10"));
assert(source.includes("present === 10"));
assert(source.includes("ready === 10"));
assert(source.includes("mismatches === 0"));
assert(source.includes("orphans === 0"));
assert(source.includes("provider_calls"));
assert(source.includes("credential_payload_reads"));
assert(source.includes("external_sends"));
assert(source.includes("external_writes"));
assert(source.includes("secrets_included"));
assert(source.includes('policy_key: "approval_hold_identity_collation_v1"'));
assert(source.includes('required_scope_tokens: ["approval_hold_identity_joins"]'));
assert(source.includes('required_affects_layer_tokens: ["approval_hold_governance_and_growth_intelligence"]'));
assert(source.includes("report.approval_hold_identity_collation_readiness = await checkApprovalHoldIdentityCollationReadinessSafe()"));
assert(source.includes('if (report.approval_hold_identity_collation_readiness.status === "fail") report.overall = "fail"'));

console.log("approval hold identity release readiness test passed");
