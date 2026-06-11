import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { CANONICALS } from "../canonical-manifest.mjs";

const REQUIRED_CANONICAL_REFERENCES = Object.freeze([
  "AI_Agent_Knowledge_Guide.md",
  "system_bootstrap.md",
  "memory_schema.json",
  "direct_instructions_registry_patch.md",
  "module_loader.md",
  "prompt_router.md",
]);

function sha256Text(value = "") {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactError(err) {
  return { code: err.code || "dynamic_activation_evidence_failed", message: err.message };
}

async function readTextFile(repoRoot, relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  const content = await fs.readFile(fullPath, "utf8");
  return {
    path: relativePath,
    exists: true,
    size_bytes: Buffer.byteLength(content, "utf8"),
    sha256: sha256Text(content),
    generated: content.startsWith("<!-- GENERATED FILE."),
    source_authority_pointer_present: content.includes("## Source Authority") || content.includes("#"),
  };
}

async function listMarkdownSourceFiles(repoRoot, sourceDir) {
  const dir = path.join(repoRoot, sourceDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

async function inspectRequiredReference(repoRoot, relativePath) {
  try {
    const file = await readTextFile(repoRoot, relativePath);
    if (relativePath.endsWith(".json")) {
      const content = await fs.readFile(path.join(repoRoot, relativePath), "utf8");
      JSON.parse(content);
      return { ...file, json_valid: true, ok: true };
    }
    return { ...file, ok: file.size_bytes > 0 };
  } catch (err) {
    return {
      path: relativePath,
      exists: false,
      ok: false,
      error: compactError(err),
    };
  }
}

async function inspectCanonicalFamily(repoRoot, config) {
  const output = await inspectRequiredReference(repoRoot, config.output);
  let sourceFiles = [];
  let sourceError = null;
  try {
    sourceFiles = await listMarkdownSourceFiles(repoRoot, config.sourceDir);
  } catch (err) {
    sourceError = compactError(err);
  }

  const sourceCount = sourceFiles.length;
  const expectedFileCount = safeNumber(config.expectedFileCount);
  const indexCount = Array.isArray(config.index) ? config.index.length : 0;
  const indexReferences = new Set((config.index || []).map(([, file]) => file).filter(Boolean));
  const missingIndexSources = [...indexReferences].filter((file) => !sourceFiles.includes(file));
  const generatedMarkerOk = output.generated === true;
  const expectedCountOk = expectedFileCount > 0 ? sourceCount === expectedFileCount : sourceCount > 0;
  const indexCountOk = indexCount > 0 && indexCount === sourceCount;

  const ok = Boolean(
    output.ok &&
    generatedMarkerOk &&
    sourceCount > 0 &&
    expectedCountOk &&
    indexCountOk &&
    missingIndexSources.length === 0 &&
    !sourceError
  );

  return {
    output: config.output,
    source_dir: config.sourceDir,
    ok,
    output_exists: output.exists === true,
    output_sha256: output.sha256 || null,
    output_size_bytes: output.size_bytes || 0,
    generated_marker_ok: generatedMarkerOk,
    expected_file_count: expectedFileCount,
    source_file_count: sourceCount,
    index_count: indexCount,
    expected_count_ok: expectedCountOk,
    index_count_ok: indexCountOk,
    missing_index_sources: missingIndexSources,
    source_error: sourceError,
  };
}

export async function buildRepoCanonicalRuntimeEvidence(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const requiredReferences = await Promise.all(
    REQUIRED_CANONICAL_REFERENCES.map((relativePath) => inspectRequiredReference(repoRoot, relativePath))
  );
  const canonicalFamilies = await Promise.all(
    CANONICALS.map((config) => inspectCanonicalFamily(repoRoot, config))
  );

  const staleOrMissingReferences = requiredReferences.filter((item) => !item.ok);
  const staleOrMissingFamilies = canonicalFamilies.filter((item) => !item.ok);
  const sourceFileCount = canonicalFamilies.reduce((sum, item) => sum + safeNumber(item.source_file_count), 0);
  const staleOrMissingCount = staleOrMissingReferences.length + staleOrMissingFamilies.length;

  return {
    attempted: true,
    ok: staleOrMissingCount === 0,
    activation_layer: "repo_canonical_runtime_readback",
    evidence_source: "repo_filesystem_canonical_manifest_readback",
    source_authority: "repo_runtime_filesystem_and_canonical_manifest",
    required_reference_count: REQUIRED_CANONICAL_REFERENCES.length,
    checked_reference_count: requiredReferences.length,
    canonical_family_count: canonicalFamilies.length,
    generated_family_count: canonicalFamilies.filter((item) => item.generated_marker_ok).length,
    source_file_count: sourceFileCount,
    stale_or_missing_count: staleOrMissingCount,
    required_references: requiredReferences.map((item) => ({
      path: item.path,
      ok: item.ok,
      exists: item.exists,
      size_bytes: item.size_bytes || 0,
      sha256: item.sha256 || null,
      generated: item.generated === true,
      json_valid: item.json_valid === true || undefined,
      error: item.error || null,
    })),
    canonical_families: canonicalFamilies,
    reason_code: staleOrMissingCount === 0 ? null : "repo_canonical_evidence_stale_or_missing",
    secrets_included: false,
  };
}

export function buildDynamicToolCatalogEvidence({ platformAccess = null, authorizedAccess = null } = {}) {
  const platformDegradedSurfaceCount = Array.isArray(platformAccess?.degraded_surfaces)
    ? platformAccess.degraded_surfaces.length
    : 0;
  const authorizedDegradedSurfaceCount = Array.isArray(authorizedAccess?.degraded_surfaces)
    ? authorizedAccess.degraded_surfaces.length
    : 0;
  const platformOk = platformAccess?.ok === true || (Boolean(platformAccess) && platformDegradedSurfaceCount === 0);
  const authorizedOk = authorizedAccess?.readiness === "active" && authorizedDegradedSurfaceCount === 0;
  const registeredSurfaceCount = safeNumber(authorizedAccess?.counts?.registered_surfaces);
  const runtimeCallableActions = safeNumber(
    authorizedAccess?.counts?.runtime_actions || platformAccess?.counts?.actions?.runtime_callable
  );
  const adminToolCount = safeNumber(authorizedAccess?.counts?.admin_tools);
  const degradedSurfaceCount = safeNumber(authorizedDegradedSurfaceCount + platformDegradedSurfaceCount);
  const authGapCount = safeNumber((authorizedAccess?.auth_gaps || []).length);

  return {
    attempted: true,
    ok: Boolean(platformOk && authorizedOk && registeredSurfaceCount > 0 && runtimeCallableActions > 0 && degradedSurfaceCount === 0 && authGapCount === 0),
    activation_layer: "activation_dynamic_runtime_catalog",
    evidence_source: "activation_platform_access_and_dynamic_authorization_envelope",
    source_authority: "sql_runtime_registry_and_activation_authorized_surface_registry",
    platform_access_ready: Boolean(platformOk),
    authorized_access_ready: Boolean(authorizedOk),
    registered_surface_count: registeredSurfaceCount,
    runtime_callable_actions: runtimeCallableActions,
    admin_tool_count: adminToolCount,
    degraded_surface_count: degradedSurfaceCount,
    auth_gap_count: authGapCount,
    reason_code: degradedSurfaceCount > 0
      ? "dynamic_catalog_degraded_surfaces"
      : authGapCount > 0
        ? "dynamic_catalog_auth_gaps"
        : registeredSurfaceCount <= 0
          ? "dynamic_catalog_missing_registered_surfaces"
          : runtimeCallableActions <= 0
            ? "dynamic_catalog_missing_runtime_actions"
            : null,
    secrets_included: false,
  };
}
