function text(value, max = 2048) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function lower(value, max = 2048) {
  return text(value, max).toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function finding(code, details = {}, severity = "warning") {
  return Object.freeze({ code, severity, ...details });
}

export function analyzeBrandIdentityReconciliation({
  brands = [],
  links = [],
  aliases = [],
  identifiers = [],
} = {}) {
  const findings = [];
  const activeBrands = (Array.isArray(brands) ? brands : []).filter((row) => !["archived", "inactive", "disabled"].includes(lower(row.status, 32)));
  const brandsByTargetKey = new Map();
  for (const brand of activeBrands) {
    const brandId = text(brand.brand_id, 128);
    const targetKey = text(brand.target_key, 256);
    if (!brandId) findings.push(finding("brand_missing_canonical_brand_id", { target_key: targetKey || null }, "error"));
    if (!targetKey) continue;
    if (!brandsByTargetKey.has(targetKey)) brandsByTargetKey.set(targetKey, []);
    brandsByTargetKey.get(targetKey).push(brandId);
  }
  for (const [targetKey, ids] of brandsByTargetKey.entries()) {
    const distinct = unique(ids);
    if (distinct.length > 1) findings.push(finding("target_key_maps_to_multiple_brand_ids", { target_key: targetKey, brand_ids: distinct }, "error"));
  }

  for (const link of Array.isArray(links) ? links : []) {
    if (["archived", "revoked"].includes(lower(link.relationship_status, 32))) continue;
    const brandId = text(link.brand_id, 128);
    const targetKey = text(link.brand_target_key, 256);
    if (!brandId && targetKey) {
      findings.push(finding("tenant_brand_link_missing_brand_id", {
        link_id: text(link.link_id, 128) || null,
        tenant_id: text(link.tenant_id, 128) || null,
        brand_target_key: targetKey,
      }, "error"));
      continue;
    }
    if (brandId && targetKey) {
      const expected = unique(brandsByTargetKey.get(targetKey) || []);
      if (expected.length === 1 && expected[0] !== brandId) {
        findings.push(finding("tenant_brand_link_brand_id_target_key_mismatch", {
          link_id: text(link.link_id, 128) || null,
          brand_id: brandId,
          brand_target_key: targetKey,
          expected_brand_id: expected[0],
        }, "error"));
      }
    }
  }

  const aliasOwners = new Map();
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    if (lower(alias.status, 32) !== "active") continue;
    const key = `${lower(alias.alias_type, 64)}|${lower(alias.alias_value_hash, 128)}`;
    const brandId = text(alias.brand_id, 128);
    if (!brandId || key === "|") continue;
    if (!aliasOwners.has(key)) aliasOwners.set(key, []);
    aliasOwners.get(key).push(brandId);
  }
  for (const [aliasKey, ids] of aliasOwners.entries()) {
    const distinct = unique(ids);
    if (distinct.length > 1) findings.push(finding("brand_identity_alias_collision", { alias_key: aliasKey, brand_ids: distinct }, "error"));
  }

  const identifierOwners = new Map();
  for (const identifier of Array.isArray(identifiers) ? identifiers : []) {
    if (lower(identifier.status, 32) !== "active") continue;
    if (lower(identifier.verification_status, 32) !== "verified") continue;
    if (lower(identifier.confidence_class, 32) !== "hard") continue;
    const key = `${lower(identifier.identifier_type, 64)}|${lower(identifier.provider_family, 128)}|${lower(identifier.normalized_value_hash, 128)}`;
    const brandId = text(identifier.brand_id, 128);
    if (!brandId || key === "||") continue;
    if (!identifierOwners.has(key)) identifierOwners.set(key, []);
    identifierOwners.get(key).push(brandId);
  }
  for (const [identifierKey, ids] of identifierOwners.entries()) {
    const distinct = unique(ids);
    if (distinct.length > 1) findings.push(finding("verified_hard_identifier_collision", { identifier_key: identifierKey, brand_ids: distinct }, "critical"));
  }

  return Object.freeze({
    ok: findings.length === 0,
    read_only: true,
    destructive_repair_performed: false,
    finding_count: findings.length,
    findings: Object.freeze(findings),
    inspected: Object.freeze({
      brands: Array.isArray(brands) ? brands.length : 0,
      tenant_brand_links: Array.isArray(links) ? links.length : 0,
      aliases: Array.isArray(aliases) ? aliases.length : 0,
      identifiers: Array.isArray(identifiers) ? identifiers.length : 0,
    }),
    secrets_included: false,
  });
}

export async function readBrandIdentityReconciliationDiagnostics(executor, { limit = 500 } = {}) {
  if (!executor || typeof executor.query !== "function") {
    throw Object.assign(new Error("Brand identity reconciliation SQL executor is unavailable."), {
      code: "brand_identity_reconciliation_executor_unavailable",
      status: 500,
    });
  }
  const boundedLimit = Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 500, 5000));
  const [brands] = await executor.query(
    `SELECT brand_id, target_key, status, identity_status, resource_revision
       FROM brands
      ORDER BY id ASC
      LIMIT ?`,
    [boundedLimit],
  );
  const [links] = await executor.query(
    `SELECT link_id, tenant_id, brand_id, brand_target_key, status, relationship_status, verification_status, revision
       FROM tenant_brand_links
      ORDER BY id ASC
      LIMIT ?`,
    [boundedLimit],
  );
  const [aliases] = await executor.query(
    `SELECT alias_type, alias_value_hash, brand_id, status
       FROM brand_identity_aliases
      ORDER BY id ASC
      LIMIT ?`,
    [boundedLimit],
  );
  const [identifiers] = await executor.query(
    `SELECT identifier_type, provider_family, normalized_value_hash, verification_status,
            confidence_class, brand_id, status
       FROM brand_identifiers
      ORDER BY id ASC
      LIMIT ?`,
    [boundedLimit],
  );
  return analyzeBrandIdentityReconciliation({ brands, links, aliases, identifiers });
}

export const _testingBrandIdentityReconciliation = Object.freeze({ text, lower, unique });
