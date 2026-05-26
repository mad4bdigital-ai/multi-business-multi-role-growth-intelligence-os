import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync('scripts/openapi-autofill-missing-routes.mjs', 'utf8');
const workflow = readFileSync('../.github/workflows/openapi-auto-sync.yml', 'utf8');

assert(script.includes('openapi-autofill-missing-routes'), 'script path should be identifiable from workflow usage');
assert(script.includes('ROUTE_FILE_RE'), 'autofill must parse express route declarations');
assert(script.includes('ALLOWLIST_PATH'), 'autofill must honor openapi route coverage allowlist');
assert(script.includes('operationIdFor'), 'autofill must create stable operationIds');
assert(script.includes('x-openai-isConsequential'), 'autofill must mark consequential operations');
assert(script.includes('TODO document'), 'autofill stubs must be clearly review-required');
assert(script.includes('#/components/schemas/ErrorResponse'), 'autofill stubs must use shared structured error schema');
assert(script.includes('process.argv.includes("--write")'), 'autofill must require --write for mutation');
assert(script.includes('process.argv.includes("--check")'), 'autofill must support check mode');

assert(workflow.includes('name: OpenAPI Auto Sync'), 'workflow must exist');
assert(workflow.includes('branches:\n      - main'), 'workflow must run on pushes to main');
assert(workflow.includes('workflow_dispatch'), 'workflow must support manual dispatch');
assert(workflow.includes('node scripts/openapi-autofill-missing-routes.mjs --write'), 'workflow must run autofill generator');
assert(workflow.includes('peter-evans/create-pull-request@v6'), 'workflow must create a PR instead of pushing directly to main');
assert(workflow.includes('Do not merge this PR as-is'), 'workflow PR body must require human/GPT review of generated stubs');
assert(!workflow.includes('git push origin main'), 'workflow must not push generated stubs directly to main');

console.log('openapi autofill automation tests passed');
