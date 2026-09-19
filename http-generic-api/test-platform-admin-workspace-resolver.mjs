import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT,
  matchesCanonicalPlatformAdminWorkspace,
  readCanonicalPlatformAdminWorkspaceCandidates,
  resolveCanonicalPlatformAdminWorkspace,
} from "./src/infrastructure/authorityScope/platformAdminWorkspaceResolver.js";

const tenantId = "00000000-0000-0000-0000-000000000000";
const workspaceBase = {
  workspace_id: "11111111-1111-4111-8111-111111111111",
  tenant_id: tenantId,
  display_name: "Platform Admin",
  workspace_type: "brand",
  bootstrap_status: "ready",
};

function createExecutor(workspaceRows) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const statement = String(sql);
      calls.push({ sql: statement, params });
      if (statement.includes("FROM workspace_registry")) {
        assert.match(statement, /workspace_key=\?/u);
        assert.match(statement, /\$\.authority_scope_key/u);
        assert.match(statement, /\$\.platform_admin_workspace/u);
        assert.deepEqual(params, [
          tenantId,
          PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT.workspaceKey,
          PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT.authorityScopeKey,
        ]);
        return [workspaceRows];
      }
      throw new Error(`Unexpected resolver SQL: ${statement}`);
    },
  };
}

const markerCases = [
  {
    name: "workspace_key only",
    row: { ...workspaceBase, workspace_key: "platform_admin_workspace", config_json: "{}" },
  },
  {
    name: "authority_scope_key only",
    row: {
      ...workspaceBase,
      workspace_key: "platform_repo_governance_zero",
      config_json: JSON.stringify({ authority_scope_key: "platform:root" }),
    },
  },
  {
    name: "platform_admin_workspace=true only",
    row: {
      ...workspaceBase,
      workspace_key: "platform_repo_governance_zero",
      config_json: JSON.stringify({ platform_admin_workspace: true }),
    },
  },
];

for (const { name, row } of markerCases) {
  assert.equal(matchesCanonicalPlatformAdminWorkspace(row), true, `${name} must match the canonical marker contract`);
  const executor = createExecutor([row]);
  const resolved = await resolveCanonicalPlatformAdminWorkspace({
    executor,
    tenantId,
    requireReady: true,
  });
  assert.equal(resolved?.workspace_id, workspaceBase.workspace_id, `${name} must resolve the canonical workspace`);
  assert.equal(executor.calls.filter((call) => call.sql.includes("FROM tenants")).length, 0);
  assert.equal(executor.calls.filter((call) => call.sql.includes("FROM workspace_registry")).length, 1);
}

const nonReadyRow = {
  ...workspaceBase,
  workspace_key: "platform_repo_governance_zero",
  bootstrap_status: "in_progress",
  config_json: JSON.stringify({ platform_admin_workspace: true }),
};
assert.equal(matchesCanonicalPlatformAdminWorkspace(nonReadyRow), true);
const nonReadyExecutor = createExecutor([nonReadyRow]);
assert.equal(await resolveCanonicalPlatformAdminWorkspace({
  executor: nonReadyExecutor,
  tenantId,
  requireReady: true,
}), null);

const topologyCandidates = await readCanonicalPlatformAdminWorkspaceCandidates({
  executor: createExecutor([nonReadyRow]),
  tenantIds: [tenantId],
  requireReady: false,
});
assert.equal(topologyCandidates.length, 1);
assert.equal(topologyCandidates[0].bootstrap_status, "in_progress");

const ambiguousExecutor = createExecutor([
  markerCases[0].row,
  { ...markerCases[1].row, workspace_id: "22222222-2222-4222-8222-222222222222", workspace_type: "project" },
]);
await assert.rejects(
  resolveCanonicalPlatformAdminWorkspace({
    executor: ambiguousExecutor,
    tenantId,
    requireReady: true,
  }),
  (error) => error?.code === "platform_admin_workspace_ambiguous"
    && error?.status === 503
    && error?.details?.candidateCount === 2,
);

assert.equal(matchesCanonicalPlatformAdminWorkspace({
  ...workspaceBase,
  workspace_key: "platform_repo_governance_zero",
  config_json: "{}",
}), false);

const globalSentinelExecutor = createExecutor([{
  ...workspaceBase,
  tenant_id: tenantId,
  workspace_key: "platform_repo_governance_zero",
  config_json: JSON.stringify({ authority_scope_key: "platform:root" }),
}]);
const globalSentinelResolved = await resolveCanonicalPlatformAdminWorkspace({
  executor: globalSentinelExecutor,
  tenantId,
  requireReady: true,
});
assert.equal(globalSentinelResolved?.tenant_id, tenantId);
assert.equal(globalSentinelExecutor.calls.some((call) => call.sql.includes("FROM tenants")), false);

const stagingAdapterSource = readFileSync("stagingActivationGatewayApplyAdapter.js", "utf8");
const topologyRepositorySource = readFileSync(
  "src/infrastructure/authorityScope/platformTopologyVerificationRepository.js",
  "utf8",
);
assert.match(stagingAdapterSource, /resolveCanonicalPlatformAdminWorkspace/u);
assert.match(topologyRepositorySource, /readCanonicalPlatformAdminWorkspaceCandidates/u);
for (const source of [stagingAdapterSource, topologyRepositorySource]) {
  assert.doesNotMatch(source, /\$\.platform_admin_workspace/u);
  assert.doesNotMatch(source, /\$\.authority_scope_key/u);
}
assert.doesNotMatch(stagingAdapterSource, /workspace_type='platform_admin'/u);

console.log("Platform Admin Workspace canonical resolver tests passed.");
