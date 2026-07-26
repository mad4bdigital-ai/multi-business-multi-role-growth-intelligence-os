import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");

for (const expected of [
  "resolveApprovedBrandRefSelection",
  "approved_brand_ref_selection",
  "JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.selected_brand_ref'))",
  "selection_hold_id",
  "requireTrustedBrandRefForRemediation",
  "support_ticket_trusted_brand_ref_required",
]) {
  assert(routes.includes(expected), `support routes must include ${expected}`);
}

const helper = routes.slice(routes.indexOf("async function requireTrustedBrandRefForRemediation"), routes.indexOf("function tenantTicketEnvelope"));
assert(helper.includes("explicitBrandRefsFromBody"), "guard must accept explicit brand refs first");
assert(helper.includes("resolveApprovedBrandRefSelection"), "guard must read approved selection holds");
assert(helper.includes("resolveSupportTicketBrandRefs"), "guard must fall back to resolver");
assert(helper.indexOf("explicitBrandRefsFromBody") < helper.indexOf("resolveApprovedBrandRefSelection"), "explicit refs must win before approved selection");
assert(helper.indexOf("resolveApprovedBrandRefSelection") < helper.indexOf("resolveSupportTicketBrandRefs"), "approved selection must be checked before resolver fallback");

for (const route of [
  '/admin/support/tickets/:ticket_id/brand-mapping-remediation/complete',
  '/admin/support/tickets/:ticket_id/brand-mapping-remediation',
]) {
  const index = routes.indexOf(route);
  assert(index > -1, `${route} must exist`);
  const block = routes.slice(index, index + 1700);
  assert(block.includes("requireTrustedBrandRefForRemediation"), `${route} must use trusted brand ref guard`);
  assert(block.includes("trustedBrandRef.brand_ref"), `${route} must pass resolved brand_ref into service`);
}

console.log("ticket lifecycle brand ref selection completion tests passed");
