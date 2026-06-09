import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketService.js", "utf8");

for (const expected of [
  "requesterUserIdForDiagnostic",
  "metadata?.metadata?.user_id",
  "metadata?.user_id",
  "metadata?.requester_user_id",
  "const requesterUserId = requesterUserIdForDiagnostic(ticket, run)",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

const diagnosticStart = service.indexOf("async function buildDiagnosticStepOutput");
const diagnosticEnd = service.indexOf("export async function executeSupportTicketDiagnosticStep", diagnosticStart);
assert(diagnosticStart > -1 && diagnosticEnd > diagnosticStart, "diagnostic function must exist");
const diagnosticBlock = service.slice(diagnosticStart, diagnosticEnd);
assert(diagnosticBlock.includes("[tenant_id, requesterUserId]"), "diagnostic queries must use resolved requester user id");
assert(!diagnosticBlock.includes("ticket.user_id || run.user_id || \"\""), "diagnostic queries must not ignore ticket metadata user id");

console.log("ticket lifecycle diagnostic requester resolution tests passed");
