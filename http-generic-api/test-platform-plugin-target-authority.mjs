import assert from "node:assert/strict";
import { resolvePlatformManagedTargetAuthority } from "./platformPluginTargetAuthority.js";

function poolWithRows(rows = [], { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (fail) throw new Error("authority store unavailable");
      return [rows];
    },
  };
}

{
  const pool = poolWithRows([]);
  const decision = await resolvePlatformManagedTargetAuthority({
    pool,
    credentialSource: "user_connection",
    tenantId: "tenant-1",
    userId: "user-1",
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.required, false);
  assert.equal(decision.state, "not_applicable");
  assert.equal(decision.lookup_attempted, false);
  assert.equal(pool.calls.length, 0);
}

{
  const pool = poolWithRows([]);
  const decision = await resolvePlatformManagedTargetAuthority({
    pool,
    credentialSource: "platform_managed",
    principalClass: "tenant",
    tenantId: "tenant-1",
    userId: "user-1",
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "credential_target_authority_required");
  assert.equal(decision.denial_code, "CREDENTIAL_TARGET_AUTHORITY_REQUIRED");
  assert.equal(decision.lookup_attempted, false);
  assert.equal(pool.calls.length, 0);
}

{
  const pool = poolWithRows([]);
  const decision = await resolvePlatformManagedTargetAuthority({
    pool,
    credentialSource: "platform_managed",
    principalClass: "tenant",
    tenantId: "tenant-1",
    userId: "user-1",
    targetResourceType: "github_repo",
    targetResourceUri: "github://other-org/private-repo",
    targetMode: "read_only",
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "credential_target_not_authorized");
  assert.equal(decision.denial_code, "CREDENTIAL_TARGET_NOT_AUTHORIZED");
  assert.equal(decision.lookup_attempted, true);
  assert.match(decision.target_reference_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(decision).includes("other-org/private-repo"), false);
  assert.deepEqual(pool.calls[0].params, [
    "github_repo",
    "github://other-org/private-repo",
    "tenant-1",
    "user-1",
  ]);
}

{
  const pool = poolWithRows([{
    permission_level: "read_only",
    allowed_modes_json: JSON.stringify(["read_only", "diagnostic"]),
    authority_source: "admin_grant",
    tenant_id: "tenant-1",
    workspace_id: null,
    user_id: null,
  }]);
  const decision = await resolvePlatformManagedTargetAuthority({
    pool,
    credentialSource: "platform_managed",
    principalClass: "tenant",
    tenantId: "tenant-1",
    userId: "user-1",
    targetResourceType: "github_repo",
    targetResourceUri: "github://mad4bdigital-ai/repo",
    targetMode: "read_only",
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.state, "pass");
  assert.equal(decision.reason, "credential_target_authorized");
  assert.equal(decision.lookup_attempted, true);
  assert.equal(decision.authority_binding_present, true);
  assert.equal(decision.permission_level, "read_only");
  assert.equal(decision.secrets_included, false);
}

{
  const pool = poolWithRows([{
    permission_level: "read_only",
    allowed_modes_json: JSON.stringify(["read_only"]),
    authority_source: "admin_grant",
  }]);
  const decision = await resolvePlatformManagedTargetAuthority({
    pool,
    credentialSource: "platform_managed",
    tenantId: "tenant-1",
    userId: "user-1",
    targetResourceType: "github_repo",
    targetResourceUri: "github://mad4bdigital-ai/repo",
    targetMode: "patch",
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "credential_target_mode_not_allowed");
  assert.equal(decision.denial_code, "CREDENTIAL_TARGET_MODE_NOT_ALLOWED");
}

{
  const pool = poolWithRows([], { fail: true });
  const decision = await resolvePlatformManagedTargetAuthority({
    pool,
    credentialSource: "platform_managed",
    tenantId: "tenant-1",
    userId: "user-1",
    targetResourceType: "github_repo",
    targetResourceUri: "github://mad4bdigital-ai/repo",
    targetMode: "read_only",
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "credential_target_authority_unavailable");
  assert.equal(decision.denial_code, "CREDENTIAL_TARGET_AUTHORITY_UNAVAILABLE");
  assert.equal(decision.lookup_attempted, true);
}

{
  const decision = await resolvePlatformManagedTargetAuthority({
    pool: poolWithRows([]),
    credentialSource: "platform_managed",
    principalClass: "admin",
    targetMode: "read_only",
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.required, false);
  assert.equal(decision.reason, "platform_admin_unscoped_read_only_target_not_required");
}

console.log("platform plugin target authority tests passed");
