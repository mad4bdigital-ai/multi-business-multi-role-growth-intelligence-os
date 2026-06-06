import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/tenant-ssh-dedicated-worker-smoke.mjs", "utf8");
const adminCliRoutes = readFileSync("routes/adminCliRoutes.js", "utf8");

assert(script.includes('tenant_ssh_cli_approval_request_create'), "smoke must create approval through tenant tool dispatcher");
assert(script.includes('tenant_ssh_cli_approval_request_decide'), "smoke must approve through tenant tool dispatcher");
assert(script.includes('tenant_ssh_cli_allowlisted_execute'), "smoke must queue allowlisted execute through tenant tool dispatcher");
assert(script.includes('tenant_ssh_cli_execute_job_result'), "smoke must poll execute job result through tenant tool dispatcher");
assert(script.includes('/jobs/${encodeURIComponent(jobId)}/tick'), "smoke must manually tick queued worker job when running as admin shell");
assert(script.includes('BACKEND_API_KEY'), "manual tick must use backend api key from server env only");
assert(script.includes('INTERNAL_BASE_URL'), "smoke runner must support INTERNAL_BASE_URL when no localhost port is exposed");
assert(script.includes('raw_stdout_returned: false'), "smoke output must not print raw stdout");
assert(script.includes('raw_stderr_returned: false'), "smoke output must not print raw stderr");
assert(script.includes('secrets_included: false'), "smoke output must declare no secrets");
assert(!script.includes('ssh_private_key'), "smoke script must never load or print SSH private keys");

assert(adminCliRoutes.includes('tenant_ssh_dedicated_worker_smoke'), "admin shell allowlist must expose tenant SSH dedicated worker smoke alias");
assert(adminCliRoutes.includes('scripts/tenant-ssh-dedicated-worker-smoke.mjs'), "admin shell alias must point to smoke runner script");
assert(adminCliRoutes.includes('max_extra_args: 8'), "smoke alias must keep extra args bounded");

console.log("Tenant SSH dedicated worker smoke runner guard passed");
