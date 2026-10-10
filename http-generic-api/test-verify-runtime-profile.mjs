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
assert.equal(productionJob.split('BACKEND_API_KEY: ${{ secrets.BACKEND_API_KEY }}').length - 1, 2, 'Production key must be resolved inside Production job');

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
