import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("migrations/288_sprint68_external_delivery_no_send_tool_tag_completion.sql", "utf8");

assert(sql.includes("support_ticket_external_credential_candidates"), "migration must persist the credential candidates tool tag alignment");
assert(sql.includes("no_external_send"), "migration must add/preserve no_external_send tag");
assert(sql.includes("admin_platform_endpoint_tools"), "migration must update the admin tool registry metadata");
assert(/UPDATE\s+admin_platform_endpoint_tools/i.test(sql), "migration should be UPDATE-only metadata alignment");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|INSERT\s+INTO/i.test(sql), "migration must not be destructive or create new dispatch rows");
assert(!/external_send_performed\s*[,=]\s*true/i.test(sql), "migration must not imply any external send was performed");

console.log("external delivery no-send tool tag completion guard passed");
