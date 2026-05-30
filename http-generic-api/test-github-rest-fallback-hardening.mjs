import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adminCliRoutes = readFileSync('routes/adminCliRoutes.js', 'utf8');
const preflight = readFileSync('governedExecutionPreflight.js', 'utf8');

assert(adminCliRoutes.includes('parseGithubApiMethod'), 'GitHub REST fallback must parse -X/--method');
assert(adminCliRoutes.includes('parseGithubFieldValues'), 'GitHub REST fallback must parse -f/--field values');
assert(adminCliRoutes.includes('github_rest_conflict'), 'GitHub REST fallback must classify 409 conflicts');
assert(adminCliRoutes.includes('github_rest_validation_failed'), 'GitHub REST fallback must classify 422 validation errors');
assert(adminCliRoutes.includes('/^\\/pulls\\/\\d+\\/update-branch$/'), 'GitHub REST fallback must allow PR update-branch mutations');
assert(adminCliRoutes.includes('/^\\/pulls\\/\\d+\\/merge$/'), 'GitHub REST fallback must allow PR merge mutations');
assert(adminCliRoutes.includes('githubContentsMutationAllowed'), 'GitHub REST fallback must explicitly gate contents writes');
assert(adminCliRoutes.includes('assertGithubContentsWritePathAllowed'), 'GitHub REST fallback contents writes must use repo path policy');
assert(adminCliRoutes.includes('allowedContentsMutation'), 'GitHub REST fallback must include guarded contents mutation support');
assert(adminCliRoutes.includes('github_rest_contents_workflow_blocked'), 'GitHub REST fallback must block workflow file mutation through contents writes');
assert(adminCliRoutes.includes('github_pr_not_mergeable_dirty'), 'PR merge must classify dirty PRs before merge attempts');
assert(adminCliRoutes.includes('mergeable_state'), 'Dirty PR diagnostics must include mergeable_state evidence');

assert(preflight.includes('pr_mergeable_state'), 'Repository mutation preflight must include PR mergeable_state evidence');
assert(preflight.includes('pull_request_mergeable_state_dirty'), 'Repository mutation preflight must classify dirty PRs explicitly');
assert(preflight.includes('pr_maintainer_can_modify'), 'Repository mutation preflight must include maintainer_can_modify evidence');

console.log('github rest fallback hardening tests passed');
