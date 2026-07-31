import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('../.github/workflows/governed-local-connector-production-closure.yml', 'utf8');
const runner = readFileSync('../.github/scripts/governed-local-connector-production-closure.mjs', 'utf8');
const runbook = readFileSync('../docs/governed-local-connector-production-closure.md', 'utf8');

assert.match(workflow, /issue_comment:\s*\n\s*types: \[created\]/, 'closure workflow must use the default-branch issue_comment event');
assert(workflow.includes("github.actor == 'mad4bdigital-ai'"), 'closure workflow must allow only the repository administrator actor');
assert(workflow.includes("github.event.comment.body == '/run-local-connector-production-closure'"), 'closure workflow must require the exact bounded command');
assert(workflow.includes('github.event.issue.pull_request != null'), 'closure workflow must reject non-PR issue comments');
assert(workflow.includes('issues: write'), 'closure workflow must publish bounded start/outcome evidence');
assert(workflow.includes('cancel-in-progress: false'), 'duplicate closure requests must serialize instead of interrupting accepted repair work');
assert(workflow.includes('BACKEND_API_KEY: ${{ secrets.BACKEND_API_KEY }}'), 'closure workflow must use the repository secret without embedding its value');
assert(workflow.includes('timeout-minutes: 35'), 'closure workflow must remain time bounded');
assert(workflow.includes('retention-days: 30'), 'closure evidence retention must remain bounded');

assert(runner.includes("pull?.base?.ref === 'Production'"), 'runner must require a merged Production PR');
assert(runner.includes('pull?.merged === true || Boolean(pull?.merged_at)'), 'runner must reject unmerged PRs');
assert(runner.includes('/git/ref/heads/Production'), 'runner must resolve the current protected Production ref in the same cycle');
assert(runner.includes(`/compare/\${releaseSha}...\${productionSha}`), 'runner must prove the release merge is contained by Production');
assert(runner.includes('/health'), 'runner must verify runtime health');
assert(runner.includes('/version'), 'runner must verify deployment version evidence');
assert(runner.includes('/deployment-info'), 'runner must verify deployment manifest evidence');
assert(runner.includes('/connector-agent/version'), 'runner must verify the deployed connector-agent surface');
assert(runner.includes('/admin/cli/local-connector/self-repair'), 'runner must use the governed self-repair diagnosis');
assert(runner.includes("action: 'repair_connector'"), 'runner must use the existing Local Manager repair action');
assert(runner.includes('/local-manager/device/desktop-commands'), 'runner must enqueue and read back the desktop repair command');
assert(runner.includes('recent_watchdog_heartbeat'), 'runner must require fresh watchdog heartbeat evidence');
assert(runner.includes('registered_route_count'), 'runner must require registered route evidence');
assert(runner.includes('healthy_cloudflare_route'), 'runner must require a healthy Cloudflare route');
assert(runner.includes('sql_executed: false'), 'runner must declare that no SQL is executed');
assert(runner.includes('direct_database_command_executed: false'), 'runner must declare that no direct DB command is executed');
assert(runner.includes('secrets_included: false'), 'runner must keep evidence secret-safe');
assert(!runner.includes('node:child_process'), 'runner must not execute shell or arbitrary process commands');
assert(!runner.includes('mysql'), 'runner must not open a direct database path');
assert(!runner.includes('console.log(backendKey'), 'runner must not log the backend API key');

assert(runbook.includes('Only the repository administrator account `mad4bdigital-ai` may trigger the workflow.'), 'runbook must document the actor boundary');
assert(runbook.includes('its base branch is exactly `Production`'), 'runbook must document the protected release boundary');
assert(runbook.includes('If those conditions already pass, no repair command is created.'), 'runbook must document mutation avoidance');
assert(runbook.includes('does not accept arbitrary shell or SQL'), 'runbook must document shell and SQL prohibition');
assert(runbook.includes('claim success from an enqueued or claimed command'), 'runbook must require final readback rather than accepted work');

console.log('governed-local-connector-production-closure-workflow: ok');
