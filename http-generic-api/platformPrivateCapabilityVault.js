import { randomUUID, createHash } from "node:crypto";
import { getPool } from "./db.js";

const GOOGLE_ID_PATTERN = /^[a-zA-Z0-9_-]{10,}$/;
const SAFE_MANIFEST_EXTENSIONS = new Set([".json"]);
const BLOCKED_PATH_PATTERNS = [
  /^hooks\//i,
  /^scripts\//i,
  /^\.github\/workflows\//i,
  /^\.mcp\.json$/i,
  /^Dockerfile$/i,
  /^docker-compose\./i,
  /\.(sh|bash|ps1|cmd|bat|exe|dll|so|dylib|bin)$/i,
  /(^|\/)package\.json$/i,
];
const SAFE_ASSET_PATTERNS = [
  /(^|\/)SKILL\.md$/i,
  /^references\/.+\.md$/i,
  /^evals\/.+\.md$/i,
  /^README\.md$/i,
  /^LICENSE(\.md|\.txt)?$/i,
  /^SECURITY\.md$/i,
  /^manifest\.json$/i,
  /^skill\.json$/i,
];
const POLICY_EXPANSION_PATCHES = new Set(["tool_binding", "permission_change", "runtime_change"]);

function text(value = "") {
  return String(value || "").trim();
}

function lower(value = "") {
  return text(value).toLowerCase();
}

function normalizePath(value = "") {
  return text(value).replace(/\\/g, "/").replace(/^\.?\//, "");
}

function bool(value) {
  return value === true || value === 1 || lower(value) === "true";
}

function sha(value = "") {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function extension(path = "") {
  const match = normalizePath(path).match(/\.[^.\/]+$/);
  return match ? match[0].toLowerCase() : "";
}

export function extractGoogleFileId(input = {}) {
  const direct = text(input.file_id || input.fileId || input.id);
  if (GOOGLE_ID_PATTERN.test(direct)) {
    return {
      ok: true,
      file_id: direct,
      source: "direct_file_id",
      original_url: text(input.url || input.web_url || input.href),
    };
  }

  const url = text(input.url || input.web_url || input.href);
  if (!url) {
    return { ok: false, file_id: "", source: "missing", original_url: "", error: "google_file_url_or_id_required" };
  }

  const patterns = [
    /\/document\/d\/([a-zA-Z0-9_-]+)/,
    /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
    /\/presentation\/d\/([a-zA-Z0-9_-]+)/,
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return {
        ok: true,
        file_id: match[1],
        source: "url",
        original_url: url,
      };
    }
  }
  return { ok: false, file_id: "", source: "url", original_url: url, error: "google_file_id_not_found" };
}

function detectGoogleProduct({ url = "", mime_type = "" } = {}) {
  const mime = lower(mime_type);
  const href = lower(url);
  if (mime === "application/vnd.google-apps.document" || href.includes("/document/d/")) return "google_docs";
  if (mime === "application/vnd.google-apps.spreadsheet" || href.includes("/spreadsheets/d/")) return "google_sheets";
  if (mime === "application/vnd.google-apps.presentation" || href.includes("/presentation/d/")) return "google_slides";
  if (mime === "application/pdf") return "drive_pdf";
  if (mime.includes("wordprocessingml") || mime.includes("msword")) return "drive_word";
  if (mime.includes("jsonl")) return "drive_jsonl";
  if (mime.startsWith("text/") || mime.includes("json")) return "drive_text";
  return "drive_binary_or_unknown";
}

function readStrategyForProduct(product, input = {}) {
  if (input.session_jsonl_candidate && input.drive_jsonl_id) {
    return {
      read_strategy: "drive_jsonl_chunked",
      fallback_strategy: "docs_api_chunked",
      selected_file_id: text(input.drive_jsonl_id),
      preferred_session_jsonl: true,
    };
  }
  if (product === "google_docs") return { read_strategy: "docs_api_chunked", fallback_strategy: "drive_export_text_plain" };
  if (product === "google_sheets") return { read_strategy: "sheets_api_range_chunked", fallback_strategy: "drive_export_text_csv" };
  if (product === "google_slides") return { read_strategy: "slides_api_chunked", fallback_strategy: "drive_export_text_plain" };
  if (product === "drive_pdf") return { read_strategy: "drive_download_binary_then_extract", fallback_strategy: "manual_review" };
  if (product === "drive_word") return { read_strategy: "drive_export_text_plain", fallback_strategy: "drive_download_binary_then_extract" };
  if (product === "drive_jsonl") return { read_strategy: "drive_jsonl_chunked", fallback_strategy: "drive_download_text" };
  if (product === "drive_text") return { read_strategy: "drive_download_text_chunked", fallback_strategy: "manual_review" };
  return { read_strategy: "metadata_only_manual_review", fallback_strategy: "manual_review" };
}

export function resolveGoogleFileReadDecision(input = {}) {
  const id = extractGoogleFileId(input);
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  const mimeType = text(input.mime_type || input.mimeType || metadata.mimeType || metadata.mime_type);
  const title = text(input.title || metadata.name || metadata.title);
  const product = detectGoogleProduct({ url: id.original_url, mime_type: mimeType });
  const sessionJsonlCandidate = bool(input.session_jsonl_candidate || input.sessionJsonlCandidate)
    || /session transcript/i.test(title)
    || Boolean(input.customer_session_id || input.session_id);
  const strategy = readStrategyForProduct(product, {
    session_jsonl_candidate: sessionJsonlCandidate,
    drive_jsonl_id: input.drive_jsonl_id || input.driveJsonlId,
  });
  const selectedFileId = strategy.selected_file_id || id.file_id;
  const blockers = [];
  if (!id.ok) blockers.push(id.error || "google_file_id_required");
  if (!mimeType && !input.metadata_probe_status) blockers.push("drive_metadata_probe_required");

  return {
    ok: blockers.length === 0,
    decision_type: "google_file_read_resolution_v1",
    source_adapter: "google_workspace_file",
    file_id: id.file_id,
    selected_file_id: selectedFileId,
    original_url: id.original_url,
    detected_product: product,
    mime_type: mimeType,
    title,
    metadata_probe: {
      required: true,
      supportsAllDrives: true,
      fields: "id,name,mimeType,modifiedTime,size,owners,driveId",
      status: input.metadata_probe_status || (mimeType ? "provided" : "required"),
    },
    requires_supports_all_drives: true,
    session_jsonl_candidate: sessionJsonlCandidate,
    content_size_strategy: {
      fields_narrowing: true,
      chunking_required: true,
      max_chars_per_chunk: Number(input.max_chars_per_chunk || 12000),
      cursor_required: true,
      fallback_to_drive_jsonl: sessionJsonlCandidate,
    },
    diagnostics: {
      provider: "google_drive",
      provider_error_code: input.provider_error_code || null,
      web_url_fetch_allowed: false,
      secrets_included: false,
    },
    web_url_fetch_allowed: false,
    ...strategy,
    blockers,
    dry_run: true,
    will_execute: false,
  };
}

export function classifyCapabilityAsset(asset = {}) {
  const sourcePath = normalizePath(asset.path || asset.source_path || asset.name);
  const sizeBytes = Number(asset.size_bytes || asset.size || 0);
  const executable = bool(asset.executable || asset.is_executable);
  const riskFlags = [];
  let assetType = "unknown";
  let importStatus = "blocked";

  if (!sourcePath) riskFlags.push("source_path_missing");
  if (executable) riskFlags.push("executable_asset");
  if (sizeBytes > 1_000_000) riskFlags.push("large_asset_requires_review");
  if (BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(sourcePath))) riskFlags.push("blocked_path_family");

  if (SAFE_ASSET_PATTERNS.some((pattern) => pattern.test(sourcePath))) {
    importStatus = "import_allowed";
    assetType = sourcePath.endsWith("SKILL.md") ? "skill"
      : sourcePath.startsWith("references/") ? "reference"
        : sourcePath.startsWith("evals/") ? "eval"
          : sourcePath.toLowerCase().includes("license") ? "license"
            : sourcePath.toLowerCase().includes("security") ? "security"
              : sourcePath.toLowerCase().endsWith(".json") ? "manifest"
                : "documentation";
  } else if (SAFE_MANIFEST_EXTENSIONS.has(extension(sourcePath)) && !sourcePath.toLowerCase().includes("package.json")) {
    importStatus = "requires_recognition_review";
    assetType = "manifest_candidate";
    riskFlags.push("manifest_not_allowlisted_by_name");
  }

  if (riskFlags.includes("blocked_path_family") || riskFlags.includes("executable_asset")) {
    importStatus = "blocked_evidence_only";
    assetType = assetType === "unknown" ? "blocked_runtime_asset" : assetType;
  }

  return {
    source_path: sourcePath,
    normalized_path: sourcePath,
    asset_type: assetType,
    blob_sha: text(asset.blob_sha || asset.sha) || sha(`${sourcePath}:${sizeBytes}`),
    size_bytes: sizeBytes,
    risk_flags: unique(riskFlags),
    import_status: importStatus,
    runtime_import_allowed: importStatus === "import_allowed" && riskFlags.length === 0,
  };
}

function summarizeAssets(assets = []) {
  const safe = assets.filter((asset) => asset.runtime_import_allowed);
  const blocked = assets.filter((asset) => asset.import_status === "blocked_evidence_only");
  const review = assets.filter((asset) => asset.import_status === "requires_recognition_review");
  return {
    total_assets: assets.length,
    safe_assets: safe.length,
    blocked_assets: blocked.length,
    review_assets: review.length,
    requires_code_execution: assets.some((asset) => asset.risk_flags.includes("executable_asset") || asset.risk_flags.includes("blocked_path_family")),
  };
}

export function buildCapabilityMirrorPlan(input = {}) {
  const sourceRepo = text(input.source_repo_full_name || input.sourceRepoFullName || input.source);
  const sourceCommit = text(input.source_commit_sha || input.sourceCommitSha || input.commit_sha);
  const mirrorId = text(input.mirror_id) || `mirror_${randomUUID()}`;
  const blockers = [];
  if (!sourceRepo) blockers.push("source_repo_full_name_required");
  if (!sourceCommit) blockers.push("source_commit_sha_required");
  return {
    ok: blockers.length === 0,
    plan_type: "platform_private_repo_mirror_plan_v1",
    mirror_id: mirrorId,
    source_repo_full_name: sourceRepo,
    source_commit_sha: sourceCommit,
    mirror_status: "planned",
    raw_mirror_immutable: true,
    executed_by_runtime: false,
    stores_blocked_assets_as_evidence: true,
    dry_run: true,
    will_write: false,
    blockers,
  };
}

export function buildSanitizedPackagePlan(input = {}) {
  const files = Array.isArray(input.files) ? input.files : Array.isArray(input.assets) ? input.assets : [];
  const assets = files.map(classifyCapabilityAsset);
  const summary = summarizeAssets(assets);
  const licenseAllowed = input.license_allowed !== false && !["unknown", "blocked"].includes(lower(input.license_spdx));
  const riskClass = summary.requires_code_execution ? "high" : summary.review_assets ? "medium" : "low";
  const certificationStatus = summary.review_assets ? "requires_recognition_review" : "certification_ready";
  const autoInstallAllowed = input.package_type === "skill_pack"
    && !summary.requires_code_execution
    && licenseAllowed
    && riskClass !== "high"
    && summary.safe_assets > 0
    && input.tenant_policy_allows !== false
    && !bool(input.secrets_required);
  const blockers = [];
  if (!text(input.package_key)) blockers.push("package_key_required");
  if (!files.length) blockers.push("source_files_required");
  if (!licenseAllowed) blockers.push("license_not_allowed");
  if (summary.requires_code_execution) blockers.push("runtime_or_executable_assets_block_auto_install");
  if (bool(input.secrets_required)) blockers.push("secrets_required_block_auto_install");
  return {
    ok: blockers.length === 0,
    plan_type: "platform_private_package_sanitization_plan_v1",
    package_key: text(input.package_key),
    package_type: text(input.package_type || "skill_pack"),
    source_mirror_id: text(input.source_mirror_id),
    source_commit_sha: text(input.source_commit_sha),
    version: text(input.version || "v1"),
    risk_class: riskClass,
    certification_status: certificationStatus,
    safe_asset_manifest: assets.filter((asset) => asset.runtime_import_allowed),
    blocked_asset_manifest: assets.filter((asset) => !asset.runtime_import_allowed),
    summary,
    auto_install_allowed: autoInstallAllowed,
    dry_run: true,
    will_write: false,
    blockers,
  };
}

function normalizeAssetForDiff(asset = {}) {
  const classified = classifyCapabilityAsset(asset);
  return {
    ...classified,
    normalized_hash: text(asset.normalized_hash) || text(asset.content_hash) || classified.blob_sha,
    canonical_skill_key: text(asset.canonical_skill_key || asset.skill_key || classified.normalized_path.toLowerCase()),
    semantic_fingerprint: text(asset.semantic_fingerprint) || sha(`${classified.normalized_path}:${classified.asset_type}:${classified.blob_sha}`),
  };
}

export function buildReinstallDiffPlan(input = {}) {
  const existingAssets = (input.existing_assets || input.current_assets || []).map(normalizeAssetForDiff);
  const incomingAssets = (input.incoming_assets || input.assets || []).map(normalizeAssetForDiff);
  const existingByPath = new Map(existingAssets.map((asset) => [asset.normalized_path, asset]));
  const items = [];
  for (const incoming of incomingAssets) {
    const current = existingByPath.get(incoming.normalized_path);
    let decision = "new_assets_available";
    if (current && current.normalized_hash === incoming.normalized_hash) decision = "no_op";
    else if (current && current.asset_type === incoming.asset_type && incoming.runtime_import_allowed) decision = "safe_patch_available";
    else if (current) decision = "conflict_detected";
    if (!incoming.runtime_import_allowed) decision = "blocked_by_policy";
    items.push({
      source_path: incoming.source_path,
      asset_type: incoming.asset_type,
      previous_hash: current?.normalized_hash || null,
      incoming_hash: incoming.normalized_hash,
      decision,
      preserves_tenant_overrides: true,
    });
  }
  const decisions = unique(items.map((item) => item.decision));
  const overallDecision = decisions.includes("blocked_by_policy") ? "blocked_by_policy"
    : decisions.includes("conflict_detected") ? "conflict_detected"
      : decisions.includes("safe_patch_available") ? "safe_patch_available"
        : decisions.includes("new_assets_available") ? "new_assets_available"
          : "no_op";
  return {
    ok: overallDecision !== "blocked_by_policy" && overallDecision !== "conflict_detected",
    plan_type: "repo_install_diff_plan_v1",
    package_key: text(input.package_key),
    tenant_id: text(input.tenant_id),
    current_version: text(input.current_version),
    incoming_version: text(input.incoming_version),
    decision: overallDecision,
    reinstall_is_idempotent: true,
    will_duplicate_install: false,
    tenant_overrides_preserved: true,
    reset_forbidden: [
      "tenant_overrides",
      "brand_bindings",
      "agent_grants",
      "disabled_skills",
      "thresholds",
      "approval_states",
    ],
    items,
    dry_run: true,
    will_write: false,
  };
}

export function buildVariantPatchPlan(input = {}) {
  const patches = Array.isArray(input.patches) ? input.patches : [];
  const planned = patches.map((patch) => {
    const patchType = text(patch.patch_type || patch.type);
    const targetType = text(patch.target_asset_type || patch.target_type);
    const narrowsPolicy = patchType === "policy_change" && bool(patch.narrows_policy);
    const expandsPolicy = patchType === "policy_change" && bool(patch.expands_policy);
    let riskClass = text(patch.risk_class || "low");
    let approvalStatus = "not_required";
    let certificationStatus = "not_required";
    const blockers = [];
    if (POLICY_EXPANSION_PATCHES.has(targetType) || expandsPolicy) {
      riskClass = "high";
      approvalStatus = "required";
      certificationStatus = "required";
      blockers.push("permission_or_tool_expansion_requires_approval");
    } else if (targetType === "skill" && patchType === "override") {
      riskClass = riskClass === "low" ? "medium" : riskClass;
      certificationStatus = "light_eval_required";
    } else if (narrowsPolicy) {
      approvalStatus = "not_required";
    }
    return {
      target_asset_type: targetType,
      target_asset_key: text(patch.target_asset_key || patch.asset_key),
      patch_type: patchType,
      risk_class: riskClass,
      approval_status: approvalStatus,
      certification_status: certificationStatus,
      blockers,
    };
  });
  const blockers = planned.flatMap((patch) => patch.blockers);
  return {
    ok: blockers.length === 0,
    plan_type: "platform_package_variant_patch_plan_v1",
    package_id: text(input.package_id),
    variant_key: text(input.variant_key),
    scope_type: text(input.scope_type),
    scope_id: text(input.scope_id),
    base_package_version_id: text(input.base_package_version_id),
    patches: planned,
    precedence: [
      "platform_hard_policy",
      "package_base_manifest",
      "tenant_variant",
      "business_type_defaults",
      "brand_variant",
      "user_variant",
      "task_context_overlay",
      "runtime_resolver",
    ],
    lower_layers_cannot_open_upper_policy: true,
    dry_run: true,
    will_write: false,
    blockers: unique(blockers),
  };
}

export function resolveCapabilityRuntime(input = {}) {
  const packageKey = text(input.package_key);
  const baseVersion = text(input.base_version || input.base_package_version_id);
  const variants = Array.isArray(input.variants) ? input.variants : [];
  const taskOverlay = input.task_overlay && typeof input.task_overlay === "object" ? input.task_overlay : null;
  const blocked = [];
  if (!packageKey) blocked.push("package_key_required");
  if (!baseVersion) blocked.push("base_version_required");
  for (const variant of variants) {
    if (bool(variant.expands_policy) || bool(variant.requires_approval)) {
      blocked.push(`variant_requires_approval:${text(variant.variant_key || variant.scope_type)}`);
    }
  }
  return {
    ok: blocked.length === 0,
    resolution_type: "platform_private_capability_runtime_resolution_v1",
    package_key: packageKey,
    base_version: baseVersion,
    applied_variants: variants.map((variant) => ({
      variant_key: text(variant.variant_key),
      scope_type: text(variant.scope_type),
      scope_id: text(variant.scope_id),
      status: text(variant.status || "active"),
    })),
    task_overlay_applied: Boolean(taskOverlay),
    requires_approval: blocked.some((item) => item.includes("requires_approval")),
    dispatch_ready: blocked.length === 0,
    source_truth: "platform_private_capability_vault",
    blocked,
    dry_run: true,
    will_execute: false,
  };
}


const RESTRICTED_DOMAIN_PATTERNS = [
  /red\s*team|hacking|exploit|reverse\s*engineering|malware|decepticon/i,
  /voice\s*cloning|tts/i,
  /trading|autonomous\s+trading|financial\s+trading/i,
];
const RUNTIME_CANDIDATE_PATTERNS = [
  /agent\s+harness|runtime|desktop\s+app|coding\s+agent|memory|context|local-first/i,
  /Dockerfile|docker-compose|package\.json|Cargo\.toml|pyproject\.toml/i,
];
const CATALOG_SIGNAL_PATTERNS = [
  /awesome|catalog|directory|public-apis/i,
  /README\.md$/i,
];

function countBy(values = [], predicate = () => false) {
  return values.reduce((count, value) => count + (predicate(value) ? 1 : 0), 0);
}

function detectRepoIngestionClass(input = {}, classifiedAssets = []) {
  const descriptor = `${input.repo_name || ""} ${input.description || ""} ${input.source_repo_full_name || ""} ${classifiedAssets.map((asset) => asset.source_path).join(" ")}`;
  const hasRestricted = RESTRICTED_DOMAIN_PATTERNS.some((pattern) => pattern.test(descriptor));
  const hasSkill = classifiedAssets.some((asset) => asset.asset_type === "skill") || /skill/i.test(descriptor);
  const hasCatalog = CATALOG_SIGNAL_PATTERNS.some((pattern) => pattern.test(descriptor));
  const hasRuntime = RUNTIME_CANDIDATE_PATTERNS.some((pattern) => pattern.test(descriptor)) || classifiedAssets.some((asset) => asset.import_status === "blocked_evidence_only");
  const hasKnowledge = /guide|documentation|knowledge|system design|reference/i.test(descriptor);
  if (hasRestricted) return { repo_kind: "restricted_domain_candidate", install_mode: "restricted_quarantine", risk_class: "critical" };
  if (hasSkill && !hasRuntime) return { repo_kind: "declarative_skill_pack", install_mode: "private_skill_import", risk_class: "low" };
  if (hasSkill && hasRuntime) return { repo_kind: "mixed_skill_pack_with_runtime_assets", install_mode: "private_skill_import", risk_class: "medium" };
  if (hasCatalog) return { repo_kind: "catalog_only", install_mode: "index_only", risk_class: "low" };
  if (hasKnowledge) return { repo_kind: "knowledge_only", install_mode: "knowledge_asset_import", risk_class: "low" };
  if (hasRuntime) return { repo_kind: "runtime_or_tool_candidate", install_mode: "runtime_candidate_sandbox", risk_class: "high" };
  return { repo_kind: "unknown_candidate", install_mode: "index_only", risk_class: "medium" };
}

export function buildRepoIngestionPlan(input = {}) {
  const sourceRepo = text(input.source_repo_full_name || input.repo_full_name || input.full_name);
  const sourceCommit = text(input.source_commit_sha || input.commit_sha);
  const files = Array.isArray(input.files) ? input.files : Array.isArray(input.tree) ? input.tree : [];
  const classifiedAssets = files.map(classifyCapabilityAsset);
  const classification = detectRepoIngestionClass(input, classifiedAssets);
  const summary = summarizeAssets(classifiedAssets);
  const blockers = [];
  if (!sourceRepo) blockers.push("source_repo_full_name_required");
  if (!sourceCommit) blockers.push("source_commit_sha_required");
  if (!files.length) blockers.push("repo_file_tree_required");
  if (classification.install_mode === "restricted_quarantine") blockers.push("restricted_domain_requires_platform_review");
  const safeSkillFiles = classifiedAssets.filter((asset) => asset.asset_type === "skill" && asset.runtime_import_allowed);
  const catalogEntries = classifiedAssets.filter((asset) => asset.asset_type === "documentation" || asset.asset_type === "manifest_candidate");
  return {
    ok: blockers.length === 0,
    plan_type: "repo_capability_ingestion_plan_v1",
    source_repo_full_name: sourceRepo,
    source_commit_sha: sourceCommit,
    parent_repo_full_name: text(input.parent_repo_full_name || input.parent),
    license_spdx: text(input.license_spdx || input.license),
    classification,
    summary,
    candidate_counts: {
      skill_candidates: safeSkillFiles.length,
      catalog_candidates: catalogEntries.length,
      blocked_evidence_assets: summary.blocked_assets,
      recognition_review_assets: summary.review_assets,
    },
    next_steps: classification.install_mode === "private_skill_import"
      ? ["create_raw_mirror_plan", "create_sanitized_package_plan", "run_manifest_certification", "prepare_tenant_install_preview"]
      : classification.install_mode === "index_only"
        ? ["index_repo_metadata", "index_catalog_entries", "do_not_create_runtime_grants"]
        : classification.install_mode === "knowledge_asset_import"
          ? ["index_docs_as_knowledge_assets", "link_to_skill_or_engine_context", "do_not_execute"]
          : classification.install_mode === "runtime_candidate_sandbox"
            ? ["create_capability_candidate", "sandbox_smoke_required", "manual_certification_required"]
            : ["quarantine_metadata_only", "platform_security_review_required"],
    assets: classifiedAssets,
    dry_run: true,
    will_write: false,
    will_execute: false,
    blockers: unique(blockers),
  };
}

export function buildInstallRequestPlan(input = {}) {
  const packagePlan = input.package_plan && typeof input.package_plan === "object" ? input.package_plan : null;
  const packageKey = text(input.package_key || packagePlan?.package_key);
  const scopeType = text(input.scope_type || "tenant");
  const tenantId = text(input.tenant_id);
  const requestedMode = text(input.requested_install_mode || "auto");
  const riskClass = lower(input.risk_class || packagePlan?.risk_class || "medium");
  const certificationStatus = text(input.certification_status || packagePlan?.certification_status || "requires_recognition_review");
  const autoPackageAllowed = bool(input.auto_install_allowed ?? packagePlan?.auto_install_allowed);
  const tenantPolicyAllows = input.tenant_policy_allows !== false;
  const blockers = [];
  if (!packageKey) blockers.push("package_key_required");
  if (scopeType === "tenant" && !tenantId) blockers.push("tenant_id_required");
  if (!tenantPolicyAllows) blockers.push("tenant_policy_blocks_install");
  if (["high", "critical"].includes(riskClass)) blockers.push("risk_class_requires_manual_approval");
  if (!["certified", "certification_ready", "not_required"].includes(certificationStatus)) blockers.push("certification_not_ready");
  if (!autoPackageAllowed && requestedMode === "auto") blockers.push("package_not_auto_install_allowed");
  const approvalRequired = blockers.some((blocker) => blocker.includes("approval") || blocker.includes("risk") || blocker.includes("certification"));
  return {
    ok: blockers.length === 0,
    plan_type: "platform_capability_install_request_plan_v1",
    package_key: packageKey,
    scope_type: scopeType,
    tenant_id: tenantId,
    brand_key: text(input.brand_key),
    user_id: text(input.user_id),
    requested_install_mode: requestedMode,
    resolved_install_mode: blockers.length ? "blocked_or_review" : "tenant_private_install",
    install_writes_allowed: false,
    creates_agent_grants: blockers.length === 0 && bool(input.create_agent_grants),
    approval_required: approvalRequired,
    post_install_status: blockers.length ? "not_applied" : "tenant_private_draft",
    preserves_existing_variants: true,
    dry_run: true,
    will_write: false,
    blockers: unique(blockers),
  };
}

export function buildVariantMergePlan(input = {}) {
  const patches = Array.isArray(input.variant_patches) ? input.variant_patches : [];
  const changedBaseAssets = Array.isArray(input.changed_base_assets) ? input.changed_base_assets.map(normalizeAssetForDiff) : [];
  const changedByKey = new Map(changedBaseAssets.map((asset) => [asset.canonical_skill_key || asset.normalized_path, asset]));
  const items = patches.map((patch) => {
    const targetKey = text(patch.target_asset_key || patch.asset_key);
    const baseChange = changedByKey.get(targetKey) || changedByKey.get(lower(targetKey));
    let merge_status = "auto_merge";
    let reason = "patch_targets_unchanged_or_append_only";
    if (bool(patch.expands_policy) || ["tool_binding", "permission_change", "runtime_change"].includes(text(patch.target_asset_type))) {
      merge_status = "blocked";
      reason = "patch_expands_policy_or_runtime_surface";
    } else if (baseChange && text(patch.patch_type) === "override") {
      merge_status = "conflict";
      reason = "override_patch_targets_changed_base_asset";
    } else if (baseChange) {
      merge_status = "auto_merge_with_review_note";
      reason = "base_asset_changed_but_patch_is_non_destructive";
    }
    return {
      target_asset_key: targetKey,
      target_asset_type: text(patch.target_asset_type),
      patch_type: text(patch.patch_type),
      merge_status,
      reason,
    };
  });
  const blockedCount = countBy(items, (item) => item.merge_status === "blocked");
  const conflictCount = countBy(items, (item) => item.merge_status === "conflict");
  const autoMergedCount = countBy(items, (item) => item.merge_status.startsWith("auto_merge"));
  return {
    ok: blockedCount === 0 && conflictCount === 0,
    plan_type: "platform_variant_three_way_merge_plan_v1",
    variant_id: text(input.variant_id),
    old_base_version_id: text(input.old_base_version_id),
    new_base_version_id: text(input.new_base_version_id),
    merge_status: blockedCount ? "blocked" : conflictCount ? "conflicts" : "auto_merged",
    auto_merged_count: autoMergedCount,
    conflict_count: conflictCount,
    blocked_count: blockedCount,
    items,
    three_way_merge: true,
    preserves_user_patches: true,
    dry_run: true,
    will_write: false,
  };
}

export async function listCapabilityVaultPackages({ status = "", limit = 50 } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  params.push(Math.max(1, Math.min(Number(limit) || 50, 250)));
  const [rows] = await pool.query(
    `SELECT package_id, package_key, package_type, version, status, certification_status,
            risk_class, source_commit_sha, created_at, updated_at
       FROM platform_private_packages
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC
       LIMIT ?`,
    params
  );
  return rows;
}

export const PLATFORM_PRIVATE_CAPABILITY_VAULT_GUARDRAILS = Object.freeze({
  raw_mirror_never_executed: true,
  blocked_assets_retained_as_evidence: true,
  sanitized_package_runtime_only: true,
  reinstall_idempotent: true,
  tenant_overrides_preserved_on_upgrade: true,
  lower_variant_layers_cannot_expand_upper_policy: true,
  google_web_url_fetch_allowed: false,
  google_drive_supports_all_drives_default: true,
});
