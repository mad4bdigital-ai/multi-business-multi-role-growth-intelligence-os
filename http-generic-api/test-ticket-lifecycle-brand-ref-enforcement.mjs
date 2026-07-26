import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");

for (const expected of [
  "explicitBrandRefsFromBody",
  "requireTrustedBrandRefForRemediation",
  "support_ticket_trusted_brand_ref_required",
  "resolveSupportTicketBrandRefs",
  "trustedBrandRef.brand_ref",
  "trustedBrandRef.brand_refs",
]) {
  assert(routes.includes(expected), `support routes must include ${expected}`);
}

const applyRouteIndex = routes.indexOf('/admin/support/tickets/:ticket_id/brand-mapping-remediation"');
const completeRouteIndex = routes.indexOf('/admin/support/tickets/:ticket_id/brand-mapping-remediation/complete"');
assert(applyRouteIndex > -1, "apply route must exist");
assert(completeRouteIndex > -1, "complete route must exist");

const applyBlock = routes.slice(applyRouteIndex, applyRouteIndex + 1400);
const completeBlock = routes.slice(completeRouteIndex, completeRouteIndex + 1600);
assert(applyBlock.includes("requireTrustedBrandRefForRemediation"), "apply route must resolve trusted brand_ref before service call");
assert(applyBlock.includes("applySupportTicketBrandMappingRemediation"), "apply route must still call apply service after guard");
assert(applyBlock.indexOf("requireTrustedBrandRefForRemediation") < applyBlock.indexOf("applySupportTicketBrandMappingRemediation"), "apply guard must run before apply service");

assert(completeBlock.includes("requireTrustedBrandRefForRemediation"), "complete route must resolve trusted brand_ref before service call");
assert(completeBlock.includes("completeSupportTicketBrandMappingRemediation"), "complete route must still call completion service after guard");
assert(completeBlock.indexOf("requireTrustedBrandRefForRemediation") < completeBlock.indexOf("completeSupportTicketBrandMappingRemediation"), "complete guard must run before completion service");

console.log("ticket lifecycle brand ref enforcement tests passed");
