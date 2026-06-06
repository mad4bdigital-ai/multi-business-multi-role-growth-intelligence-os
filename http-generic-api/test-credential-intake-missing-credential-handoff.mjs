import assert from "node:assert/strict";
import {
  createCredentialIntakeRequirement,
  maybeCreateCredentialIntakeRequirement,
  __test__,
} from "./credentialIntakeEnforcement.js";

function makePool({ apps = [], pending = [], inserted = [] } = {}) {
  return {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, " ");
      if (compact.includes("FROM `app_integrations`")) {
        const [appKey] = params;
        return [apps.filter((row) => row.app_key === appKey).slice(0, 1)];
      }
      if (compact.includes("FROM credential_intake_sessions") && compact.includes("intake_requirement_key")) {
        const [key] = params;
        return [pending.filter((row) => row.key === key).map((row) => ({ session_id: row.session_id, expires_at: row.expires_at })).slice(0, 1)];
      }
      if (compact.includes("INSERT INTO credential_intake_sessions")) {
        inserted.push({ sql: compact, params });
        return [{ affectedRows: 1, insertId: inserted.length }];
      }
      return [[]];
    },
  };
}

assert.equal(__test__.shouldCreateCredentialIntake({ autoIntake: true }, { status: "blocked_missing_secret" }), true);
assert.equal(__test__.inferAuthType({ credentialRole: "ssh_port", appKey: "remote_ssh_runtime" }, {}), "ssh_key_pair");
assert.equal(__test__.inferCredentialField({ credentialRole: "ssh_port", appKey: "remote_ssh_runtime" }, {}, "ssh_key_pair"), "ssh_port");

{
  const inserted = [];
  const pool = makePool({ apps: [{ app_key: "remote_ssh_runtime" }], inserted });
  const result = await createCredentialIntakeRequirement(
    {
      tenantId: "tenant-platform",
      appKey: "remote_ssh_runtime",
      authType: "ssh_key_pair",
      credentialRole: "ssh_port",
      credentialField: "ssh_port",
      systemId: "hostinger-system",
      providerFamily: "hostinger",
      connectorFamily: "hostinger_ssh",
      intakeScope: "platform",
      metadata: { target_id: "target-1" },
    },
    {
      status: "blocked_missing_secret",
      credential_role: "ssh_port",
      credential_ref: "platform_secret:hostinger_ssh_prod_port",
      missing_secret_key: "hostinger_ssh_prod_port",
      owner_type: "platform",
      source: "platform_secrets",
    },
    { pool }
  );
  assert.equal(result.status, "credential_intake_required");
  assert.equal(result.app_key, "remote_ssh_runtime");
  assert.equal(result.auth_type, "ssh_key_pair");
  assert.equal(result.secrets_included, false);
  assert.equal(inserted.length, 1);
  const params = inserted[0].params;
  assert.equal(params[2], "00000000-0000-4000-a000-000000000020", "platform handoff should fall back to platform admin actor");
  assert.equal(params[3], "tenant-platform");
  assert.equal(params[4], "remote_ssh_runtime");
  assert.equal(params[5], "ssh_key_pair");
  const schema = JSON.parse(params[11]);
  assert.equal(schema.fields.length, 1);
  assert.equal(schema.fields[0].name, "ssh_port");
  assert.equal(schema.fields[0].type, "number");
  assert.equal(schema.fields[0].secret, false);
  const metadata = JSON.parse(params[12]);
  assert.equal(metadata.credential_intake_handoff, true);
  assert.equal(metadata.intake_scope, "platform");
  assert.equal(metadata.auto_promote_platform_secrets, true);
  assert.equal(metadata.promotion_approved, true);
  assert.deepEqual(metadata.platform_secret_mappings, [{ credential_field: "ssh_port", secret_key: "hostinger_ssh_prod_port", secret_type: "ssh_port" }]);
  assert.equal(metadata.system_id, "hostinger-system");
  assert.equal(metadata.secrets_must_not_be_returned, true);
}

{
  const inserted = [];
  const pool = makePool({ apps: [{ app_key: "api_key" }], inserted });
  const unavailable = await createCredentialIntakeRequirement(
    { tenantId: "tenant-1", credentialRole: "api_key" },
    { status: "blocked_missing_secret", missing_secret_key: "api_key", owner_type: "tenant" },
    { pool }
  );
  assert.equal(unavailable.status, "credential_intake_unavailable");
  assert.equal(unavailable.reason, "user_id_required");

  const created = await maybeCreateCredentialIntakeRequirement(
    { tenantId: "tenant-1", userId: "user-1", appKey: "api_key", credentialRole: "api_key", autoIntake: true },
    { status: "blocked_missing_secret", missing_secret_key: "api_key", owner_type: "tenant" },
    { pool }
  );
  assert.equal(created.status, "credential_intake_required");
  const metadata = JSON.parse(inserted[0].params[12]);
  assert.equal(metadata.intake_scope, "tenant");
  assert.equal(metadata.auto_promote_platform_secrets, undefined);
}

console.log("credential intake missing credential handoff tests passed");
