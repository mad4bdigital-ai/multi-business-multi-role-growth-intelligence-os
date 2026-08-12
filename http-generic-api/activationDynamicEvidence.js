import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import * as legacy from "./activationDynamicEvidenceLegacy.js";
import { resolveActivationCanonicalReferences } from "./canonicalResourceRegistry.js";

export * from "./activationDynamicEvidenceLegacy.js";

function sha256Text(value = "") {
  return createHash("sha256").update(String(value)).digest("hex");
}

function compactError(err) {
  return { code: err?.code || "dynamic_activation_evidence_failed", message: err?.message || String(err) };
}

async function inspectRegistryReference(repoRoot, contract = {}) {
  const relativePath = String(contract?.path || "").trim();
  try {
    const fullPath = path.join(repoRoot, relativePath);
    const content = await fs.readFile(fullPath, "utf8");
    let validationOk = Buffer.byteLength(content, "utf8") > 0;
    let jsonValid;
    let generatedMarkerOk;
    if (contract.validation_strategy === "json_valid" || relativePath.endsWith(".json")) {
      JSON.parse(content);
      jsonValid = true;
    }
    if (contract.validation_strategy === "generated_canonical") {
      generatedMarkerOk = content.startsWith("<!-- GENERATED FILE.");
      validationOk = validationOk && generatedMarkerOk;
    }
    return {
      resource_key: contract.resource_key || null,
      path: relativePath,
      resource_class: contract.resource_class || null,
      load_strategy: contract.load_strategy || null,
      validation_strategy: contract.validation_strategy || "exists_nonempty",
      required_at_activation: contract.required_at_activation === true,
      searchable: contract.searchable === true,
      exists: true,
      ok: validationOk,
      size_bytes: Buffer.byteLength(content, "utf8"),
      sha256: sha256Text(content),
      ...(jsonValid === true ? { json_valid: true } : {}),
      ...(generatedMarkerOk !== undefined ? { generated_marker_ok: generatedMarkerOk } : {}),
    };
  } catch (err) {
    return {
      resource_key: contract.resource_key || null,
      path: relativePath,
      resource_class: contract.resource_class || null,
      required_at_activation: contract.required_at_activation === true,
      exists: false,
      ok: false,
      error: compactError(err),
    };
  }
}

export async function buildRepoCanonicalRuntimeEvidence(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const registry = await resolveActivationCanonicalReferences(options, options.deps || {});
  const requiredReferences = await Promise.all(
    (registry.resource_contracts || []).map((contract) => inspectRegistryReference(repoRoot, contract)),
  );

  // Reuse the mature canonical-family integrity checks while replacing its fixed
  // required-reference decision with the SQL-authoritative registry decision.
  const legacyEvidence = await legacy.buildRepoCanonicalRuntimeEvidence(options);
  const canonicalFamilies = Array.isArray(legacyEvidence?.canonical_families)
    ? legacyEvidence.canonical_families
    : [];
  const staleOrMissingReferences = requiredReferences.filter((item) => item.ok !== true);
  const staleOrMissingFamilies = canonicalFamilies.filter((item) => item.ok !== true);
  const staleOrMissingCount = staleOrMissingReferences.length + staleOrMissingFamilies.length;

  return {
    attempted: true,
    ok: staleOrMissingCount === 0,
    activation_layer: "repo_canonical_runtime_readback",
    evidence_source: registry.legacy_fallback_used
      ? "legacy_fallback_plus_repo_filesystem_canonical_manifest_readback"
      : "sql_canonical_resource_registry_plus_repo_filesystem_readback",
    source_authority: registry.legacy_fallback_used
      ? "legacy_required_reference_fallback_and_canonical_manifest"
      : "canonical_resource_registry_and_canonical_manifest",
    canonical_registry_source: registry.source,
    canonical_registry_revision: Number(registry.registry_revision || 0),
    canonical_registry_environment_scope: registry.environment_scope || null,
    canonical_registry_legacy_fallback_used: registry.legacy_fallback_used === true,
    canonical_registry_parity_required_before_fallback_retirement:
      registry.parity_required_before_fallback_retirement === true,
    required_reference_count: requiredReferences.length,
    checked_reference_count: requiredReferences.length,
    searchable_resource_count: Array.isArray(registry.searchable_resources)
      ? registry.searchable_resources.length
      : 0,
    canonical_family_count: canonicalFamilies.length,
    generated_family_count: canonicalFamilies.filter((item) => item.generated_marker_ok).length,
    source_file_count: Number(legacyEvidence?.source_file_count || 0),
    stale_or_missing_count: staleOrMissingCount,
    required_references: requiredReferences,
    canonical_families: canonicalFamilies,
    reason_code: staleOrMissingCount === 0
      ? null
      : staleOrMissingReferences.length > 0
        ? "canonical_resource_missing_or_invalid"
        : "repo_canonical_evidence_stale_or_missing",
    secrets_included: false,
  };
}
