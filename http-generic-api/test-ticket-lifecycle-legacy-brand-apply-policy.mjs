import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketService.js", "utf8");

for (const expected of [
  "legacyOnlyCandidate",
  "lowConfidenceCandidate",
  "applyPolicyBlocked",
  "support_ticket_legacy_brand_ref_apply_requires_allow_new_ref",
  "legacy_brand_registry_only_requires_allow_new_ref",
  "would_apply_grant: runMode === \"apply\" && !applyPolicyBlocked",
  "allow_new_ref",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

const policyIndex = service.indexOf("const applyPolicyBlocked");
const dryRunIndex = service.indexOf("if (runMode !== \"apply\")", policyIndex);
const applyIndex = service.indexOf("const selection = await approveSupportTicketBrandRefSelection", policyIndex);
assert(policyIndex > -1, "policy block must exist");
assert(dryRunIndex > policyIndex, "policy must be computed before dry-run return");
assert(applyIndex > dryRunIndex, "apply execution must happen after policy/dry-run handling");

const policyBlock = service.slice(policyIndex, applyIndex);
assert(policyBlock.includes("runMode === \"apply\""), "policy only blocks apply mode");
assert(policyBlock.includes("legacyOnlyCandidate"), "policy must require legacy-only evidence");
assert(policyBlock.includes("lowConfidenceCandidate"), "policy must require low confidence");
assert(policyBlock.includes("!allow_new_ref"), "policy must allow explicit new-ref approval override");
assert(policyBlock.includes("throw err"), "blocked policy must throw before mutation");

console.log("ticket lifecycle legacy brand apply policy tests passed");
