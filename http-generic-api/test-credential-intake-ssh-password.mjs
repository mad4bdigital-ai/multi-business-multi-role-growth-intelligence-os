import assert from "node:assert/strict";
import { createCredentialIntakeRequirement, __test__ } from "./credentialIntakeEnforcement.js";

function makePool({ apps = [], inserted = [] } = {}) {
  return {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, " ");
      if (compact.includes("FROM `app_integrations`")) {
        const [appKey] = params;
        return [apps.filter((row) => row.app_key === appKey).slice(0, 1)];
      }
      if (compact.includes("FROM credential_intake_sessions") && compact.includes("intake_requirement_key")) return [[]];
      if (compact.includes("INSERT INTO credential_intake_sessions")) {
        inserted.push({ sql: compact, params });
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  };
}

assert.equal(__test__.inferAuthType({ appKey: "remote_ssh_runtime", credentialRole: "ssh_password" }, {}), "ssh_password");
assert.equal(__test__.inferCredentialField({ credentialRole: "ssh_password" }, {}, "ssh_password"), "ssh_password");

const inserted = [];
const pool = makePool({ apps: [{ app_key: "remote_ssh_runtime" }], inserted });
const result = await createCredentialIntakeRequirement(
  {
    tenantId: "tenant-platform",
    appKey: "remote_ssh_runtime",
    authType: "ssh_password",
    credentialRole: "ssh_password",
    credentialField: "ssh_password",
    credentialLabel: "SSH password",
    intakeScope: "platform",
    metadata: {
      target_id: "target-hostinger",
      raw_secret: "must-not-persist",
      nested: { api_key: "must-not-persist", note: "safe-note" },
      private_key_preview: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
    },
  },
  {
    status: "blocked_missing_secret",
    credential_role: "ssh_password",
    missing_secret_key: "ssh_password",
    owner_type: "platform",
    source: "credential_resolver",
  },
  { pool }
);

assert.equal(result.status, "credential_intake_required");
assert.equal(result.app_key, "remote_ssh_runtime");
assert.equal(result.auth_type, "ssh_password");
assert.equal(result.secrets_included, false);
assert.equal(inserted.length, 1);
const schema = JSON.parse(inserted[0].params[11]);
assert.equal(schema.fields.length, 1);
assert.equal(schema.fields[0].name, "ssh_password");
assert.equal(schema.fields[0].type, "password");
assert.equal(schema.fields[0].secret, true);
const metadata = JSON.parse(inserted[0].params[12]);
assert.equal(metadata.intake_scope, "platform");
assert.equal(metadata.credential_field, "ssh_password");
assert.deepEqual(metadata.platform_secret_mappings, [{ credential_field: "ssh_password", secret_key: "ssh_password", secret_type: "ssh_password" }]);
assert.equal(metadata.secrets_must_not_be_returned, true);

console.log("SSH password credential intake regression passed");
