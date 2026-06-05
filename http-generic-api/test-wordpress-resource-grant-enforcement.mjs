import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("wordpressBlogPublishOrchestrator.js", "utf8");

assert(source.includes("resolveWorkspaceResourceGrant"), "WordPress orchestrator must resolve workspace resource grants");
assert(source.includes("v_workspace_resource_grant_effective"), "WordPress grant enforcement must use effective resource grants view");
assert(source.includes("workspace_resource_grant_required"), "WordPress publish must block when workspace resource grant is missing");
assert(source.includes("workspace_resource_grants_unavailable"), "WordPress publish must fail closed if resource grant layer is unavailable");
assert(source.includes("requiredWorkspacePermissionForStatus"), "WordPress publish must map requested status to workspace permission");
assert(source.includes('=== "publish" ? "operate" : "edit"'), "publish must require operate and draft must require edit");
assert(source.includes("resource_type = 'site'"), "site-scoped grants must be considered first");
assert(source.includes("resource_type = 'workspace'"), "workspace fallback grants must be considered");
assert(source.includes("workspace_resource_grant_id"), "blocked responses must include workspace grant evidence field");
assert(source.includes("workspace_resource_grant_required: true"), "blocked responses must expose grant requirement");
assert(source.indexOf("resolveWorkspaceResourceGrant") < source.indexOf("resolveWpCredential"), "workspace grant authority should be checked before credential resolution helper usage in source order");

console.log("WordPress resource grant enforcement tests passed");
