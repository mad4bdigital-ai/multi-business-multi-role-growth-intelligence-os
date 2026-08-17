import assert from "node:assert/strict";
import {
  CONTROL_PLANE_WRITE_IDENTITY_CONTRACT,
  controlPlaneWriteAuthorityEnabled,
  resolveControlPlaneWriteDbConfig,
} from "./controlPlaneWriteAuthority.js";

assert.equal(CONTROL_PLANE_WRITE_IDENTITY_CONTRACT.dedicated_identity_required, true);
assert.equal(CONTROL_PLANE_WRITE_IDENTITY_CONTRACT.root_identity_rejected, true);
assert.equal(controlPlaneWriteAuthorityEnabled({ CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "false" }), false);

const fallback = resolveControlPlaneWriteDbConfig({
  DB_NAME: "growth_runtime",
  DB_USER: "runtime_reader",
  CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "false",
});
assert.equal(fallback.enabled, false);
assert.equal(fallback.source, "runtime_db_fallback_disabled");

assert.throws(
  () => resolveControlPlaneWriteDbConfig({ CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "true" }),
  (error) => error.code === "CONTROL_PLANE_WRITE_DB_CONFIG_MISSING" && error.details?.secrets_included === false,
);

const valid = resolveControlPlaneWriteDbConfig({
  CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "true",
  CONTROL_PLANE_WRITE_DB_HOST: "db",
  CONTROL_PLANE_WRITE_DB_NAME: "growth_control_plane",
  CONTROL_PLANE_WRITE_DB_USER: "control_plane_writer",
  CONTROL_PLANE_WRITE_DB_PASSWORD: "fixture-password",
  DB_USER: "runtime_reader",
});
assert.equal(valid.enabled, true);
assert.equal(valid.user, "control_plane_writer");
assert.equal(valid.database, "growth_control_plane");
assert.equal(valid.secrets_included, undefined);

assert.throws(
  () => resolveControlPlaneWriteDbConfig({
    CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "true",
    CONTROL_PLANE_WRITE_DB_HOST: "db",
    CONTROL_PLANE_WRITE_DB_NAME: "growth_control_plane",
    CONTROL_PLANE_WRITE_DB_USER: "runtime_reader",
    CONTROL_PLANE_WRITE_DB_PASSWORD: "fixture-password",
    DB_USER: "runtime_reader",
  }),
  (error) => error.code === "CONTROL_PLANE_WRITE_DB_IDENTITY_NOT_DEDICATED",
);

assert.throws(
  () => resolveControlPlaneWriteDbConfig({
    CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "true",
    CONTROL_PLANE_WRITE_DB_HOST: "db",
    CONTROL_PLANE_WRITE_DB_NAME: "growth_control_plane",
    CONTROL_PLANE_WRITE_DB_USER: "root",
    CONTROL_PLANE_WRITE_DB_PASSWORD: "fixture-password",
  }),
  (error) => error.code === "CONTROL_PLANE_WRITE_DB_IDENTITY_INVALID",
);

console.log("test-control-plane-write-authority: ok");
