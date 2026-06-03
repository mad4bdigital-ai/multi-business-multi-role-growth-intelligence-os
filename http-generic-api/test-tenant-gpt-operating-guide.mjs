import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingTenantDocsRoutes } from "./routes/tenantDocsRoutes.js";

const { TENANT_SAFE_DOC_ALLOWLIST, normalizeRequestedPath } = _testingTenantDocsRoutes;

assert(TENANT_SAFE_DOC_ALLOWLIST.has("docs/tenant-gpt-operating-guide.md"), "tenant GPT operating guide must be tenant-safe allowlisted");
assert(TENANT_SAFE_DOC_ALLOWLIST.has("schemas/http-generic-api/tenant-capability-registry.json"), "tenant capability registry must be tenant-safe allowlisted");
assert.equal(normalizeRequestedPath("../server.js"), "", "tenant docs must block path traversal");
assert.equal(normalizeRequestedPath("/docs/tenant-gpt-operating-guide.md"), "docs/tenant-gpt-operating-guide.md", "tenant docs should normalize leading slashes");

const guide = readFileSync("docs/tenant-gpt-operating-guide.md", "utf8");
assert(guide.includes("Workspace model"), "guide must explain the workspace model");
assert(guide.includes("Next-best-action rules"), "guide must include next-best-action guidance");
assert(guide.includes("Do not claim a self-service UI exists"), "guide must prevent unsupported capability claims");

const registry = JSON.parse(readFileSync("schemas/http-generic-api/tenant-capability-registry.json", "utf8"));
assert.equal(registry.tenant_facing, true, "capability registry must be tenant-facing");
assert.equal(registry.capabilities.workspace_create.status, "active", "workspace create capability must be active");
assert.equal(registry.capabilities.workspace_member_invitation.status, "active", "member invitations must be active after workspace lifecycle foundation");
assert.equal(registry.capabilities.workspace_access_request.status, "active", "workspace access requests must be active after workspace lifecycle foundation");
assert(registry.capabilities.workspace_member_invitation.tools.includes("workspace_invitation_create"), "invitation capability must expose create tool");
assert(registry.capabilities.workspace_access_request.tools.includes("workspace_access_request_approve"), "access request capability must expose approval tool");
assert.equal(registry.capabilities.wordpress_publish.status, "active", "WordPress publish capability must be active");
assert(registry.role_policy.owner.includes("wordpress_publish"), "owner role policy should include WordPress publish where grant allows it");

console.log("tenant GPT operating guide tests passed");
