import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('./migrations/176_sprint65_recovery_resource_runtime_alignment.sql', import.meta.url), 'utf8');

assert(migration.includes('recovery_github_ci_failure_classify'), 'migration 176 must add explicit ci_failure_classify recovery rule');
assert(migration.includes("'ci_failure_classify'"), 'ci_failure_classify task class must be covered');
assert(migration.includes('github_ci_failure_classification_plan'), 'GitHub CI failure classification tool must be aligned');
assert(migration.includes("'$.scope_guard_passed', true"), 'read-only wrappers must set scope_guard_passed true');
assert(migration.includes('Scope guard is satisfied by the governed read-only dispatcher wrapper'), 'wrapper scope guard rationale must be documented in registry description');
assert(migration.includes('agent_tool_index'), 'aligned recovery/resource tools must be indexed for governed search');
assert(migration.includes('resource_authority_policy_v1'), 'resource authority tools must remain tied to resource authority policy');
assert(migration.includes('recovery_capability_taxonomy_policy_v1'), 'recovery tools must remain tied to recovery taxonomy policy');

for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /repo\.patch\.apply/i, /github\.pr\.merge/i]) {
  assert(!forbidden.test(migration), `migration 176 must not include destructive or apply operation: ${forbidden}`);
}

console.log('recovery/resource runtime alignment contract tests passed');
