import {
  cleanRequired,
  createSqlExecutor,
  freezeRecord,
  requireUniqueRow,
  toBoolean,
  unsupportedRepositoryWrite,
} from "./sqlRepositorySupport.js";

const CONTEXT_PIN_SQL = `
  SELECT
    l.resolution_id,
    l.request_id,
    l.idempotency_key,
    l.principal_type,
    l.principal_id,
    l.tenant_id,
    l.target_container_id,
    l.mode,
    l.decision,
    l.authority_epoch,
    l.resolver_version,
    l.request_sha256,
    l.container_path_hash,
    l.registry_snapshot_hash,
    l.resolution_sha256,
    l.provider_call_made,
    l.credential_payload_read,
    l.secrets_included,
    l.expires_at,
    l.created_at
  FROM container_effective_context_ledger l
  WHERE l.tenant_id = ?
    AND l.resolution_id = ?
    AND l.principal_type = ?
    AND l.principal_id = ?
  ORDER BY l.created_at DESC
  LIMIT 2
`;

function mapContextPin(row) {
  if (!row) return null;
  const providerCallMade = toBoolean(row.provider_call_made);
  const credentialPayloadRead = toBoolean(row.credential_payload_read);
  const secretsIncluded = toBoolean(row.secrets_included);
  return freezeRecord({
    pinRef: row.resolution_id,
    requestRef: row.request_id || null,
    idempotencyKey: row.idempotency_key || null,
    principalType: row.principal_type,
    principalRef: row.principal_id,
    tenantRef: row.tenant_id,
    stableRef: row.target_container_id,
    mode: row.mode,
    decision: row.decision,
    authorityEpoch: String(row.authority_epoch),
    resolverVersion: row.resolver_version,
    requestHash: row.request_sha256,
    containerPathHash: row.container_path_hash,
    registrySnapshotHash: row.registry_snapshot_hash,
    contextRevision: row.resolution_sha256,
    providerCallMade,
    credentialPayloadRead,
    secretsIncluded,
    verified:
      ["allow", "restrict"].includes(row.decision) &&
      !providerCallMade &&
      !credentialPayloadRead &&
      !secretsIncluded,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  });
}

export function createContextPinRepository(options = {}) {
  const sql = createSqlExecutor({ ...options, adapterName: "Context pin" });

  async function findContextPin({ tenantRef, pinRef, principalType, principalRef }) {
    const tenant = cleanRequired(tenantRef, "tenantRef");
    const pin = cleanRequired(pinRef, "pinRef");
    const type = cleanRequired(principalType, "principalType");
    const principal = cleanRequired(principalRef, "principalRef");
    const rows = await sql.execute(CONTEXT_PIN_SQL, [tenant, pin, type, principal]);
    const row = requireUniqueRow(rows, {
      code: "context_pin_ambiguous",
      entityName: "Context pin readback",
      details: {
        tenant_ref: tenant,
        pin_ref: pin,
        principal_type: type,
        principal_ref: principal,
      },
    });
    return mapContextPin(row);
  }

  async function createPin() {
    throw unsupportedRepositoryWrite(
      "context_pin_write_unsupported",
      "Context pin persistence requires a dedicated approved write contract and migration.",
    );
  }

  async function invalidatePin() {
    throw unsupportedRepositoryWrite(
      "context_pin_invalidation_unsupported",
      "Context pin invalidation requires a dedicated approved write contract and migration.",
    );
  }

  return Object.freeze({ findContextPin, createPin, invalidatePin });
}

export const _testingContextPinRepository = Object.freeze({
  CONTEXT_PIN_SQL,
});
