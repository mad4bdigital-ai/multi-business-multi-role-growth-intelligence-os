import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('../.github/workflows/verify-runtime.yml', 'utf8');
const script = readFileSync('verify-runtime.mjs', 'utf8');

const stagingJob = workflow.split('\n  verify-staging:\n')[1]?.split('\n  verify-production:\n')[0] || '';
const productionJob = workflow.split('\n  verify-production:\n')[1] || '';
assert(workflow.includes('  validate-target:'), 'credential-free route validation must precede every authenticated job');
assert(workflow.includes('runtime_target_secret_scope_mismatch'), 'mismatched environment / destination must fail closed');
assert(workflow.includes('staging\\|https://dev.mad4b.com') && workflow.includes('production\\|https://auth.mad4b.com'), 'only exact permitted hostname and environment pairs may receive backend keys');
assert(stagingJob.includes("needs: validate-target") && stagingJob.includes("target == 'staging'"), 'Staging only after validated exact hostname');
assert(!stagingJob.includes('    environment:'), 'Windows staging must retain existing Repository Secret with no environment override');
assert(productionJob.includes("needs: validate-target") && productionJob.includes("target == 'production'"), 'Production only after validated exact hostname');
assert(productionJob.includes('    environment:\\n      name: Production\\n      deployment: false'.replaceAll('\\n','\n')), 'Production must be bound to Environment Production without a deployment');
assert.equal(stagingJob.split('BACKEND_API_KEY: ${{ secrets.BACKEND_API_KEY }}').length - 1, 2, 'Staging must keep existing Repository key references');
assert.equal(productionJob.split('BACKEND_API_KEY: ${{ secrets.HOSTINGER_PRODUCTION_BACKEND_API_KEY }}').length - 1, 2, 'Production key must be resolved inside Production job');

const authProbeJob = workflow.split('\n  probe-production-auth:\n')[1]?.split('\n  verify-staging:\n')[0] || '';
assert(authProbeJob.includes("needs: validate-target") && authProbeJob.includes("target == 'production'"), 'credential probe must require exact Production target');
assert(authProbeJob.includes("inputs.runtime_profile == 'auth_probe_only'"), 'credential probe only runs when explicitly requested');
assert(authProbeJob.includes("    environment:\\n      name: Production\\n      deployment: false".replaceAll("\\n", "\n")), 'probe must use protected Production Environment without deployment');
assert(authProbeJob.includes("secrets.HOSTINGER_PRODUCTION_BACKEND_API_KEY"), 'probe must use isolated Production secret');
assert(authProbeJob.includes("https://auth.mad4b.com/governance/execution-log-latest-inspect"), 'probe target must be a fixed read-only endpoint');
assert(authProbeJob.includes("--output /dev/null") && authProbeJob.includes("--max-redirs 0"), 'probe must suppress response body and reject redirects');
assert(!authProbeJob.includes("POST /") && !authProbeJob.includes("-X POST") && !authProbeJob.includes("tee "), 'probe must never run a write or print response body');
assert(workflow.includes("auth_probe_production_only"), 'probe must reject Staging before reading secrets');
assert(productionJob.includes("inputs.runtime_profile != 'auth_probe_only'"), 'full Production verifier must be skipped in safe probe mode');

assert(authProbeJob.includes("x-api-key: $key"), 'probe must use deterministic backend-service x-api-key path');
assert(authProbeJob.includes("invalid-probe-$(openssl rand -hex 24)"), 'probe must generate an unpredictable invalid-key control');
assert(authProbeJob.includes("binding_control") && authProbeJob.includes("binding_status"), 'probe must compare invalid and configured credentials');
assert(authProbeJob.includes("deployment-info/runtime-binding"), 'probe must prefer dependency-light protected runtime binding');
assert(authProbeJob.includes("inspect_control") && authProbeJob.includes("inspect_status"), 'legacy fallback must compare authenticated and invalid requests to the same endpoint');
assert(authProbeJob.includes("runtime_dependency=degraded"), 'HTTP 500 fallback must not be treated as healthy runtime');
assert(authProbeJob.includes("invalid_key") && authProbeJob.includes("negative_control=403"), 'negative credential must be rejected before accepting candidate');

assert(workflow.includes('runtime_profile:'), 'Verify Runtime workflow must expose runtime_profile input');
assert(workflow.includes('default: "api_only"'), 'Verify Runtime workflow must default to api_only profile');
assert(workflow.includes('EXPECT_QUEUE_AVAILABLE: ${{ inputs.expect_queue_available }}'), 'workflow must pass queue expectation to script');
assert(workflow.includes('EXPECT_WORKER_ENABLED: ${{ inputs.expect_worker_enabled }}'), 'workflow must pass worker expectation to script');
assert(workflow.includes('RUNTIME_PROFILE: ${{ inputs.runtime_profile }}'), 'workflow must pass runtime profile to script');
assert(workflow.includes('default: "false"'), 'execution log row verification should default false for API-only runtime');

assert.equal((script.match(/redirect: "manual"/g) || []).length, 2, 'both authenticated verifier GET and POST must forbid redirect-following');
assert(script.includes('...fetchOptions,\n        redirect: "manual"'), 'GET caller-supplied fetch options must not override redirect rejection');
assert(script.includes('const RUNTIME_PROFILE = String(process.env.RUNTIME_PROFILE || "api_only")'), 'script must default runtime profile to api_only');
assert(script.includes('function parseRuntimeBool'), 'script must use explicit bool parser');
assert(script.includes('defaultForQueue(RUNTIME_PROFILE)'), 'queue expectation must derive from runtime profile');
assert(script.includes('defaultForWorker(RUNTIME_PROFILE)'), 'worker expectation must derive from runtime profile');
assert(script.includes('runtime_profile:'), 'script must log runtime profile');
assert(script.includes('expect_queue_available:'), 'script must log queue expectation');
assert(script.includes('expect_worker_enabled:'), 'script must log worker expectation');
assert(!script.includes('String(process.env.EXPECT_QUEUE_AVAILABLE || "TRUE")'), 'queue expectation must not hard-default to TRUE');
assert(!script.includes('String(process.env.EXPECT_WORKER_ENABLED || "TRUE")'), 'worker expectation must not hard-default to TRUE');

console.log('verify-runtime profile tests passed');
