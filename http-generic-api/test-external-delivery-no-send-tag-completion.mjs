import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("migrations/288_sprint68_external_delivery_no_send_tool_tag_completion.sql", "utf8");

assert(sql.includes("support_ticket_external_credential_candidates"), "migration must target the credential candidates tool");
assert(sql.includes("no_external_send"), "migration must add/preserve no_external_send tag");
assert(sql.includes("admin_platform_endpoint_tools"), "migration must update the governed admin tool registry");
assert(/UPDATE\s+admin_platform_endpoint_tools/i.test(sql), "migration must be registry metadata update only");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(sql), "migration must not be destructive");
assert(!/external_send_performed\s*['\"]?\s*,\s*true/i.test(sql), "migration must not certify any actual external send");

console.log("external delivery no-send tag completion guard passed");
