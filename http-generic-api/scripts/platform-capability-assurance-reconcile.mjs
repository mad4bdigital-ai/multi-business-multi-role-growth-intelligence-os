#!/usr/bin/env node
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const out = { apply: false, envelopeId: "", requestedBy: "platform_admin" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--apply") out.apply = true;
    else if (item === "--capability-envelope-id") out.envelopeId = argv[++i] || "";
    else if (item.startsWith("--capability-envelope-id=")) out.envelopeId = item.slice("--capability-envelope-id=".length);
    else if (item === "--requested-by") out.requestedBy = argv[++i] || out.requestedBy;
    else if (item.startsWith("--requested-by=")) out.requestedBy = item.slice("--requested-by=".length);
  }
  return out;
}

function rowsOf(result) {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

async function count(pool, table) {
  const rows = rowsOf(await pool.query(`SELECT COUNT(*) AS row_count FROM \`${table}\``));
  return Number(rows[0]?.row_count || 0);
}

async function requireApplyEnvelope(pool, envelopeId) {
  if (!envelopeId) throw Object.assign(new Error("--capability-envelope-id is required for --apply"), { code: "capability_envelope_required" });
  const rows = rowsOf(await pool.query(
    `SELECT envelope_id, capability_key, envelope_status, dispatch_allowed, expires_at, secrets_included
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id=? LIMIT 1`,
    [envelopeId]
  ));
  const row = rows[0];
  if (!row) throw Object.assign(new Error("Capability envelope not found"), { code: "capability_envelope_not_found" });
  if (row.envelope_status !== "ready_for_dispatch" || Number(row.dispatch_allowed) !== 1) {
    throw Object.assign(new Error("Capability envelope is not ready for dispatch"), { code: "capability_envelope_not_ready" });
  }
  if (Number(row.secrets_included || 0) !== 0) {
    throw Object.assign(new Error("Secret-bearing capability envelopes are rejected"), { code: "capability_envelope_secret_flagged" });
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error("Capability envelope expired"), { code: "capability_envelope_expired" });
  }
  if (!["platform_capability_assurance_reconcile", "repo_patch_apply"].includes(String(row.capability_key || ""))) {
    throw Object.assign(new Error("Capability envelope is not approved for assurance reconciliation"), { code: "capability_envelope_scope_mismatch" });
  }
  return row;
}

const UPSERTS = [
  `INSERT INTO platform_plugins
     (plugin_key,display_name,plugin_family,source_kind,owner_scope,trust_level,status,source_table,source_key)
   SELECT DISTINCT source_table,REPLACE(source_table,'_',' '),capability_family,'legacy_registry',exposure_scope,'governed',
          CASE WHEN runtime_status='disabled' THEN 'disabled' ELSE 'active' END,source_table,source_table
     FROM v_platform_capabilities_current
   ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),plugin_family=VALUES(plugin_family),owner_scope=VALUES(owner_scope),
     status=VALUES(status),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_plugin_capabilities
     (capability_key,plugin_key,display_name,capability_family,source_table,source_key,operation_class,risk_class,runtime_status,
      exposure_scope,authority_requirement_type,resource_authority_required,dispatch_allowed,apply_allowed,requires_audit_evidence,
      requires_readback,legacy_evidence_ref,metadata_json,status)
   SELECT capability_key,source_table,display_name,capability_family,source_table,source_key,operation_class,risk_class,runtime_status,
          exposure_scope,
          CASE WHEN resource_authority_required=0 THEN 'none'
               WHEN source_table IN ('admin_platform_endpoint_tools','tenant_platform_endpoint_tools') THEN 'invocation'
               WHEN apply_allowed=1 OR risk_class IN ('D','critical') THEN 'combined' ELSE 'resource' END,
          resource_authority_required,dispatch_allowed,apply_allowed,requires_audit_evidence,requires_readback,evidence_ref,
          JSON_OBJECT('legacy_notes',notes,'reconciled_by','platform_capability_assurance_reconcile'),
          CASE WHEN runtime_status='disabled' THEN 'disabled' ELSE 'active' END
     FROM v_platform_capabilities_current
   ON DUPLICATE KEY UPDATE plugin_key=VALUES(plugin_key),display_name=VALUES(display_name),capability_family=VALUES(capability_family),
     source_table=VALUES(source_table),source_key=VALUES(source_key),operation_class=VALUES(operation_class),risk_class=VALUES(risk_class),
     runtime_status=VALUES(runtime_status),exposure_scope=VALUES(exposure_scope),authority_requirement_type=VALUES(authority_requirement_type),
     resource_authority_required=VALUES(resource_authority_required),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
     requires_audit_evidence=VALUES(requires_audit_evidence),requires_readback=VALUES(requires_readback),legacy_evidence_ref=VALUES(legacy_evidence_ref),
     metadata_json=VALUES(metadata_json),status=VALUES(status),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_plugin_bindings
     (binding_key,capability_key,binding_family,source_table,source_key,binding_status,exposure_scope,credential_source,
      dispatch_allowed,apply_allowed,metadata_json)
   SELECT binding_key,capability_key,binding_family,source_table,source_key,binding_status,exposure_scope,credential_source,
          dispatch_allowed,apply_allowed,JSON_OBJECT('legacy_notes',notes)
     FROM v_platform_bindings_current
   ON DUPLICATE KEY UPDATE capability_key=VALUES(capability_key),binding_family=VALUES(binding_family),source_table=VALUES(source_table),
     source_key=VALUES(source_key),binding_status=VALUES(binding_status),exposure_scope=VALUES(exposure_scope),
     credential_source=VALUES(credential_source),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
     metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_plugin_capability_exports
     (export_key,capability_key,export_surface,source_table,source_key,export_status,exposure_scope,http_method,http_path,notes)
   SELECT export_key,capability_key,export_surface,source_table,source_key,export_status,exposure_scope,http_method,http_path,notes
     FROM v_platform_exports_current
   ON DUPLICATE KEY UPDATE capability_key=VALUES(capability_key),export_surface=VALUES(export_surface),source_table=VALUES(source_table),
     source_key=VALUES(source_key),export_status=VALUES(export_status),exposure_scope=VALUES(exposure_scope),http_method=VALUES(http_method),
     http_path=VALUES(http_path),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_capability_source_links
     (link_id,capability_key,source_kind,source_ref,resolution_status,confidence,metadata_json)
   SELECT SHA2(CONCAT(capability_key,'|registry|',source_table,'|',source_key),256),capability_key,'mysql_registry',
          CONCAT(source_table,':',source_key),'resolved',1.0000,
          JSON_OBJECT('source_table',source_table,'source_key',source_key,'reconciled_by','platform_capability_assurance_reconcile')
     FROM v_platform_capabilities_current
   ON DUPLICATE KEY UPDATE resolution_status='resolved',confidence=1.0000,metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_evidence_events
     (evidence_id,evidence_type,subject_type,subject_key,capability_key,envelope_id,source_system,source_ref,evidence_status,
      reason_code,payload_hash,evidence_json,observed_at,expires_at,secrets_included)
   SELECT CONCAT('envelope:',envelope_id,':decision'),'capability_envelope_decision','capability_invocation',envelope_id,
          capability_key,envelope_id,'capability_resolution_envelope_ledger',CONCAT('envelope:',envelope_id),
          CASE WHEN envelope_status IN ('ready_for_dispatch','ready_requires_approval') THEN 'passed'
               WHEN envelope_status='blocked' THEN 'blocked' WHEN envelope_status='expired' THEN 'expired' ELSE 'observed' END,
          decision,envelope_sha256,
          JSON_OBJECT('authority_status',authority_status,'decision',decision,'dispatch_allowed',dispatch_allowed,
                      'apply_allowed',apply_allowed,'blocking_gap_count',blocking_gap_count,'secrets_included',false),
          created_at,expires_at,0
     FROM capability_resolution_envelope_ledger
   ON DUPLICATE KEY UPDATE evidence_status=VALUES(evidence_status),reason_code=VALUES(reason_code),payload_hash=VALUES(payload_hash),
     evidence_json=VALUES(evidence_json),expires_at=VALUES(expires_at),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_capability_envelope_evidence_links (envelope_id,evidence_id,link_role,status)
   SELECT envelope_id,CONCAT('envelope:',envelope_id,':decision'),'decision_evidence','active'
     FROM capability_resolution_envelope_ledger
   ON DUPLICATE KEY UPDATE status='active'`,
  `INSERT INTO platform_evidence_events
     (evidence_id,evidence_type,subject_type,subject_key,binding_id,source_system,source_ref,evidence_status,
      reason_code,payload_hash,evidence_json,observed_at,expires_at,revoked_at,secrets_included)
   SELECT CONCAT('authority-binding:',binding_id,':state'),'resource_binding_state','resource_binding',binding_id,binding_id,
          'platform_resource_authority_bindings',resource_uri,
          CASE WHEN status='active' AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) THEN 'passed'
               WHEN status='revoked' THEN 'revoked' WHEN status='expired' THEN 'expired' ELSE 'blocked' END,
          CONCAT('binding_',status),SHA2(CONCAT(binding_id,'|',status,'|',permission_level,'|',COALESCE(expires_at,'')),256),
          JSON_OBJECT('resource_type',resource_type,'permission_level',permission_level,'status',status,'secrets_included',false),
          created_at,expires_at,CASE WHEN status='revoked' THEN updated_at ELSE NULL END,0
     FROM platform_resource_authority_bindings
   ON DUPLICATE KEY UPDATE evidence_status=VALUES(evidence_status),reason_code=VALUES(reason_code),payload_hash=VALUES(payload_hash),
     evidence_json=VALUES(evidence_json),expires_at=VALUES(expires_at),revoked_at=VALUES(revoked_at),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_capability_certifications
     (certification_id,capability_key,certification_type,environment,subject_type,subject_key,certification_status,
      evidence_id,source_registry,source_key,certified_at,expires_at,metadata_json,secrets_included)
   SELECT CONCAT('runtime:',certification_key),CONCAT('runtime_dispatch_certification.',certification_key),'runtime_dispatch','production',
          'runtime_surface',surface_key,certification_status,CONCAT('certification:',certification_key,':state'),
          'runtime_dispatch_certification_registry',certification_key,last_certified_at,expires_at,
          JSON_OBJECT('dispatch_allowed',dispatch_allowed,'apply_allowed',apply_allowed,'requires_readback',requires_readback,
                      'last_evidence_ref',last_evidence_ref,'secrets_included',false),0
     FROM runtime_dispatch_certification_registry
   ON DUPLICATE KEY UPDATE certification_status=VALUES(certification_status),evidence_id=VALUES(evidence_id),
     certified_at=VALUES(certified_at),expires_at=VALUES(expires_at),metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_evidence_events
     (evidence_id,evidence_type,subject_type,subject_key,capability_key,certification_id,source_system,source_ref,
      evidence_status,reason_code,payload_hash,evidence_json,observed_at,expires_at,secrets_included)
   SELECT CONCAT('certification:',certification_key,':state'),'capability_certification','runtime_surface',surface_key,
          CONCAT('runtime_dispatch_certification.',certification_key),CONCAT('runtime:',certification_key),
          'runtime_dispatch_certification_registry',last_evidence_ref,
          CASE WHEN dispatch_allowed=1 AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) THEN 'passed'
               WHEN expires_at IS NOT NULL AND expires_at<=CURRENT_TIMESTAMP THEN 'expired' ELSE 'blocked' END,
          certification_status,SHA2(CONCAT(certification_key,'|',certification_status,'|',dispatch_allowed,'|',apply_allowed),256),
          JSON_OBJECT('smoke_strategy',smoke_strategy,'requires_readback',requires_readback,'secrets_included',false),
          COALESCE(last_certified_at,created_at),expires_at,0
     FROM runtime_dispatch_certification_registry
   ON DUPLICATE KEY UPDATE evidence_status=VALUES(evidence_status),reason_code=VALUES(reason_code),payload_hash=VALUES(payload_hash),
     evidence_json=VALUES(evidence_json),expires_at=VALUES(expires_at),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_secret_movement_ledger
     (movement_id,source_type,source_id,target_type,target_id,target_field,value_sha256,actor_id,policy_key,
      reason,readback_sha256,movement_status,secrets_included,occurred_at)
   SELECT UUID(),'user_app_connection',m.connection_id,'platform_secret',p.secret_key,'encrypted_value_slot',p.value_sha256,p.created_by,
          'platform_secret_promotion_policy_v1',m.metadata_source,SHA2(CONCAT(p.secret_key,'|',p.value_sha256,'|',p.status),256),
          CASE WHEN m.issue_code IS NULL AND p.status='active' THEN 'verified' ELSE 'observed' END,0,p.created_at
     FROM platform_secrets p
     JOIN v_platform_secret_promotion_monitoring m ON m.secret_key=p.secret_key
    WHERE p.value_sha256 IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM platform_secret_movement_ledger l
                       WHERE l.target_id=p.secret_key AND l.value_sha256=p.value_sha256)`,
  `INSERT INTO platform_capability_debt
     (debt_id,capability_key,gap_key,severity,source_view,status,blocks_dispatch,blocks_apply,recommended_fix,metadata_json)
   SELECT SHA2(CONCAT(capability_key,'|',gap_key),256),capability_key,gap_key,gap_severity,
          'v_platform_capability_assurance_gaps','open',
          CASE WHEN gap_key IN ('dispatch_not_allowed','resource_binding_missing') THEN 1 ELSE 0 END,
          CASE WHEN gap_key IN ('resource_binding_missing','readback_evidence_missing','certification_missing') THEN 1 ELSE 0 END,
          gap_description,JSON_OBJECT('reconciled_by','platform_capability_assurance_reconcile','secrets_included',false)
     FROM v_platform_capability_assurance_gaps
   ON DUPLICATE KEY UPDATE severity=VALUES(severity),status=CASE WHEN platform_capability_debt.status='resolved' THEN 'open' ELSE platform_capability_debt.status END,
     resolved_at=NULL,blocks_dispatch=VALUES(blocks_dispatch),blocks_apply=VALUES(blocks_apply),recommended_fix=VALUES(recommended_fix),
     last_seen_at=CURRENT_TIMESTAMP,metadata_json=VALUES(metadata_json)`,
  `UPDATE platform_capability_debt d
      SET d.status='resolved',d.resolved_at=CURRENT_TIMESTAMP,d.last_seen_at=CURRENT_TIMESTAMP
    WHERE d.source_view='v_platform_capability_assurance_gaps'
      AND d.status IN ('open','in_progress')
      AND NOT EXISTS (SELECT 1 FROM v_platform_capability_assurance_gaps g
                       WHERE g.capability_key=d.capability_key AND g.gap_key=d.gap_key)`
];

export async function reconcilePlatformCapabilityAssurance(args = parseArgs(), deps = {}) {
  const pool = deps.pool || getPool();
  const tables = [
    "platform_plugin_capabilities",
    "platform_capability_source_links",
    "platform_evidence_events",
    "platform_capability_certifications",
    "platform_capability_debt",
  ];
  const before = Object.fromEntries(await Promise.all(tables.map(async (name) => [name, await count(pool, name)])));
  const sourceCount = Number(rowsOf(await pool.query("SELECT COUNT(*) AS row_count FROM v_platform_capabilities_current"))[0]?.row_count || 0);
  if (!args.apply) {
    return {
      ok: true,
      mode: "dry_run",
      source_capability_count: sourceCount,
      current_counts: before,
      estimated_missing_canonical_capabilities: Math.max(0, sourceCount - before.platform_plugin_capabilities),
      apply_requires_capability_envelope: true,
      provider_calls_made: 0,
      external_writes_made: 0,
      secrets_included: false,
    };
  }

  const envelope = await requireApplyEnvelope(pool, args.envelopeId);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const sql of UPSERTS) await connection.query(sql);
    await connection.query(
      `UPDATE capability_resolution_envelope_ledger
          SET execution_ref=?, execution_status='referenced', updated_at=CURRENT_TIMESTAMP
        WHERE envelope_id=?`,
      [`platform_capability_assurance_reconcile:${Date.now()}`, envelope.envelope_id]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const after = Object.fromEntries(await Promise.all(tables.map(async (name) => [name, await count(pool, name)])));
  return {
    ok: true,
    mode: "apply",
    envelope_id: envelope.envelope_id,
    requested_by: args.requestedBy,
    source_capability_count: sourceCount,
    before,
    after,
    readback_verified: after.platform_plugin_capabilities >= sourceCount,
    provider_calls_made: 0,
    external_writes_made: 0,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  reconcilePlatformCapabilityAssurance(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (error) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error.code || "platform_capability_assurance_reconcile_failed", message: error.message }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
