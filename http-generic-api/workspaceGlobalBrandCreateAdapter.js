import { createHash } from "node:crypto";
import {
  canonicalGlobalBrandTargetKey,
  newGlobalBrandIdentity,
  normalizePersistentBrandIdentifier,
} from "./brandIdentityResolver.js";

function text(value, max = 2048) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function stableUuid(...parts) {
  const hex = createHash("sha256")
    .update(parts.map((value) => String(value ?? "")).join("|"), "utf8")
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function normalizeName(value) {
  return text(value, 255).replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export async function readGlobalBrandIdentitySchemaState(executor) {
  try {
    const [columnRows] = await executor.query(
      `SELECT TABLE_NAME, COLUMN_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE()
          AND ((TABLE_NAME='brands' AND COLUMN_NAME IN ('brand_id','identity_status','resource_revision'))
            OR (TABLE_NAME='tenant_brand_links' AND COLUMN_NAME IN ('brand_id','relationship_status','verification_status','claim_id')))`
    );
    const [tableRows] = await executor.query(
      `SELECT TABLE_NAME
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE()
          AND TABLE_NAME IN ('brand_identifiers','brand_identity_aliases','brand_claims','brand_verification_evidence')`
    );
    const columns = new Set((Array.isArray(columnRows) ? columnRows : []).map((row) => `${row.TABLE_NAME || row.table_name}.${row.COLUMN_NAME || row.column_name}`));
    const tables = new Set((Array.isArray(tableRows) ? tableRows : []).map((row) => row.TABLE_NAME || row.table_name));
    const requiredColumns = [
      "brands.brand_id",
      "brands.identity_status",
      "brands.resource_revision",
      "tenant_brand_links.brand_id",
      "tenant_brand_links.relationship_status",
      "tenant_brand_links.verification_status",
      "tenant_brand_links.claim_id",
    ];
    const requiredTables = ["brand_identifiers", "brand_identity_aliases", "brand_claims", "brand_verification_evidence"];
    const missing = [
      ...requiredColumns.filter((key) => !columns.has(key)),
      ...requiredTables.filter((key) => !tables.has(key)).map((key) => `table:${key}`),
    ];
    return Object.freeze({ ready: missing.length === 0, missing, source: "information_schema", secrets_included: false });
  } catch (error) {
    return Object.freeze({
      ready: false,
      missing: ["schema_probe_unavailable"],
      source: "compatibility_fallback",
      error_code: error?.code || null,
      secrets_included: false,
    });
  }
}

async function loadTenantGlobalBrandByName(connection, { tenantId, normalizedName }) {
  const [linkRowsRaw] = await connection.query(
    `SELECT link_id, tenant_id, brand_id, brand_target_key, relationship_status, verification_status, status
       FROM tenant_brand_links
      WHERE tenant_id=? AND status='active' AND brand_id IS NOT NULL
      ORDER BY updated_at DESC, link_id ASC
      LIMIT 101 FOR UPDATE`,
    [tenantId]
  );
  const links = Array.isArray(linkRowsRaw) ? linkRowsRaw : [];
  if (!links.length) return null;
  if (links.length > 100) {
    throw Object.assign(new Error("Workspace has too many active global Brand relationships to resolve create idempotency safely."), {
      status: 409,
      code: "workspace_brand_global_identity_ambiguous",
      details: [{ count: links.length }],
    });
  }
  const ids = [...new Set(links.map((row) => text(row.brand_id, 64)).filter(Boolean))];
  if (!ids.length) return null;
  const [brandRowsRaw] = await connection.query(
    `SELECT id, brand_id, brand_name, normalized_brand_name, target_key, identity_status, resource_revision, status, brand_core_ready
       FROM brands
      WHERE brand_id IN (${ids.map(() => "?").join(",")})
      LIMIT 101 FOR UPDATE`,
    ids
  );
  const linkById = new Map(links.map((row) => [text(row.brand_id, 64), row]));
  const matches = (Array.isArray(brandRowsRaw) ? brandRowsRaw : [])
    .filter((row) => String(row.status || "").toLowerCase() === "active")
    .filter((row) => normalizeName(row.normalized_brand_name || row.brand_name) === normalizedName)
    .filter((row) => linkById.has(text(row.brand_id, 64)));
  if (matches.length > 1) {
    throw Object.assign(new Error("Brand name resolves to multiple active global identities already linked to this workspace."), {
      status: 409,
      code: "workspace_brand_global_identity_ambiguous",
      details: [{ count: matches.length }],
    });
  }
  return matches[0] || null;
}

async function registerIdentifier(connection, { brandId, identifier, actorUserId }) {
  const normalized = normalizePersistentBrandIdentifier(identifier);
  if (!normalized) return null;
  const identifierId = stableUuid(
    "brand-identifier",
    brandId,
    normalized.identifier_type,
    normalized.provider_family,
    normalized.normalized_value_hash
  );
  await connection.query(
    `INSERT INTO brand_identifiers
      (identifier_id, brand_id, identifier_type, normalized_value, normalized_value_hash,
       provider_family, verification_status, confidence_class, exclusive_scope, source, status, revision, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'unverified', ?, 'non_exclusive', ?, 'active', 1, ?)
     ON DUPLICATE KEY UPDATE
       normalized_value=VALUES(normalized_value),
       source=VALUES(source),
       updated_at=CURRENT_TIMESTAMP`,
    [
      identifierId,
      brandId,
      normalized.identifier_type,
      normalized.normalized_value,
      normalized.normalized_value_hash,
      normalized.provider_family,
      normalized.confidence_class,
      normalized.source,
      actorUserId,
    ]
  );
  return identifierId;
}

async function registerLegacyAlias(connection, { brandId, targetKey, actorUserId }) {
  const aliasId = stableUuid("brand-alias", "legacy_target_key", targetKey);
  const aliasHash = createHash("sha256").update(targetKey, "utf8").digest("hex");
  await connection.query(
    `INSERT INTO brand_identity_aliases
      (alias_id, alias_type, alias_value, alias_value_hash, brand_id, status, source, created_by)
     VALUES (?, 'legacy_target_key', ?, ?, ?, 'active', 'workspace_brand_global_create', ?)
     ON DUPLICATE KEY UPDATE
       brand_id=VALUES(brand_id), source=VALUES(source), updated_at=CURRENT_TIMESTAMP`,
    [aliasId, targetKey, aliasHash, brandId, actorUserId]
  );
}

export async function prepareWorkspaceGlobalBrandForCreate(connection, {
  tenantId,
  actorUserId,
  displayName,
  normalizedName,
} = {}) {
  const schema = await readGlobalBrandIdentitySchemaState(connection);
  if (!schema.ready) return null;

  const existing = await loadTenantGlobalBrandByName(connection, {
    tenantId,
    normalizedName: normalizeName(normalizedName || displayName),
  });
  if (existing) {
    return Object.freeze({
      mode: "global_identity_v2",
      created: false,
      brand: existing,
      schema,
      secrets_included: false,
    });
  }

  const identity = newGlobalBrandIdentity();
  const targetKey = canonicalGlobalBrandTargetKey(identity.brand_id);
  await connection.query(
    `INSERT INTO brands
      (brand_id, brand_name, normalized_brand_name, target_key, identity_status, resource_revision, status)
     VALUES (?, ?, ?, ?, 'provisional', 1, 'active')`,
    [identity.brand_id, displayName, normalizeName(normalizedName || displayName), targetKey]
  );
  await registerIdentifier(connection, {
    brandId: identity.brand_id,
    identifier: { type: "brand_name", value: displayName, source: "workspace_brand_global_create" },
    actorUserId,
  });
  await registerLegacyAlias(connection, { brandId: identity.brand_id, targetKey, actorUserId });

  const [readbackRows] = await connection.query(
    `SELECT id, brand_id, brand_name, normalized_brand_name, target_key, identity_status, resource_revision, status, brand_core_ready
       FROM brands
      WHERE brand_id=?
      LIMIT 2 FOR UPDATE`,
    [identity.brand_id]
  );
  if (!Array.isArray(readbackRows) || readbackRows.length !== 1 || String(readbackRows[0].status || "").toLowerCase() !== "active") {
    throw Object.assign(new Error("Created global Brand identity did not resolve exactly once."), {
      status: 409,
      code: "workspace_brand_global_create_readback_invalid",
    });
  }
  return Object.freeze({
    mode: "global_identity_v2",
    created: true,
    brand: readbackRows[0],
    schema,
    secrets_included: false,
  });
}

export const _testingWorkspaceGlobalBrandCreate = Object.freeze({
  stableUuid,
  normalizeName,
  loadTenantGlobalBrandByName,
});
