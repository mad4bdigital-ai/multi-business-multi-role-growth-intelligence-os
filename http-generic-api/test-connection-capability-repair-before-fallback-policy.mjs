import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/204_sprint68_connection_capability_repair_before_fallback_policy.sql", "utf8");

assert(migration.includes("Repair Missing Capability Before Fallback"), "policy key must be stable");
assert(migration.includes("repair_missing_capability_before_fallback"), "policy rule must be explicit");
assert(migration.includes("max_repair_attempts_before_fallback',3") || migration.includes("max_repair_attempts_before_fallback",), "policy must define max repair attempts");
assert(migration.includes("'max_repair_attempts_before_fallback',3"), "policy must cap repair attempts at 3");
assert(migration.includes("fallback_unsupported_command"), "policy must trigger on unsupported fallback commands");
assert(migration.includes("attempt_native_capability_expansion_or_mapping"), "policy must prefer native capability repair/mapping");
assert(migration.includes("retry_original_operation"), "policy must require retrying the original operation after repair");
assert(migration.includes("only_then_use_fallback_or_manual_route"), "policy must allow fallback only after repair sequence");
assert(migration.includes("github_rest_fallback_missing_pr_list"), "policy must capture the GitHub pr list incident as precedent");
assert(migration.includes("blocking"), "policy must be blocking governance");
assert(!migration.includes("client_secret"), "policy must not include secrets");

console.log("connection capability repair-before-fallback policy tests passed");
