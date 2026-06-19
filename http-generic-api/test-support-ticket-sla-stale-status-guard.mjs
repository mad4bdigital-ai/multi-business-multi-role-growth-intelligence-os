import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("supportTicketService.js", "utf8");
const start = source.indexOf("function computeTicketSlaStatus");
const end = source.indexOf("export async function reconcileSupportTicketSla", start);
assert(start >= 0 && end > start, "computeTicketSlaStatus must be present before reconcileSupportTicketSla");

const calculator = source.slice(start, end);

assert(
  calculator.includes('return { status: "on_track", reason: "no_due_dates" }'),
  "open tickets without due dates must compute on_track instead of preserving stale stored SLA status"
);

assert.doesNotMatch(
  calculator,
  /if \(!dueDates\.length\) return \{ status: row\.sla_status \|\| "on_track", reason: "no_due_dates" \}/,
  "no_due_dates branch must not reuse row.sla_status"
);

console.log("support ticket stale SLA status guard passed");
