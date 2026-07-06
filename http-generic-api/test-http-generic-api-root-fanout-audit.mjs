import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const audit = readFileSync(new URL("./scripts/http-generic-api-root-fanout-audit.mjs", import.meta.url), "utf8");

assert.match(audit, /HTTP_GENERIC_API_MAX_ROOT_ENTRIES/);
assert.match(audit, /HTTP_GENERIC_API_ROOT_ENTRY_CEILING/);
assert.match(audit, /github_web_ui_truncation_risk/);
assert.match(audit, /script_candidate/);
assert.match(audit, /test_candidate/);
assert.match(audit, /service_candidate/);
assert.match(audit, /resolver_candidate/);
assert.match(audit, /openapi_candidate/);
assert.match(audit, /--fail-on-regression/);
assert.doesNotMatch(audit, /rm\s+-rf|unlinkSync|writeFileSync|renameSync|execSync/);

console.log("http-generic-api root fanout audit guard passed");
