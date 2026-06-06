import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tenantGuide = readFileSync("docs/workspace_lifecycle_tenant_gpt_guide.md", "utf8");
const driveGuide = readFileSync("docs/workspace_drive_operating_model.md", "utf8");

assert(tenantGuide.includes("workspace_invitation_create"), "tenant guide must explain invitation creation");
assert(tenantGuide.includes("workspace_access_request_create"), "tenant guide must explain access requests");
assert(tenantGuide.includes("workspace_member_update"), "tenant guide must explain member updates");
assert(tenantGuide.includes("workspace_ownership_transfer"), "tenant guide must explain ownership transfer");
assert(tenantGuide.includes("admin_workspace_authority_reconciliation"), "tenant guide must explain admin reconciliation");
assert(tenantGuide.includes("Do not remove/demote the last owner") || tenantGuide.includes("Do not remove/demote the last active owner"), "tenant guide must warn about last owner guard");
assert(!tenantGuide.includes("encrypted_credentials"), "tenant guide must not reference raw credential storage");

assert(driveGuide.includes("workspace_vaults"), "Drive guide must reference workspace vaults");
assert(driveGuide.includes("workspace_assets"), "Drive guide must reference workspace assets");
assert(driveGuide.includes("workspace_resource_grants"), "Drive guide must require platform authority checks");
assert(driveGuide.includes("Do not rely only on Drive sharing"), "Drive guide must not treat Drive sharing as sole authority");
assert(driveGuide.includes("07_Sessions"), "Drive guide must include session storage folder");
assert(driveGuide.includes("Never store raw credentials in Drive"), "Drive guide must explicitly forbid raw credentials in Drive");

console.log("workspace lifecycle guides tests passed");
