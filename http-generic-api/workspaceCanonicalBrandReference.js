import { createHash } from "node:crypto";
import {
  publicPersistentBrandIdentityResolution,
  resolvePersistentBrandIdentity,
} from "./brandIdentityResolver.js";
import { readGlobalBrandIdentitySchemaState } from "./workspaceGlobalBrandCreateAdapter.js";

function text(value, max = 2048) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function brandRefError(status, code, message, details = []) {
  return Object.assign(new Error(message), { status, code, details });
}

export function normalizeWorkspaceBrandRef(value) {
  return text(value, 512).replace(/^brand:/iu, "").trim();
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(String(value || ""));
}

async function readV2Brand(connection, brandId, { lock = false } = {}) {
  const [rows] = await connection.query(
    `SELECT brand_id, brand_name, normalized_brand_name, target_key, identity_status, resource_revision, status
       FROM brands
      WHERE brand_id=?
      LIMIT 2${lock ? " FOR UPDATE" : ""}`,
    [brandId]
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw brandRefError(rows?.length ? 409 : 404, rows?.length ? "workspace_brand_identity_ambiguous" : "workspace_brand_not_found", "Canonical Brand identity did not resolve exactly once.");
  }
  if (String(rows[0].status || "").toLowerCase() !== "active") {
    throw brandRefError(409, "workspace_brand_inactive", "Canonical Brand is not active.");
  }
  return rows[0];
}

async function resolveV2BrandIdentity(connection, resourceRef, { lock = false } = {}) {
  const ref = normalizeWorkspaceBrandRef(resourceRef);
  if (!ref) throw brandRefError(400, "workspace_brand_reference_required", "Brand reference is required.");

  let resolution = await resolvePersistentBrandIdentity(connection, {
    brandId: looksLikeUuid(ref) ? ref : null,
    aliases: looksLikeUuid(ref) ? [] : [{ type: "legacy_target_key", value: ref }],
    lock,
  });

  // Compatibility safety: a partially reconciled alias table must not make an
  // otherwise valid target_key unreadable. This read is identity-only and does
  // not infer tenant relationship or authority.
  if (resolution.status === "NONE" && !looksLikeUuid(ref)) {
    const [rows] = await connection.query(
      `SELECT brand_id, target_key, status
         FROM brands
        WHERE BINARY target_key <=> BINARY ?
        LIMIT 3${lock ? " FOR UPDATE" : ""}`,
      [ref]
    );
    const active = (Array.isArray(rows) ? rows : []).filter((row) => String(row.status || "").toLowerCase() === "active" && text(row.brand_id, 64));
    if (active.length === 1) {
      resolution = {
        status: "EXACT",
        brand_id: active[0].brand_id,
        canonical_resource_id: active[0].brand_id,
        candidate_count: 1,
        matched_identifier_types: [],
        matched_alias_types: ["target_key_compatibility"],
        reason: "target_key_compatibility_read",
        disclosure_policy: "canonical_identity_only_no_tenant_enumeration",
        authority_required: true,
        relationship_required: true,
        cross_tenant_details_included: false,
        secrets_included: false,
      };
    } else if (active.length > 1) {
      resolution = { status: "CONFLICT", brand_id: null, candidate_count: active.length, reason: "target_key_non_unique" };
    }
  }

  if (resolution.status !== "EXACT" || !resolution.brand_id) {
    throw brandRefError(
      resolution.status === "CONFLICT" || resolution.status === "AMBIGUOUS" ? 409 : 404,
      `workspace_brand_identity_${String(resolution.status || "NONE").toLowerCase()}`,
      "Brand reference did not resolve to one exact canonical identity.",
      [publicPersistentBrandIdentityResolution(resolution)]
    );
  }
  return {
    resolution: publicPersistentBrandIdentityResolution(resolution),
    brand: await readV2Brand(connection, resolution.brand_id, { lock }),
  };
}

async function requireV2TenantRelationship(connection, { tenantId, brandId, lock = false }) {
  const [rows] = await connection.query(
    `SELECT link_id, tenant_id, brand_id, brand_target_key, relationship_type, relationship_status,
            verification_status, claim_id, status, revision
       FROM tenant_brand_links
      WHERE tenant_id=? AND brand_id=?
      ORDER BY updated_at DESC, link_id ASC
      LIMIT 3${lock ? " FOR UPDATE" : ""}`,
    [tenantId, brandId]
  );
  const relationships = Array.isArray(rows) ? rows : [];
  const active = relationships.filter((row) => String(row.status || "").toLowerCase() === "active" && String(row.relationship_status || "").toLowerCase() === "active");
  if (active.length === 0) {
    if (relationships.length > 0) {
      throw brandRefError(409, "workspace_brand_relationship_not_active", "Brand relationship is not active for this workspace.");
    }
    throw brandRefError(403, "workspace_brand_relationship_required", "Brand is not linked to this workspace.");
  }
  if (active.length !== 1) {
    throw brandRefError(409, "workspace_brand_relationship_ambiguous", "Brand relationship did not resolve uniquely for this workspace.");
  }
  return active[0];
}

async function resolveLegacyWorkspaceBrandReference(connection, { tenantId, resourceRef, lock = false }) {
  const normalizedRef = normalizeWorkspaceBrandRef(resourceRef);
  const [brandRows] = await connection.query(
    `SELECT b.target_key, b.status AS brand_status
       FROM brands b
      WHERE LOWER(b.target_key) = LOWER(?)
         OR LOWER(COALESCE(b.normalized_brand_name, '')) = LOWER(?)
         OR LOWER(COALESCE(b.brand_name, '')) = LOWER(?)
      LIMIT 20${lock ? " FOR UPDATE" : ""}`,
    [normalizedRef, normalizedRef, normalizedRef]
  );
  if (!Array.isArray(brandRows) || brandRows.length === 0) {
    throw brandRefError(404, "workspace_brand_not_found", "Brand resource was not found.");
  }
  if (brandRows.length !== 1) {
    throw brandRefError(409, "workspace_brand_identity_ambiguous", "Brand resource reference did not resolve uniquely.");
  }
  const brand = brandRows[0];
  if (String(brand.brand_status || "").toLowerCase() !== "active") {
    throw brandRefError(409, "workspace_brand_inactive", "Brand resource is not active.");
  }
  const targetKey = text(brand.target_key, 191);
  if (!targetKey) throw brandRefError(422, "workspace_brand_reference_unverifiable", "Brand has no compatibility target key.");
  const [linkRows] = await connection.query(
    `SELECT tenant_id, brand_target_key, status AS link_status
       FROM tenant_brand_links
      WHERE LOWER(brand_target_key)=LOWER(?)
      LIMIT 20${lock ? " FOR UPDATE" : ""}`,
    [targetKey]
  );
  const tenantRows = (Array.isArray(linkRows) ? linkRows : []).filter((row) => String(row.tenant_id || "") === String(tenantId || ""));
  if (tenantRows.length === 0) throw brandRefError(403, "workspace_brand_relationship_required", "Brand is not linked to this workspace.");
  const active = tenantRows.filter((row) => String(row.link_status || "").toLowerCase() === "active");
  if (active.length !== 1) {
    throw brandRefError(active.length ? 409 : 409, active.length ? "workspace_brand_relationship_ambiguous" : "workspace_brand_relationship_not_active", "Brand relationship is not active and unique for this workspace.");
  }
  return {
    identity_mode: "legacy_compatibility",
    brand_id: null,
    target_key: targetKey,
    resource_ref: targetKey,
    brand,
    relationship: active[0],
    identity_resolution: null,
    secrets_included: false,
  };
}

export async function resolveWorkspaceCanonicalBrandReference(connection, {
  tenantId,
  resourceRef,
  lock = false,
} = {}) {
  const schema = await readGlobalBrandIdentitySchemaState(connection);
  if (!schema.ready) {
    return resolveLegacyWorkspaceBrandReference(connection, { tenantId, resourceRef, lock });
  }
  const { resolution, brand } = await resolveV2BrandIdentity(connection, resourceRef, { lock });
  const relationship = await requireV2TenantRelationship(connection, { tenantId, brandId: brand.brand_id, lock });
  return Object.freeze({
    identity_mode: "global_identity_v2",
    brand_id: brand.brand_id,
    target_key: brand.target_key,
    resource_ref: brand.target_key,
    brand,
    relationship,
    identity_resolution: resolution,
    secrets_included: false,
  });
}

export function hashWorkspaceBrandReference(value) {
  return createHash("sha256").update(normalizeWorkspaceBrandRef(value), "utf8").digest("hex");
}

export const _testingWorkspaceCanonicalBrandReference = Object.freeze({
  looksLikeUuid,
  readV2Brand,
  resolveV2BrandIdentity,
  requireV2TenantRelationship,
  resolveLegacyWorkspaceBrandReference,
});
