import {
  cleanRequired,
  createSqlExecutor,
  freezeRecord,
  requireUniqueRow,
  toBoolean,
} from "./sqlRepositorySupport.js";

const READINESS_SQL = `
  SELECT
    r.capability_key,
    r.display_name,
    r.capability_family,
    r.source_table,
    r.source_key,
    r.operation_class,
    r.risk_class,
    r.runtime_status,
    r.exposure_scope,
    r.authority_requirement_type,
    r.resource_authority_required,
    r.discoverable,
    r.registered,
    r.exported,
    r.routable,
    r.authority_model_ready,
    r.resource_binding_ready,
    r.dispatchable,
    r.applyable,
    r.readback_contract_ready,
    r.certified,
    r.provenance_ready,
    r.evidence_linked,
    r.dispatch_allowed,
    r.apply_allowed,
    r.requires_audit_evidence,
    r.requires_readback,
    r.legacy_evidence_ref,
    r.hard_block_count
  FROM v_platform_capability_readiness_vector r
  WHERE r.capability_key = ?
  ORDER BY r.capability_key ASC
  LIMIT 2
`;

const MANIFEST_SQL = `
  SELECT
    m.manifest_id,
    m.run_id,
    m.capability_key,
    m.manifest_version,
    m.manifest_hash,
    m.source_revision_hash,
    m.compiler_version,
    m.effect_class,
    m.risk_class,
    m.authority_requirement_type,
    m.status,
    m.rollout_mode,
    m.created_at
  FROM platform_capability_compiled_manifests m
  WHERE m.capability_key = ?
    AND m.is_current = 1
    AND m.status <> 'revoked'
  ORDER BY m.manifest_version DESC, m.created_at DESC
  LIMIT 2
`;

function mapManifest(row) {
  if (!row) return null;
  return freezeRecord({
    manifestRef: row.manifest_id,
    runRef: row.run_id,
    capabilityKey: row.capability_key,
    manifestVersion: Number(row.manifest_version),
    manifestHash: row.manifest_hash,
    sourceRevisionHash: row.source_revision_hash,
    compilerVersion: row.compiler_version,
    effectClass: row.effect_class,
    riskClass: row.risk_class,
    authorityRequirementType: row.authority_requirement_type,
    status: row.status,
    rolloutMode: row.rollout_mode,
    createdAt: row.created_at,
  });
}

function mapReadiness(row, manifest) {
  return freezeRecord({
    capabilityKey: row.capability_key,
    displayName: row.display_name,
    capabilityFamily: row.capability_family,
    sourceTable: row.source_table,
    sourceKey: row.source_key,
    operationClass: row.operation_class,
    riskClass: row.risk_class,
    runtimeStatus: row.runtime_status,
    exposureScope: row.exposure_scope,
    authorityRequirementType: row.authority_requirement_type,
    resourceAuthorityRequired: toBoolean(row.resource_authority_required),
    discoverable: toBoolean(row.discoverable),
    registered: toBoolean(row.registered),
    exported: toBoolean(row.exported),
    routable: toBoolean(row.routable),
    authorityModelReady: toBoolean(row.authority_model_ready),
    resourceBindingReady: toBoolean(row.resource_binding_ready),
    dispatchable: toBoolean(row.dispatchable),
    applyable: toBoolean(row.applyable),
    readbackContractReady: toBoolean(row.readback_contract_ready),
    certified: toBoolean(row.certified),
    provenanceReady: toBoolean(row.provenance_ready),
    evidenceLinked: toBoolean(row.evidence_linked),
    dispatchAllowed: toBoolean(row.dispatch_allowed),
    applyAllowed: toBoolean(row.apply_allowed),
    requiresAuditEvidence: toBoolean(row.requires_audit_evidence),
    requiresReadback: toBoolean(row.requires_readback),
    legacyEvidenceRef: row.legacy_evidence_ref || null,
    hardBlockCount: Number(row.hard_block_count || 0),
    currentManifest: manifest,
  });
}

export function createCapabilityReadinessRepository(options = {}) {
  const sql = createSqlExecutor({ ...options, adapterName: "Capability readiness" });

  async function findCapabilityReadiness({ capabilityKey }) {
    const key = cleanRequired(capabilityKey, "capabilityKey");
    const readinessRows = await sql.execute(READINESS_SQL, [key]);
    const readiness = requireUniqueRow(readinessRows, {
      code: "capability_readiness_ambiguous",
      entityName: "Capability readiness vector",
      details: { capability_key: key },
    });
    if (!readiness) return null;

    const manifestRows = await sql.execute(MANIFEST_SQL, [key]);
    const manifest = requireUniqueRow(manifestRows, {
      code: "capability_manifest_ambiguous",
      entityName: "Current capability manifest",
      details: { capability_key: key },
    });

    return mapReadiness(readiness, mapManifest(manifest));
  }

  return Object.freeze({ findCapabilityReadiness });
}

export const _testingCapabilityReadinessRepository = Object.freeze({
  MANIFEST_SQL,
  READINESS_SQL,
});
