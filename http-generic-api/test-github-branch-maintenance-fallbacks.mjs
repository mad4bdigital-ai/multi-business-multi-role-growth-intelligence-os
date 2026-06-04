import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adminCliRoutes = readFileSync("routes/adminCliRoutes.js", "utf8");

assert(adminCliRoutes.includes("function githubBranchRefUpdateAllowed"), "branch ref update fallback helper must exist");
assert(adminCliRoutes.includes("function assertGithubBranchRefUpdateAllowed"), "branch ref update guard must exist");
assert(adminCliRoutes.includes("githubRefUpdateConfirmation"), "branch ref update must require explicit confirmation");
assert(adminCliRoutes.includes("github_rest_ref_update_protected_branch"), "branch ref update must block protected branches");
assert(adminCliRoutes.includes("github_rest_ref_update_branch_prefix_blocked"), "branch ref update must restrict branch prefixes");
assert(adminCliRoutes.includes("github_rest_ref_update_invalid_sha"), "branch ref update must validate 40-char SHA");
assert(adminCliRoutes.includes("github_rest_ref_update_force_required"), "branch ref update must require force=true");
assert(adminCliRoutes.includes("github_rest_ref_update_confirmation_required"), "branch ref update must require typed confirmation");
assert(adminCliRoutes.includes("allowedBranchRefUpdate"), "GitHub REST fallback must wire branch ref update into allowed mutations");
assert(adminCliRoutes.includes("branchRefUpdate.body"), "GitHub REST fallback must strip confirmation before GitHub API body");
assert(adminCliRoutes.includes("apiTarget === \"/merges\""), "repo merge fallback must remain supported");
assert(adminCliRoutes.includes("/pulls\\/\\d+\\/update-branch"), "PR update-branch fallback must remain supported");
assert(adminCliRoutes.includes("guarded branch ref updates"), "unsupported-path message must document branch ref update support");
assert(!adminCliRoutes.includes("confirm: fieldValues.confirm"), "confirmation must never be forwarded to GitHub API");

console.log("github branch maintenance fallback contract tests passed");
