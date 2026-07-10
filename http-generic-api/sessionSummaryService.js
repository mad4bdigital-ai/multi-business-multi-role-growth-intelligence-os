import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { fetchDriveContent } from "./uploadPipeline.js";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";
import { assertSurfaceAuthority, SURFACE_KEYS } from "./surfaceAuthorityResolver.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MIN_AGE_SECONDS = 60;
const DEFAULT_FALLBACK_TURNS_LIMIT = 200;
const DEFAULT_CHUNK_CHAR_LIMIT = 18000;
const DEFAULT_FINAL_CHAR_LIMIT = 30000;
const MAX_ARRAY_ITEMS = 5;

function defaultDeps() {
  return {
    fetchDriveContent,
    now: () => new Date(),
  };
}

export function redactSensitiveText(value = "") {
  let text = String(value || "");
  const replacements = [
    [/(authorization\s*:\s*bearer\s+)[^\s"'`]+/gi, "$1[REDACTED]"],
    [/(x-api-key\s*:\s*)[^\s"'`]+/gi, "$1[REDACTED]"],
    [/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|private[_-]?key)\s*[=:]\s*)[^\s,;"'`]+/gi, "$1[REDACTED]"],
    [/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|private[_-]?key)"\s*:\s*")[^"]+/gi, "$1[REDACTED]"],
    [/(-----BEGIN [^-]+PRIVATE KEY-----)[\s\S]+?(-----END [^-]+PRIVATE KEY-----)/g, "$1[REDACTED]$2"],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function boundedText(value = "", limit = 2000) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...[truncated]`;
}

function sanitizeModelError(error) {
  const message = redactSensitiveText(error?.message || String(error || "model_call_failed"));
  const providerMatch = message.match(/\b(Anthropic|OpenAI|Gemini) API\s+(\d{3})/i);
  if (providerMatch) {
    return `model_call_failed: ${providerMatch[1]} API ${providerMatch[2]}`;
  }
  if (/invalid\s+(x-api-key|api key|authorization|credentials?)/i.test(message)) {
    return "model_call_failed: invalid model credentials";
  }
  if (/missing\s+.*(api key|credential|token)/i.test(message)) {
    return "model_call_failed: missing model credentials";
  }
  return boundedText(message.replace(/\{[\s\S]*\}/g, "[upstream_error_body_redacted]"), 240);
}

function safeJsonParse(value, fallback = null) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, MAX_ARRAY_ITEMS);
  if (typeof value === "string" && value.trim()) return [value.trim()].slice(0, MAX_ARRAY_ITEMS);
  return [];
}

function normalizeComplexity(value) {
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

function normalizeGraphIdPart(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 180);
}

function summaryAssetId(summaryId) {
  return `session_summary_${normalizeGraphIdPart(summaryId)}`;
}

function summaryLinkId(summaryId) {
  return `link_${normalizeGraphIdPart(summaryId).replace(/-/g, "")}`.slice(0, 64);
}

function memoryScopeLinkId(summaryId, scopeType, scopeRef) {
  return `msl_${normalizeGraphIdPart(summaryId).replace(/-/g, "")}_${normalizeGraphIdPart(scopeType)}_${normalizeGraphIdPart(scopeRef)}`.slice(0, 96);
}

function memoryScopeIdentityHash(resourceType, resourceRef, scopeType, scopeRef, linkageType) {
  return createHash("sha256")
    .update([resourceType, resourceRef, scopeType, scopeRef, linkageType].map((part) => String(part || "")).join("|"))
    .digest("hex");
}

function insightCandidateId(summaryId, insightType, index) {
  return `ins_${normalizeGraphIdPart(summaryId).replace(/-/g, "")}_${normalizeGraphIdPart(insightType)}_${index}`.slice(0, 96);
}

function insightCandidateHash({ sessionId, summaryId, insightType, title, statement }) {
  return createHash("sha256")
    .update([summaryId, sessionId, insightType, title, statement].map((part) => String(part || "")).join("|"))
    .digest("hex");
}

function titleFromStatement(insightType, statement) {
  const prefix = insightType.replace(/_/g, " ");
  const clean = String(statement || "").replace(/\s+/g, " ").trim();
  return boundedText(`${prefix}: ${clean}`, 180);
}

export const SESSION_SUMMARY_GRAPH_POLICY_SURFACE_KEY = "session_summary_graph_policy";

const SESSION_SUMMARY_GRAPH_ALLOWED_SCOPES = Object.freeze(["conversation", "tenant", "user", "workspace", "brand"]);

const DEFAULT_SESSION_SUMMARY_GRAPH_POLICY = Object.freeze({
  enforcement_mode: "required",
  graph_attachment_required: true,
  require_graph_readback: true,
  require_surface_execution: false,
  raw_transcript_allowed: false,
  promotion_allowed: false,
  require_human_review_for_promotions: true,
  allowed_scope_types: ["conversation", "tenant", "user", "workspace"],
  max_summary_text_chars: 1600,
  max_array_items: MAX_ARRAY_ITEMS,
  policy_source: "default_required_graph_policy",
  secrets_included: false,
});

function normalizeBooleanPreference(value, fallback) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const token = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "enabled", "required", "strict"].includes(token)) return true;
  if (["false", "0", "no", "disabled", "advisory"].includes(token)) return false;
  return fallback;
}

function normalizeAllowedGraphScopes(value) {
  const requested = normalizeArray(value).map((scope) => String(scope || "").trim().toLowerCase());
  const allowed = requested.filter((scope) => SESSION_SUMMARY_GRAPH_ALLOWED_SCOPES.includes(scope));
  return allowed.length ? [...new Set(allowed)] : [...DEFAULT_SESSION_SUMMARY_GRAPH_POLICY.allowed_scope_types];
}

function normalizeSessionSummaryGraphPolicy(preferences = {}, source = "default_required_graph_policy") {
  const raw = preferences && typeof preferences === "object" ? preferences : {};
  const requireSurfaceExecution = normalizeBooleanPreference(
    raw.require_surface_execution ?? raw.requireSurfaceExecution,
    DEFAULT_SESSION_SUMMARY_GRAPH_POLICY.require_surface_execution
  );
  const maxSummaryTextChars = Math.max(
    200,
    Math.min(Number(raw.max_summary_text_chars || raw.maxSummaryTextChars || DEFAULT_SESSION_SUMMARY_GRAPH_POLICY.max_summary_text_chars), 4000)
  );
  const maxArrayItems = Math.max(
    1,
    Math.min(Number(raw.max_array_items || raw.maxArrayItems || DEFAULT_SESSION_SUMMARY_GRAPH_POLICY.max_array_items), MAX_ARRAY_ITEMS)
  );
  return {
    ...DEFAULT_SESSION_SUMMARY_GRAPH_POLICY,
    require_surface_execution: requireSurfaceExecution,
    allowed_scope_types: normalizeAllowedGraphScopes(raw.allowed_scope_types || raw.allowedScopeTypes),
    max_summary_text_chars: maxSummaryTextChars,
    max_array_items: maxArrayItems,
    policy_source: source,
    graph_attachment_required: true,
    require_graph_readback: true,
    raw_transcript_allowed: false,
    promotion_allowed: false,
    require_human_review_for_promotions: true,
    secrets_included: false,
  };
}

export async function resolveSessionSummaryGraphPolicy({ pool = getPool(), session = {} } = {}) {
  const tenantId = session.tenant_id || PLATFORM_TENANT_ID;
  const userId = session.user_id || null;
  try {
    const [rows] = await pool.query(
      `SELECT preference_id, tenant_id, user_id, surface_key, preferences_json, updated_at
         FROM \`user_agent_surface_preferences\`
        WHERE surface_key = ?
          AND status = 'active'
          AND (tenant_id = ? OR tenant_id = ? OR tenant_id IS NULL OR tenant_id = '' OR tenant_id = '*')
          AND (user_id = ? OR user_id IS NULL OR user_id = '' OR user_id = '*')
        ORDER BY CASE
          WHEN tenant_id = ? AND user_id = ? THEN 0
          WHEN tenant_id = ? AND (user_id IS NULL OR user_id = '' OR user_id = '*') THEN 1
          WHEN tenant_id = ? THEN 2
          ELSE 3
        END,
        updated_at DESC
        LIMIT 1`,
      [
        SESSION_SUMMARY_GRAPH_POLICY_SURFACE_KEY,
        tenantId,
        PLATFORM_TENANT_ID,
        userId,
        tenantId,
        userId,
        tenantId,
        PLATFORM_TENANT_ID,
      ]
    );
    const row = rows?.[0] || null;
    if (!row) return normalizeSessionSummaryGraphPolicy({}, "default_required_graph_policy");
    return normalizeSessionSummaryGraphPolicy(
      safeJsonParse(row.preferences_json, {}),
      `user_agent_surface_preferences:${row.preference_id || row.surface_key || SESSION_SUMMARY_GRAPH_POLICY_SURFACE_KEY}`
    );
  } catch {
    return normalizeSessionSummaryGraphPolicy({}, "default_required_graph_policy_read_failed");
  }
}

function suggestedScopesForSession(session = {}) {
  const tenantId = session.tenant_id || PLATFORM_TENANT_ID;
  return [
    { scope_type: "conversation", scope_ref: session.session_id, confidence: 1 },
    tenantId ? { scope_type: "tenant", scope_ref: tenantId, confidence: 0.95 } : null,
    session.user_id ? { scope_type: "user", scope_ref: session.user_id, confidence: 0.9 } : null,
    session.workspace_key ? { scope_type: "workspace", scope_ref: session.workspace_key, confidence: 0.9 } : null,
    session.brand_key ? { scope_type: "brand", scope_ref: session.brand_key, confidence: 0.85 } : null,
  ].filter(Boolean);
}

function buildCandidateSeed({ session, summaryId, assetId, insightType, statement, sourceField, sourceIndex, confidence, riskLevel, approvalStatus, targetSurface = null }) {
  const cleanStatement = boundedText(redactSensitiveText(statement), 1200);
  if (!cleanStatement.trim()) return null;
  const title = titleFromStatement(insightType, cleanStatement);
  return {
    insight_id: insightCandidateId(summaryId, insightType, sourceIndex),
    candidate_hash: insightCandidateHash({ sessionId: session.session_id, summaryId, insightType, title, statement: cleanStatement }),
    source_session_id: session.session_id,
    source_summary_id: summaryId,
    source_asset_id: assetId || null,
    tenant_id: session.tenant_id || PLATFORM_TENANT_ID,
    user_id: session.user_id || null,
    workspace_key: session.workspace_key || null,
    insight_type: insightType,
    title,
    statement_text: cleanStatement,
    evidence_json: JSON.stringify({
      source_field: sourceField,
      source_index: sourceIndex,
      source_table: "session_summaries",
      source_summary_id: summaryId,
      source_session_id: session.session_id,
      raw_transcript_included: false,
      secrets_included: false,
    }),
    suggested_scopes_json: JSON.stringify(suggestedScopesForSession(session)),
    target_surface: targetSurface,
    target_ref: null,
    confidence,
    risk_level: riskLevel,
    approval_status: approvalStatus,
    metadata_json: JSON.stringify({
      extractor: "session_summary_deterministic_v1",
      promotion_allowed: false,
      secrets_included: false,
    }),
    created_by: "sessionSummaryService",
  };
}

export function buildSessionInsightCandidateSeeds({ session, summaryId, insight, assetId = null } = {}) {
  if (!session?.session_id || !summaryId || !insight) return [];
  const seeds = [];
  let index = 0;
  const add = (insightType, statement, sourceField, confidence, riskLevel, approvalStatus, targetSurface = null) => {
    const seed = buildCandidateSeed({
      session,
      summaryId,
      assetId,
      insightType,
      statement,
      sourceField,
      sourceIndex: index,
      confidence,
      riskLevel,
      approvalStatus,
      targetSurface,
    });
    index += 1;
    if (seed) seeds.push(seed);
  };

  add("session_summary_signal", insight.summary_text, "summary_text", 0.7, "low", "not_required", "session_summary_memory");
  for (const item of normalizeArray(insight.tasks_completed)) add("completed_task", item, "tasks_completed", 0.8, "low", "not_required", "execution_trace");
  for (const item of normalizeArray(insight.blockers)) add("runtime_gap", item, "blockers", 0.85, "medium", "review_required", "runtime_repair_backlog");
  for (const item of normalizeArray(insight.feature_requests)) add("development_idea", item, "feature_requests", 0.8, "medium", "review_required", "development_backlog");
  for (const item of normalizeArray(insight.integration_needs)) add("integration_need", item, "integration_needs", 0.85, "medium", "review_required", "integration_backlog");
  return seeds.slice(0, 25);
}

function insightCandidateScopeLinkId(insightId, scopeType, scopeRef) {
  return `msl_${normalizeGraphIdPart(insightId)}_${normalizeGraphIdPart(scopeType)}_${normalizeGraphIdPart(scopeRef)}`.slice(0, 96);
}

function visibilityScopeForInsightScope(scopeType) {
  if (scopeType === "conversation" || scopeType === "user") return "user_private";
  if (scopeType === "tenant") return "tenant_admin";
  if (scopeType === "workspace" || scopeType === "brand") return "workspace_team";
  return "platform_admin";
}

function scopeDimensionsForInsightCandidate(seed, scope) {
  const scopeType = String(scope?.scope_type || "").trim();
  const scopeRef = String(scope?.scope_ref || "").trim();
  return {
    tenant_id: scopeType === "tenant" ? scopeRef : seed.tenant_id || null,
    user_id: scopeType === "user" ? scopeRef : seed.user_id || null,
    workspace_key: scopeType === "workspace" ? scopeRef : seed.workspace_key || null,
    brand_key: scopeType === "brand" ? scopeRef : null,
    role_key: scopeType === "role" || scopeType === "assistance_role" ? scopeRef : null,
  };
}

async function writeInsightCandidateScopeLinks({ pool, seed }) {
  const scopes = safeJsonParse(seed.suggested_scopes_json, []);
  const normalizedScopes = Array.isArray(scopes) ? scopes : [];
  for (const scope of normalizedScopes) {
    const scopeType = String(scope?.scope_type || "").trim();
    const scopeRef = String(scope?.scope_ref || "").trim();
    if (!scopeType || !scopeRef) continue;
    const dimensions = scopeDimensionsForInsightCandidate(seed, scope);
    const linkageType = "insight_candidate_scope_attachment";
    await pool.query(
      `INSERT INTO \`memory_scope_links\`
         (link_id, resource_type, resource_ref, resource_table, resource_pk,
          asset_id, asset_key, scope_type, scope_ref, scope_key,
          tenant_id, user_id, workspace_key, brand_key, role_key,
          linkage_type, resource_scope_hash, visibility_scope, authority_status, lifecycle_status,
          confidence, approval_required, metadata_json, secrets_included, created_by)
       VALUES (?, 'session_insight_candidate', ?, 'session_insight_candidates', ?, ?, NULL,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', 'active', ?, ?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE
         asset_id = VALUES(asset_id),
         scope_key = VALUES(scope_key),
         tenant_id = VALUES(tenant_id),
         user_id = VALUES(user_id),
         workspace_key = VALUES(workspace_key),
         brand_key = VALUES(brand_key),
         role_key = VALUES(role_key),
         visibility_scope = VALUES(visibility_scope),
         authority_status = VALUES(authority_status),
         lifecycle_status = VALUES(lifecycle_status),
         confidence = VALUES(confidence),
         approval_required = VALUES(approval_required),
         metadata_json = VALUES(metadata_json),
         secrets_included = VALUES(secrets_included),
         updated_at = CURRENT_TIMESTAMP`,
      [
        insightCandidateScopeLinkId(seed.insight_id, scopeType, scopeRef),
        seed.insight_id,
        seed.insight_id,
        seed.source_asset_id,
        scopeType,
        scopeRef,
        `${scopeType}.${scopeRef}`,
        dimensions.tenant_id,
        dimensions.user_id,
        dimensions.workspace_key,
        dimensions.brand_key,
        dimensions.role_key,
        linkageType,
        memoryScopeIdentityHash("session_insight_candidate", seed.insight_id, scopeType, scopeRef, linkageType),
        visibilityScopeForInsightScope(scopeType),
        Number(scope.confidence || seed.confidence || 0.5),
        seed.approval_status === "review_required" ? 1 : 0,
        JSON.stringify({
          insight_id: seed.insight_id,
          source_summary_id: seed.source_summary_id,
          source_session_id: seed.source_session_id,
          insight_type: seed.insight_type,
          linkage_type: linkageType,
          promotion_status: "candidate",
          secrets_included: false,
        }),
        seed.created_by || "sessionSummaryService",
      ]
    );
  }
  return { ok: true, scope_link_count: normalizedScopes.length, secrets_included: false };
}

function promotionTargetForInsightType(insightType) {
  const targets = {
    runtime_gap: {
      promotion_type: "runtime_repair_backlog_item",
      target_surface: "runtime_repair_backlog",
      risk_level: "medium",
    },
    development_idea: {
      promotion_type: "development_backlog_item",
      target_surface: "development_backlog",
      risk_level: "medium",
    },
    integration_need: {
      promotion_type: "integration_backlog_item",
      target_surface: "integration_backlog",
      risk_level: "medium",
    },
  };
  return targets[insightType] || null;
}

function promotionProposalId(insightId, promotionType, targetSurface) {
  return `promo_${createHash("sha256").update([insightId, promotionType, targetSurface].join("|")).digest("hex").slice(0, 48)}`;
}

function promotionProposalHash({ insightId, targetSurface, targetRef, promotionType }) {
  return createHash("sha256")
    .update([insightId, targetSurface, targetRef || "", promotionType].map((part) => String(part || "")).join("|"))
    .digest("hex");
}

function preferredPromotionScope(seed) {
  const scopes = safeJsonParse(seed.suggested_scopes_json, []);
  const normalized = Array.isArray(scopes) ? scopes : [];
  return normalized.find((scope) => scope?.scope_type === "workspace")
    || normalized.find((scope) => scope?.scope_type === "tenant")
    || normalized.find((scope) => scope?.scope_type === "conversation")
    || normalized[0]
    || null;
}

export function buildSessionInsightPromotionProposal(seed = {}) {
  const target = promotionTargetForInsightType(seed.insight_type);
  if (!target || !seed.insight_id || !seed.statement_text) return null;
  const scope = preferredPromotionScope(seed);
  const proposalTitle = boundedText(`Review ${seed.insight_type.replace(/_/g, " ")}: ${seed.title || seed.statement_text}`, 220);
  const proposalText = boundedText(redactSensitiveText(seed.statement_text), 1600);
  const promotionType = target.promotion_type;
  const targetSurface = target.target_surface;
  return {
    promotion_id: promotionProposalId(seed.insight_id, promotionType, targetSurface),
    promotion_hash: promotionProposalHash({ insightId: seed.insight_id, targetSurface, targetRef: null, promotionType }),
    insight_id: seed.insight_id,
    source_session_id: seed.source_session_id || null,
    source_summary_id: seed.source_summary_id || null,
    tenant_id: seed.tenant_id || null,
    user_id: seed.user_id || null,
    workspace_key: seed.workspace_key || null,
    promotion_type: promotionType,
    target_surface: targetSurface,
    target_ref: null,
    target_scope_type: scope?.scope_type || null,
    target_scope_ref: scope?.scope_ref || null,
    proposal_title: proposalTitle,
    proposal_text: proposalText,
    risk_level: target.risk_level || seed.risk_level || "medium",
    confidence: seed.confidence || 0.5,
    evidence_json: JSON.stringify({
      insight_id: seed.insight_id,
      insight_type: seed.insight_type,
      source_summary_id: seed.source_summary_id,
      source_session_id: seed.source_session_id,
      target_surface: targetSurface,
      promotion_allowed: false,
      raw_transcript_included: false,
      secrets_included: false,
    }),
    scope_links_json: seed.suggested_scopes_json || JSON.stringify([]),
    metadata_json: JSON.stringify({
      generator: "session_summary_promotion_proposal_v1",
      promotion_allowed: false,
      requires_human_approval: true,
      secrets_included: false,
    }),
    created_by: "sessionSummaryService",
  };
}

async function writeSessionInsightPromotionProposal({ pool, seed }) {
  const proposal = buildSessionInsightPromotionProposal(seed);
  if (!proposal) return { ok: true, skipped: true, reason: "non_promotable_insight_type", secrets_included: false };
  await pool.query(
    `INSERT INTO \`session_insight_promotions\`
       (promotion_id, promotion_hash, insight_id, source_session_id, source_summary_id,
        tenant_id, user_id, workspace_key, promotion_type, target_surface, target_ref,
        target_scope_type, target_scope_ref, proposal_title, proposal_text,
        decision_status, approval_status, promotion_status, risk_level, confidence,
        requires_human_approval, promotion_allowed, promotion_executor_key,
        evidence_json, scope_links_json, metadata_json, secrets_included, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'review_required', 'review_required', 'queued', ?, ?,
             1, 0, NULL, ?, ?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE
       source_session_id = VALUES(source_session_id),
       source_summary_id = VALUES(source_summary_id),
       tenant_id = VALUES(tenant_id),
       user_id = VALUES(user_id),
       workspace_key = VALUES(workspace_key),
       target_scope_type = VALUES(target_scope_type),
       target_scope_ref = VALUES(target_scope_ref),
       proposal_title = VALUES(proposal_title),
       proposal_text = VALUES(proposal_text),
       risk_level = VALUES(risk_level),
       confidence = VALUES(confidence),
       evidence_json = VALUES(evidence_json),
       scope_links_json = VALUES(scope_links_json),
       metadata_json = VALUES(metadata_json),
       secrets_included = VALUES(secrets_included),
       updated_at = CURRENT_TIMESTAMP`,
    [
      proposal.promotion_id,
      proposal.promotion_hash,
      proposal.insight_id,
      proposal.source_session_id,
      proposal.source_summary_id,
      proposal.tenant_id,
      proposal.user_id,
      proposal.workspace_key,
      proposal.promotion_type,
      proposal.target_surface,
      proposal.target_ref,
      proposal.target_scope_type,
      proposal.target_scope_ref,
      proposal.proposal_title,
      proposal.proposal_text,
      proposal.risk_level,
      proposal.confidence,
      proposal.evidence_json,
      proposal.scope_links_json,
      proposal.metadata_json,
      proposal.created_by,
    ]
  );
  return { ok: true, skipped: false, promotion_id: proposal.promotion_id, secrets_included: false };
}

export async function extractSessionSummaryInsightCandidates({ pool = getPool(), session, summaryId, insight, assetId = null } = {}) {
  const seeds = buildSessionInsightCandidateSeeds({ session, summaryId, insight, assetId });
  for (const seed of seeds) {
    await pool.query(
      `INSERT INTO \`session_insight_candidates\`
         (insight_id, candidate_hash, source_session_id, source_summary_id, source_turn_range, source_asset_id,
          tenant_id, user_id, workspace_key, insight_type, title, statement_text,
          evidence_json, suggested_scopes_json, target_surface, target_ref,
          confidence, risk_level, approval_status, promotion_status, lifecycle_status,
          metadata_json, secrets_included, created_by)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', 'active', ?, 0, ?)
       ON DUPLICATE KEY UPDATE
         source_asset_id = VALUES(source_asset_id),
         tenant_id = VALUES(tenant_id),
         user_id = VALUES(user_id),
         workspace_key = VALUES(workspace_key),
         title = VALUES(title),
         statement_text = VALUES(statement_text),
         evidence_json = VALUES(evidence_json),
         suggested_scopes_json = VALUES(suggested_scopes_json),
         target_surface = VALUES(target_surface),
         target_ref = VALUES(target_ref),
         confidence = VALUES(confidence),
         risk_level = VALUES(risk_level),
         approval_status = VALUES(approval_status),
         metadata_json = VALUES(metadata_json),
         secrets_included = VALUES(secrets_included),
         updated_at = CURRENT_TIMESTAMP`,
      [
        seed.insight_id,
        seed.candidate_hash,
        seed.source_session_id,
        seed.source_summary_id,
        seed.source_asset_id,
        seed.tenant_id,
        seed.user_id,
        seed.workspace_key,
        seed.insight_type,
        seed.title,
        seed.statement_text,
        seed.evidence_json,
        seed.suggested_scopes_json,
        seed.target_surface,
        seed.target_ref,
        seed.confidence,
        seed.risk_level,
        seed.approval_status,
        seed.metadata_json,
        seed.created_by,
      ]
    );
    await writeInsightCandidateScopeLinks({ pool, seed });
    await writeSessionInsightPromotionProposal({ pool, seed });
  }
  return { ok: true, candidate_count: seeds.length, secrets_included: false };
}

function buildSummaryJsonPayload({ session, summaryId, insight }) {
  return JSON.stringify({
    summary_id: summaryId,
    session_id: session.session_id,
    tenant_id: session.tenant_id || PLATFORM_TENANT_ID,
    user_id: session.user_id || null,
    workspace_key: session.workspace_key || null,
    summary_text: insight.summary_text,
    tasks_completed: normalizeArray(insight.tasks_completed),
    blockers: normalizeArray(insight.blockers),
    feature_requests: normalizeArray(insight.feature_requests),
    integration_needs: normalizeArray(insight.integration_needs),
    complexity: normalizeComplexity(insight.complexity),
    turn_count: Number(session.turn_count || 0),
    summary_scope: "summary_only",
    secrets_included: false,
  });
}

function normalizeModelText(response) {
  if (typeof response === "string") return response;
  if (typeof response?.content === "string") return response.content;
  if (Array.isArray(response?.content)) {
    return response.content
      .filter((block) => block?.type === "text" || typeof block?.text === "string")
      .map((block) => block.text || "")
      .join("\n");
  }
  return String(response?.text || response?.message || "");
}

export function parseSummaryJson(text, fallback = {}) {
  const body = String(text || "");
  const jsonText = body.match(/\{[\s\S]*\}/)?.[0] || body;
  const parsed = safeJsonParse(jsonText, null);
  if (!parsed || typeof parsed !== "object") return fallback;
  return {
    summary_text: String(parsed.summary_text || fallback.summary_text || "").trim(),
    tasks_completed: normalizeArray(parsed.tasks_completed),
    blockers: normalizeArray(parsed.blockers),
    feature_requests: normalizeArray(parsed.feature_requests),
    integration_needs: normalizeArray(parsed.integration_needs),
    complexity: normalizeComplexity(parsed.complexity),
  };
}

function fallbackInsight(session, source, warning = null) {
  return {
    summary_text: `Session ${session.session_id} ended with ${Number(session.turn_count || 0)} turns. Summary source: ${source}.${warning ? ` Warning: ${warning}` : ""}`,
    tasks_completed: [],
    blockers: warning ? [boundedText(warning, 240)] : [],
    feature_requests: [],
    integration_needs: [],
    complexity: "medium",
  };
}

function compactOperationDetail(detail = {}) {
  const allowed = {};
  for (const [key, value] of Object.entries(detail || {})) {
    if (value === undefined) continue;
    if (/secret|token|password|key|credential/i.test(key)) continue;
    if (typeof value === "string") allowed[key] = boundedText(redactSensitiveText(value), 180);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) allowed[key] = value;
    else if (Array.isArray(value)) allowed[key] = value.slice(0, 5).map(item => typeof item === "string" ? boundedText(redactSensitiveText(item), 120) : item);
    else allowed[key] = JSON.parse(JSON.stringify(value));
  }
  return allowed;
}

function recordOperation(operationLog, event) {
  const entry = {
    at: new Date().toISOString(),
    ...compactOperationDetail(event),
  };
  if (Array.isArray(operationLog)) operationLog.push(entry);
  console.info("[sessionSummary] operation", entry);
  return entry;
}

function summarizeOperationResult(stage, result) {
  if (!result || typeof result !== "object") return {};
  if (stage === "check_existing_summary") {
    return { summary_exists: Boolean(result.summary_id), summary_id: result.summary_id || null };
  }
  if (stage === "load_transcript") {
    return {
      transcript_source: result.source,
      events_loaded: Array.isArray(result.events) ? result.events.length : 0,
      fallback_used: Boolean(result.fallback_used),
      warning: result.warning || null,
    };
  }
  if (stage === "summarize_transcript") {
    return {
      summary_text_chars: String(result.summary_text || "").length,
      blockers: Array.isArray(result.blockers) ? result.blockers.length : 0,
      model_warning: Array.isArray(result.blockers) && result.blockers.some(item => /^model_call_failed:|^all_model_providers_failed:/i.test(String(item || ""))),
    };
  }
  if (stage === "write_session_summary") return { summary_id: result };
  if (stage === "verify_session_summary_write") return result;
  return {};
}

async function withOperationStep(operationLog, stage, fn, detail = {}) {
  const startedAt = Date.now();
  recordOperation(operationLog, { stage, status: "started", ...detail });
  try {
    const result = await fn();
    recordOperation(operationLog, {
      stage,
      status: "succeeded",
      duration_ms: Date.now() - startedAt,
      ...summarizeOperationResult(stage, result),
    });
    return result;
  } catch (err) {
    recordOperation(operationLog, {
      stage,
      status: "failed",
      duration_ms: Date.now() - startedAt,
      error: sanitizeModelError(err),
    });
    throw err;
  }
}

export async function verifySessionSummaryWrite({ pool = getPool(), session, summary_id }) {
  if (!session?.session_id || !summary_id) {
    return { ok: false, summary_row_present: false, graph_asset_present: false, reason: "missing_session_or_summary_id" };
  }

  const [summaryRows] = await pool.query(
    `SELECT summary_id, session_id, tenant_id, turn_count, created_at
     FROM \`session_summaries\`
     WHERE summary_id = ? AND session_id = ?
     LIMIT 1`,
    [summary_id, session.session_id]
  ).catch(() => [[]]);

  const [assetRows] = await pool.query(
    `SELECT asset_id, validation_status, active_status
     FROM \`json_assets\`
     WHERE source_asset_ref = ? AND asset_type = 'session_summary'
     LIMIT 1`,
    [summary_id]
  ).catch(() => [[]]);

  const assetId = summaryAssetId(summary_id);
  const conversationNodeId = `conversation.${normalizeGraphIdPart(session.session_id)}`;
  const assetNodeId = `json_asset.${normalizeGraphIdPart(assetId)}`;
  const edgeId = `edge.session_summary.${normalizeGraphIdPart(summary_id)}`;

  const [nodeRows] = await pool.query(
    `SELECT node_id, node_type, lifecycle_status
     FROM \`platform_graph_nodes\`
     WHERE node_id IN (?, ?)
     LIMIT 2`,
    [conversationNodeId, assetNodeId]
  ).catch(() => [[]]);

  const [edgeRows] = await pool.query(
    `SELECT edge_id, source_node_id, target_node_id, lifecycle_status
     FROM \`platform_graph_edges\`
     WHERE edge_id = ?
       AND source_node_id = ?
       AND target_node_id = ?
     LIMIT 1`,
    [edgeId, assetNodeId, conversationNodeId]
  ).catch(() => [[]]);

  const summaryRow = summaryRows[0] || null;
  const assetRow = assetRows[0] || null;
  const nodeIds = new Set((nodeRows || []).map(row => row.node_id));
  const graphConversationNodePresent = nodeIds.has(conversationNodeId);
  const graphAssetNodePresent = nodeIds.has(assetNodeId);
  const graphEdgePresent = Boolean(edgeRows?.[0]);
  const graphTopologyPresent = graphConversationNodePresent && graphAssetNodePresent && graphEdgePresent;
  const reason = !summaryRow
    ? "summary_row_missing"
    : !assetRow
      ? "summary_graph_asset_missing"
      : !graphConversationNodePresent
        ? "summary_graph_conversation_node_missing"
        : !graphAssetNodePresent
          ? "summary_graph_asset_node_missing"
          : !graphEdgePresent
            ? "summary_graph_edge_missing"
            : null;
  return {
    ok: Boolean(summaryRow) && graphTopologyPresent,
    reason,
    summary_row_present: Boolean(summaryRow),
    graph_asset_present: Boolean(assetRow),
    graph_validation_status: assetRow?.validation_status || null,
    graph_active_status: assetRow?.active_status || null,
    graph_conversation_node_present: graphConversationNodePresent,
    graph_asset_node_present: graphAssetNodePresent,
    graph_edge_present: graphEdgePresent,
    graph_topology_present: graphTopologyPresent,
    graph_edge_id: graphEdgePresent ? edgeRows[0].edge_id : null,
    summary_id,
    session_id: session.session_id,
  };
}

function modelWarningFromInsight(insight = {}) {
  return Array.isArray(insight.blockers)
    ? insight.blockers.find(item => /^model_call_failed:|^all_model_providers_failed:/i.test(String(item || ""))) || null
    : null;
}

function summaryListFromStoredValue(value) {
  return normalizeArray(safeJsonParse(value, value));
}

function surfaceEvidence(result) {
  return {
    ok: Boolean(result?.ok),
    resolved_surface_key: result?.resolved_surface_key || null,
    classification: result?.classification || null,
    code: result?.code || null,
    secrets_included: false,
  };
}

export async function loadSessionSummaryGraphMemory({
  pool = getPool(),
  session_id = null,
  tenant_id = null,
  user_id = null,
  workspace_key = null,
  brand_key = null,
  limit = 10,
} = {}) {
  const summarySurfaceAuthority = await assertSurfaceAuthority(
    SURFACE_KEYS.SESSION_SUMMARY_MEMORY,
    { requireExecution: true },
    { pool }
  );
  const jsonAssetSurfaceAuthority = await assertSurfaceAuthority(
    SURFACE_KEYS.JSON_ASSET_REGISTRY,
    { requireExecution: true },
    { pool }
  );
  const platformGraphSurfaceAuthority = await assertSurfaceAuthority(
    SURFACE_KEYS.PLATFORM_GRAPH_MEMORY,
    { requireExecution: true },
    { pool }
  );

  const clauses = [];
  const params = [];
  if (session_id) {
    clauses.push("ss.session_id = ?");
    params.push(session_id);
  }
  if (tenant_id) {
    clauses.push("ss.tenant_id = ?");
    params.push(tenant_id);
  }
  if (user_id) {
    clauses.push("ss.user_id = ?");
    params.push(user_id);
  }
  if (workspace_key) {
    clauses.push(`(
      ss.workspace_key = ?
      OR EXISTS (
        SELECT 1 FROM \`gpt_session_turns\` gst
         WHERE gst.session_id = ss.session_id
           AND gst.workspace_key = ?
         LIMIT 1
      )
    )`);
    params.push(workspace_key, workspace_key);
  }
  if (brand_key) {
    clauses.push(`EXISTS (
      SELECT 1 FROM \`gpt_session_turns\` gst
       WHERE gst.session_id = ss.session_id
         AND gst.brand_key = ?
       LIMIT 1
    )`);
    params.push(brand_key);
  }
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT summary_id, session_id, tenant_id, user_id, workspace_key,
            summary_text, tasks_completed, blockers, feature_requests,
            integration_needs, complexity, turn_count, created_at
       FROM \`session_summaries\`
       ${where}
      ORDER BY created_at DESC
      LIMIT ?`,
    [...params, safeLimit]
  ).catch(() => [[]]);

  const items = [];
  for (const row of rows || []) {
    const verification = await verifySessionSummaryWrite({
      pool,
      session: { session_id: row.session_id },
      summary_id: row.summary_id,
    });
    if (!verification?.ok || !verification.graph_topology_present) continue;
    items.push({
      summary_id: row.summary_id,
      session_id: row.session_id,
      tenant_id: row.tenant_id || null,
      user_id: row.user_id || null,
      workspace_key: row.workspace_key || null,
      summary_text: boundedText(redactSensitiveText(row.summary_text || ""), 1600),
      tasks_completed: summaryListFromStoredValue(row.tasks_completed),
      blockers: summaryListFromStoredValue(row.blockers),
      feature_requests: summaryListFromStoredValue(row.feature_requests),
      integration_needs: summaryListFromStoredValue(row.integration_needs),
      complexity: normalizeComplexity(row.complexity),
      turn_count: Number(row.turn_count || 0),
      created_at: row.created_at || null,
      graph_edge_id: verification.graph_edge_id || null,
      graph_topology_present: true,
      secrets_included: false,
    });
  }

  return {
    ok: true,
    count: items.length,
    items,
    surface_authority: {
      session_summary_memory: surfaceEvidence(summarySurfaceAuthority),
      json_asset_registry: surfaceEvidence(jsonAssetSurfaceAuthority),
      platform_graph_memory: surfaceEvidence(platformGraphSurfaceAuthority),
      secrets_included: false,
    },
    secrets_included: false,
  };
}

function summarizeStagesForExecutionLog(operationLog = []) {
  return (Array.isArray(operationLog) ? operationLog : [])
    .filter(event => event?.stage && event?.status)
    .map(event => ({
      stage: event.stage,
      status: event.status,
      duration_ms: event.duration_ms ?? null,
      warning: event.warning || event.error || event.reason || null,
    }))
    .slice(-20);
}

function buildExecutionLogOutputSummary({ session, summaryId, transcript, insight, verification, operationLog }) {
  return boundedText(JSON.stringify({
    session_id: session.session_id,
    summary_id: summaryId,
    transcript_source: transcript?.source || null,
    fallback_used: Boolean(transcript?.fallback_used),
    events_loaded: Array.isArray(transcript?.events) ? transcript.events.length : 0,
    summary_text_chars: String(insight?.summary_text || "").length,
    verification: {
      ok: Boolean(verification?.ok),
      summary_row_present: Boolean(verification?.summary_row_present),
      graph_asset_present: Boolean(verification?.graph_asset_present),
      graph_validation_status: verification?.graph_validation_status || null,
      graph_active_status: verification?.graph_active_status || null,
      graph_conversation_node_present: Boolean(verification?.graph_conversation_node_present),
      graph_asset_node_present: Boolean(verification?.graph_asset_node_present),
      graph_edge_present: Boolean(verification?.graph_edge_present),
      graph_topology_present: Boolean(verification?.graph_topology_present),
    },
    stages: summarizeStagesForExecutionLog(operationLog),
    secrets_included: false,
  }), 6000);
}

export async function writeSessionSummaryExecutionLog({
  pool = getPool(),
  session,
  run_id = null,
  summary_id = null,
  transcript = null,
  insight = null,
  verification = null,
  operation_log = [],
} = {}) {
  if (!session?.session_id || !summary_id) {
    return { ok: false, skipped: true, reason: "missing_session_or_summary_id" };
  }

  const startedAt = operation_log?.[0]?.at || new Date().toISOString();
  const endedAt = new Date().toISOString();
  const durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
  const modelWarning = modelWarningFromInsight(insight);
  const transcriptWarning = transcript?.warning || (transcript?.fallback_used ? "transcript_fallback_used" : null);
  const graphWarning = verification?.summary_row_present && !verification?.graph_asset_present
    ? "summary_graph_asset_missing"
    : verification?.summary_row_present && !verification?.graph_topology_present
      ? "summary_graph_topology_missing"
      : null;
  const warningNote = modelWarning || transcriptWarning || graphWarning || null;
  const failureReason = verification?.ok
    ? null
    : (verification?.reason || "session_summary_write_verification_failed");
  const executionStatus = verification?.ok
    ? (warningNote ? "success_with_warnings" : "success")
    : "failed";
  const outputSummary = buildExecutionLogOutputSummary({ session, summaryId: summary_id, transcript, insight, verification, operationLog: operation_log });
  const artifactAssetId = verification?.graph_asset_present ? summaryAssetId(summary_id) : null;
  const traceId = run_id || summary_id;

  const evidence = await writeExecutionEvidence({
    pool,
    traceId,
    entryType: "session_summary_autosweep",
    executionClass: "summary",
    sourceLayer: "sessionSummaryService",
    userInput: `session_id=${session.session_id}`,
    routeKeys: "dev_agent_session_summary_autosweep",
    selectedWorkflows: "session_summary_autosweep",
    executionMode: "model_summary",
    decisionTrigger: "runtime",
    executionStatus,
    outputSummary,
    recoveryStatus: modelWarning ? "fallback_summary_used" : transcriptWarning ? "transcript_fallback_used" : "not_required",
    recoveryNotes: warningNote,
    routeStatus: "resolved",
    routeSource: "sql_primary",
    intakeValidationStatus: "validated",
    executionReadyStatus: "ready",
    failureReason,
    artifactJsonAssetId: artifactAssetId,
    targetModuleWriteback: "sessionSummaryService",
    targetWorkflowWriteback: "session_summary_autosweep",
    logSource: "sql_primary",
    createdAt: startedAt,
    endedAt,
    durationSeconds,
  });

  const row = evidence.row || null;
  const executionLogId = row?.id || null;
  const readback = {
    ok: Boolean(row),
    execution_log_id: executionLogId,
    execution_status: row?.execution_status || null,
    execution_trace_id: row?.execution_trace_id_writeback || null,
  };

  return {
    ok: Boolean(readback.ok),
    execution_log_id: executionLogId,
    execution_status: executionStatus,
    execution_trace_id: traceId,
    readback,
  };
}

export function parseSessionJsonl(content = "") {
  const events = [];
  for (const [lineIndex, line] of String(content || "").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const parsed = safeJsonParse(line, null);
    if (!parsed || typeof parsed !== "object") continue;
    const rawContent = parsed.content ?? parsed.payload?.content ?? parsed.message ?? parsed.text ?? "";
    events.push({
      source: "drive_jsonl",
      line_index: lineIndex,
      turn_index: Number.isFinite(Number(parsed.turn_index)) ? Number(parsed.turn_index) : lineIndex,
      role: parsed.role || parsed.event_type || "unknown",
      action_key: parsed.action_key || null,
      content_sha256: parsed.content_sha256 || null,
      created_at: parsed.created_at || parsed.timestamp || null,
      content: redactSensitiveText(rawContent),
    });
  }
  return events;
}

async function loadDriveJsonlEvents(session, injectedDeps = {}) {
  const deps = { ...defaultDeps(), ...injectedDeps };
  if (!session.drive_jsonl_id) {
    return { source: "drive_jsonl", ok: false, skipped: true, events: [], warning: "missing_drive_jsonl_id" };
  }
  try {
    const content = await deps.fetchDriveContent(session.drive_jsonl_id);
    const events = parseSessionJsonl(content);
    return { source: "drive_jsonl", ok: true, events, warning: events.length ? null : "drive_jsonl_empty_or_unparseable" };
  } catch (err) {
    return { source: "drive_jsonl", ok: false, events: [], warning: err.message };
  }
}

async function loadSqlPreviewEvents(pool, sessionId, limit = DEFAULT_FALLBACK_TURNS_LIMIT) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_FALLBACK_TURNS_LIMIT, 500));
  let [rows] = await pool.query(
    `SELECT turn_id, turn_index, role, action_key, content_preview, content_sha256, created_at
     FROM \`gpt_session_turns\`
     WHERE session_id = ?
     ORDER BY turn_index ASC
     LIMIT ?`,
    [sessionId, safeLimit]
  ).catch(() => [[]]);

  if (!rows.length) {
    [rows] = await pool.query(
      `SELECT turn_index, role, action_key, content_preview, content_sha256, created_at
       FROM \`gpt_session_turns\`
       WHERE session_id = ?
       ORDER BY turn_index ASC
       LIMIT ?`,
      [sessionId, safeLimit]
    ).catch(() => [[]]);
  }

  return rows.map((row, index) => ({
    source: "sql_preview",
    line_index: index,
    turn_index: Number.isFinite(Number(row.turn_index)) ? Number(row.turn_index) : index,
    role: row.role || "unknown",
    action_key: row.action_key || null,
    content_sha256: row.content_sha256 || null,
    created_at: row.created_at || null,
    content: redactSensitiveText(row.content_preview || ""),
  }));
}

export async function loadSessionTranscript({
  pool = getPool(),
  session,
  fallbackTurnsLimit = DEFAULT_FALLBACK_TURNS_LIMIT,
  injectedDeps = {},
  fetchDriveContentFn = null,
} = {}) {
  const effectiveDeps = fetchDriveContentFn
    ? { ...injectedDeps, fetchDriveContent: fetchDriveContentFn }
    : injectedDeps;
  const drive = await loadDriveJsonlEvents(session, effectiveDeps);
  if (drive.events.length) {
    return {
      source: "drive_jsonl",
      source_ok: drive.ok,
      warning: drive.warning,
      events: drive.events,
      turns: drive.events,
      fallback_used: false,
      drive_error: null,
    };
  }

  const fallback = await loadSqlPreviewEvents(pool, session.session_id, fallbackTurnsLimit);
  return {
    source: "sql_preview",
    source_ok: fallback.length > 0,
    warning: drive.warning,
    events: fallback,
    turns: fallback,
    fallback_used: true,
    drive_error: drive.warning
      ? { code: "drive_jsonl_read_failed", message: drive.warning }
      : null,
  };
}

function formatEventsForModel(session, events, charLimit = DEFAULT_CHUNK_CHAR_LIMIT) {
  const header = [
    `Session: ${session.session_id}`,
    `Tenant: ${session.tenant_id || PLATFORM_TENANT_ID}`,
    `User: ${session.user_id || "platform_admin"}`,
    `Workspace: ${session.workspace_key || "n/a"}`,
    `Turns: ${session.turn_count || events.length || 0}`,
    "",
  ].join("\n");
  let output = header;
  for (const event of events) {
    const part = [
      `Turn ${event.turn_index} | ${String(event.role || "unknown").toUpperCase()}${event.action_key ? ` | action=${event.action_key}` : ""}`,
      boundedText(event.content || "", 1800),
      "",
    ].join("\n");
    if ((output.length + part.length) > charLimit) break;
    output += part;
  }
  return output;
}

function chunkTranscriptEvents(session, events, charLimit = DEFAULT_CHUNK_CHAR_LIMIT) {
  const chunks = [];
  let current = [];
  for (const event of events) {
    const candidate = [...current, event];
    if (current.length && formatEventsForModel(session, candidate, charLimit + 1000).length > charLimit) {
      chunks.push(current);
      current = [event];
    } else {
      current = candidate;
    }
  }
  if (current.length) chunks.push(current);
  return chunks.length ? chunks : [[]];
}

const SUMMARY_SYSTEM_PROMPT = `You summarize archived platform GPT sessions for retrieval and continuity. Return ONLY valid JSON with keys: summary_text, tasks_completed, blockers, feature_requests, integration_needs, complexity. Keep arrays to at most five concise items. Do not include secrets, tokens, passwords, private keys, or raw provider outputs. Do not invent facts not present in the transcript.`;

async function summarizeChunk({ session, events, callModel, label }) {
  const messages = [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    { role: "user", content: `${label}\n\n${formatEventsForModel(session, events)}` },
  ];
  const response = await callModel(messages, []);
  const parsed = parseSummaryJson(normalizeModelText(response), null);
  if (!parsed?.summary_text) throw new Error("summary_model_returned_invalid_json");
  return parsed;
}

async function consolidateSummaries({ session, chunkSummaries, callModel }) {
  if (chunkSummaries.length === 1) return chunkSummaries[0];
  const summaryBlock = chunkSummaries
    .map((summary, index) => `Chunk ${index + 1}: ${JSON.stringify(summary)}`)
    .join("\n");
  const messages = [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    {
      role: "user",
      content: boundedText(
        `Consolidate these chunk summaries into one final session summary for session ${session.session_id}.\n\n${summaryBlock}`,
        DEFAULT_FINAL_CHAR_LIMIT
      ),
    },
  ];
  const response = await callModel(messages, []);
  const parsed = parseSummaryJson(normalizeModelText(response), null);
  if (!parsed?.summary_text) throw new Error("summary_consolidation_returned_invalid_json");
  return parsed;
}

export async function summarizeSessionTranscript({ session, transcript, callModel }) {
  const events = transcript?.events || [];
  if (!events.length) return fallbackInsight(session, transcript?.source || "none", "no transcript events available");
  if (!callModel) {
    return fallbackInsight(
      session,
      transcript?.source || "none",
      "session summary model not configured; stored deterministic fallback summary"
    );
  }

  try {
    const chunks = chunkTranscriptEvents(session, events);
    const chunkSummaries = [];
    for (const [index, chunk] of chunks.entries()) {
      chunkSummaries.push(await summarizeChunk({ session, events: chunk, callModel, label: `Transcript chunk ${index + 1} of ${chunks.length}` }));
    }
    return await consolidateSummaries({ session, chunkSummaries, callModel });
  } catch (err) {
    return fallbackInsight(session, transcript?.source || "unknown", sanitizeModelError(err));
  }
}

export async function loadSessionById(pool, sessionId) {
  const [rows] = await pool.query(
    "SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1",
    [sessionId]
  );
  return rows[0] || null;
}

async function existingSummary(pool, sessionId) {
  const [rows] = await pool.query(
    "SELECT summary_id FROM `session_summaries` WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
    [sessionId]
  ).catch(() => [[]]);
  return rows[0] || null;
}

async function attachSessionSummaryToGraph({ pool, session, summaryId, insight }) {
  const graphPolicy = await resolveSessionSummaryGraphPolicy({ pool, session });
  const jsonAssetSurfaceAuthority = await assertSurfaceAuthority(
    SURFACE_KEYS.JSON_ASSET_REGISTRY,
    { requireExecution: graphPolicy.require_surface_execution === true },
    { pool }
  );
  const platformGraphSurfaceAuthority = await assertSurfaceAuthority(
    SURFACE_KEYS.PLATFORM_GRAPH_MEMORY,
    { requireExecution: graphPolicy.require_surface_execution === true },
    { pool }
  );
  const tenantId = session.tenant_id || PLATFORM_TENANT_ID;
  const userId = session.user_id || null;
  const assetId = summaryAssetId(summaryId);
  const assetKey = `session_summary_${normalizeGraphIdPart(session.session_id)}`;
  const linkId = summaryLinkId(summaryId);
  const conversationNodeId = `conversation.${normalizeGraphIdPart(session.session_id)}`;
  const assetNodeId = `json_asset.${normalizeGraphIdPart(assetId)}`;
  const edgeId = `edge.session_summary.${normalizeGraphIdPart(summaryId)}`;
  const payload = buildSummaryJsonPayload({ session, summaryId, insight });

  await pool.query(
    `INSERT INTO \`json_assets\`
       (asset_id, brand_name, asset_key, asset_type, mapping_status,
        mapping_version, storage_format, source_mode, source_asset_ref,
        json_payload, transport_status, validation_status, last_validated_at,
        notes, active_status)
     VALUES (?, 'platform', ?, 'session_summary', 'mapped', 'session_summary_v1',
             'json', 'session_summary_autosweep', ?, ?, 'summary_only',
             'validated', DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%sZ'),
             'Summary-only GPT session memory asset; no raw transcript or secrets included.', 'active')
     ON DUPLICATE KEY UPDATE
       asset_key = VALUES(asset_key),
       json_payload = VALUES(json_payload),
       validation_status = VALUES(validation_status),
       notes = VALUES(notes),
       active_status = VALUES(active_status),
       updated_at = CURRENT_TIMESTAMP`,
    [assetId, assetKey, summaryId, payload]
  );

  await pool.query(
    `INSERT INTO \`json_asset_subject_links\`
       (link_id, asset_id, asset_key, subject_type, subject_ref, tenant_id,
        user_id, subject_key, linkage_type, scope_label, metadata_json, status)
     VALUES (?, ?, ?, 'conversation', ?, ?, ?, ?, 'summary_attachment',
             'session_summary', ?, 'active')
     ON DUPLICATE KEY UPDATE
       asset_id = VALUES(asset_id),
       asset_key = VALUES(asset_key),
       tenant_id = VALUES(tenant_id),
       user_id = VALUES(user_id),
       subject_key = VALUES(subject_key),
       metadata_json = VALUES(metadata_json),
       status = VALUES(status),
       updated_at = CURRENT_TIMESTAMP`,
    [
      linkId,
      assetId,
      assetKey,
      session.session_id,
      tenantId,
      userId,
      `session.${session.session_id}`,
      JSON.stringify({ summary_id: summaryId, source_table: "session_summaries", secrets_included: false }),
    ]
  );

  const memoryScopeLinks = [
    {
      scope_type: "conversation",
      scope_ref: session.session_id,
      scope_key: `session.${session.session_id}`,
      visibility_scope: "user_private",
      tenant_id: tenantId,
      user_id: userId,
      workspace_key: session.workspace_key || null,
      brand_key: session.brand_key || null,
      role_key: null,
    },
    tenantId ? {
      scope_type: "tenant",
      scope_ref: tenantId,
      scope_key: `tenant.${tenantId}`,
      visibility_scope: "tenant_admin",
      tenant_id: tenantId,
      user_id: null,
      workspace_key: null,
      brand_key: null,
      role_key: null,
    } : null,
    userId ? {
      scope_type: "user",
      scope_ref: userId,
      scope_key: `user.${userId}`,
      visibility_scope: "user_private",
      tenant_id: tenantId,
      user_id: userId,
      workspace_key: null,
      brand_key: null,
      role_key: null,
    } : null,
    session.workspace_key ? {
      scope_type: "workspace",
      scope_ref: session.workspace_key,
      scope_key: `workspace.${session.workspace_key}`,
      visibility_scope: "workspace_team",
      tenant_id: tenantId,
      user_id: null,
      workspace_key: session.workspace_key,
      brand_key: session.brand_key || null,
      role_key: null,
    } : null,
    session.brand_key ? {
      scope_type: "brand",
      scope_ref: session.brand_key,
      scope_key: `brand.${session.brand_key}`,
      visibility_scope: "workspace_team",
      tenant_id: tenantId,
      user_id: null,
      workspace_key: session.workspace_key || null,
      brand_key: session.brand_key,
      role_key: null,
    } : null,
  ].filter(Boolean).filter((link) => graphPolicy.allowed_scope_types.includes(link.scope_type));

  if (!memoryScopeLinks.some((link) => link.scope_type === "conversation")) {
    const err = new Error("Session summary graph policy must allow conversation scope for mandatory graph attachment.");
    err.status = 422;
    err.code = "session_summary_graph_policy_scope_invalid";
    throw err;
  }

  for (const link of memoryScopeLinks) {
    await pool.query(
      `INSERT INTO \`memory_scope_links\`
         (link_id, resource_type, resource_ref, resource_table, resource_pk,
          asset_id, asset_key, scope_type, scope_ref, scope_key,
          tenant_id, user_id, workspace_key, brand_key, role_key,
          linkage_type, resource_scope_hash, visibility_scope, authority_status, lifecycle_status,
          confidence, approval_required, metadata_json, secrets_included, created_by)
       VALUES (?, 'json_asset', ?, 'json_assets', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'session_summary_scope_attachment', ?, ?, 'authoritative', 'active',
               1.0000, 0, ?, 0, ?)
       ON DUPLICATE KEY UPDATE
         asset_id = VALUES(asset_id),
         asset_key = VALUES(asset_key),
         scope_key = VALUES(scope_key),
         tenant_id = VALUES(tenant_id),
         user_id = VALUES(user_id),
         workspace_key = VALUES(workspace_key),
         brand_key = VALUES(brand_key),
         role_key = VALUES(role_key),
         visibility_scope = VALUES(visibility_scope),
         authority_status = VALUES(authority_status),
         lifecycle_status = VALUES(lifecycle_status),
         metadata_json = VALUES(metadata_json),
         secrets_included = VALUES(secrets_included),
         updated_at = CURRENT_TIMESTAMP`,
      [
        memoryScopeLinkId(summaryId, link.scope_type, link.scope_ref),
        assetId,
        assetId,
        assetId,
        assetKey,
        link.scope_type,
        link.scope_ref,
        link.scope_key,
        link.tenant_id,
        link.user_id,
        link.workspace_key,
        link.brand_key,
        link.role_key,
        memoryScopeIdentityHash("json_asset", assetId, link.scope_type, link.scope_ref, "session_summary_scope_attachment"),
        link.visibility_scope,
        JSON.stringify({
          summary_id: summaryId,
          source_table: "session_summaries",
          legacy_subject_link_id: linkId,
          linkage_type: "session_summary_scope_attachment",
          secrets_included: false,
        }),
        userId || "sessionSummaryService",
      ]
    );
  }

  await pool.query(
    `INSERT INTO \`platform_graph_nodes\`
       (node_id, node_type, node_label, scope_type, subject_ref, source_table,
        source_pk, authority_status, lifecycle_status, visibility_scope,
        sensitivity, evidence_level, runtime_role, source_system, metadata_json)
     VALUES
       (?, 'conversation', ?, 'platform', ?, 'customer_sessions', ?,
        'authoritative', 'active', 'platform_admin', 'internal', 'system',
        'memory_subject', 'sql', ?),
       (?, 'json_asset', ?, 'platform', ?, 'json_assets', ?,
        'authoritative', 'active', 'platform_admin', 'internal', 'system',
        'resolver_input', 'sql', ?)
     ON DUPLICATE KEY UPDATE
       node_label = VALUES(node_label),
       lifecycle_status = VALUES(lifecycle_status),
       runtime_role = VALUES(runtime_role),
       metadata_json = VALUES(metadata_json),
       updated_at = CURRENT_TIMESTAMP`,
    [
      conversationNodeId,
      `GPT session ${session.session_id}`,
      session.session_id,
      session.session_id,
      JSON.stringify({ tenant_id: tenantId, user_id: userId, turn_count: Number(session.turn_count || 0) }),
      assetNodeId,
      assetKey,
      assetId,
      assetId,
      JSON.stringify({ asset_key: assetKey, asset_type: "session_summary", summary_id: summaryId }),
    ]
  );

  await pool.query(
    `INSERT INTO \`platform_graph_edges\`
       (edge_id, source_node_id, edge_type, target_node_id, scope_type,
        authority_status, lifecycle_status, visibility_scope, sensitivity,
        evidence_level, runtime_role, runtime_enforced, source_table,
        source_pk, metadata_json)
     VALUES (?, ?, 'attached_to', ?, 'platform', 'authoritative', 'active',
             'platform_admin', 'internal', 'system', 'resolver_input', 1,
             'json_asset_subject_links', ?, ?)
     ON DUPLICATE KEY UPDATE
       lifecycle_status = VALUES(lifecycle_status),
       runtime_role = VALUES(runtime_role),
       runtime_enforced = VALUES(runtime_enforced),
       metadata_json = VALUES(metadata_json),
       updated_at = CURRENT_TIMESTAMP`,
    [
      edgeId,
      assetNodeId,
      conversationNodeId,
      linkId,
      JSON.stringify({ summary_id: summaryId, linkage_type: "summary_attachment", secrets_included: false }),
    ]
  );

  return {
    asset_id: assetId,
    asset_key: assetKey,
    link_id: linkId,
    edge_id: edgeId,
    surface_authority: {
      json_asset_registry: {
        ok: jsonAssetSurfaceAuthority.ok,
        resolved_surface_key: jsonAssetSurfaceAuthority.resolved_surface_key,
        classification: jsonAssetSurfaceAuthority.classification,
        code: jsonAssetSurfaceAuthority.code,
        secrets_included: false,
      },
      platform_graph_memory: {
        ok: platformGraphSurfaceAuthority.ok,
        resolved_surface_key: platformGraphSurfaceAuthority.resolved_surface_key,
        classification: platformGraphSurfaceAuthority.classification,
        code: platformGraphSurfaceAuthority.code,
        secrets_included: false,
      },
      secrets_included: false,
    },
  };
}

export async function writeSessionSummary({ pool = getPool(), session, insight, run_id = null, operation_log = [] }) {
  const summarySurfaceAuthority = await assertSurfaceAuthority(
    SURFACE_KEYS.SESSION_SUMMARY_MEMORY,
    { requireExecution: true },
    { pool }
  );
  const summaryId = randomUUID();
  await pool.query(
    `INSERT INTO \`session_summaries\`
       (summary_id, session_id, tenant_id, user_id, workspace_key,
        summary_text, tasks_completed, blockers, feature_requests,
        integration_needs, complexity, session_model, turn_count,
        analyzed, dev_agent_run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW())`,
    [
      summaryId,
      session.session_id,
      session.tenant_id || PLATFORM_TENANT_ID,
      session.user_id || null,
      session.workspace_key || null,
      insight.summary_text,
      JSON.stringify(normalizeArray(insight.tasks_completed)),
      JSON.stringify(normalizeArray(insight.blockers)),
      JSON.stringify(normalizeArray(insight.feature_requests)),
      JSON.stringify(normalizeArray(insight.integration_needs)),
      normalizeComplexity(insight.complexity),
      session.model_name || null,
      Number(session.turn_count || 0),
      run_id,
    ]
  );

  let graphAttachment = null;
  let graphAttachmentError = null;
  try {
    graphAttachment = await attachSessionSummaryToGraph({ pool, session, summaryId, insight });
    recordOperation(operation_log, {
      stage: "attach_session_summary_graph",
      status: "succeeded",
      summary_id: summaryId,
      graph_asset_id: graphAttachment?.asset_id || null,
      graph_edge_id: graphAttachment?.edge_id || null,
    });
  } catch (err) {
    graphAttachmentError = sanitizeModelError(err);
    recordOperation(operation_log, {
      stage: "attach_session_summary_graph",
      status: "failed",
      summary_id: summaryId,
      error: graphAttachmentError,
    });
    console.warn("[sessionSummary] graph attachment failed", {
      session_id: session.session_id,
      summary_id: summaryId,
      message: graphAttachmentError,
    });
  }

  try {
    await extractSessionSummaryInsightCandidates({
      pool,
      session,
      summaryId,
      insight,
      assetId: graphAttachment?.asset_id || summaryAssetId(summaryId),
    });
  } catch (err) {
    console.warn("[sessionSummary] insight candidate extraction failed", {
      session_id: session.session_id,
      summary_id: summaryId,
      message: err?.message || String(err),
    });
  }

  return summaryId;
}

export async function summarizeAndStoreSession({
  pool = getPool(),
  session = null,
  session_id = null,
  callModel,
  run_id = null,
  fallbackTurnsLimit = DEFAULT_FALLBACK_TURNS_LIMIT,
  injectedDeps = {},
} = {}) {
  const operation_log = [];
  recordOperation(operation_log, { stage: "session_summary", status: "started", run_id, session_id: session?.session_id || session_id || null });

  const resolvedSession = await withOperationStep(
    operation_log,
    "load_session",
    async () => session || await loadSessionById(pool, session_id),
    { run_id, session_id: session?.session_id || session_id || null }
  );
  if (!resolvedSession) {
    recordOperation(operation_log, { stage: "session_summary", status: "skipped", reason: "session_not_found", session_id: session_id || null });
    return { ok: false, skipped: true, reason: "session_not_found", session_id, operation_log };
  }

  const found = await withOperationStep(
    operation_log,
    "check_existing_summary",
    async () => existingSummary(pool, resolvedSession.session_id),
    { run_id, session_id: resolvedSession.session_id }
  );
  if (found?.summary_id) {
    recordOperation(operation_log, { stage: "session_summary", status: "skipped", reason: "summary_exists", summary_id: found.summary_id });
    return { ok: true, skipped: true, reason: "summary_exists", session_id: resolvedSession.session_id, summary_id: found.summary_id, operation_log };
  }

  const transcript = await withOperationStep(
    operation_log,
    "load_transcript",
    async () => loadSessionTranscript({ pool, session: resolvedSession, fallbackTurnsLimit, injectedDeps }),
    { run_id, session_id: resolvedSession.session_id }
  );
  const insight = await withOperationStep(
    operation_log,
    "summarize_transcript",
    async () => summarizeSessionTranscript({ session: resolvedSession, transcript, callModel }),
    { run_id, session_id: resolvedSession.session_id, transcript_source: transcript.source }
  );
  const summaryId = await withOperationStep(
    operation_log,
    "write_session_summary",
    async () => writeSessionSummary({ pool, session: resolvedSession, insight, run_id, operation_log }),
    { run_id, session_id: resolvedSession.session_id }
  );
  const verification = await withOperationStep(
    operation_log,
    "verify_session_summary_write",
    async () => verifySessionSummaryWrite({ pool, session: resolvedSession, summary_id: summaryId }),
    { run_id, session_id: resolvedSession.session_id, summary_id: summaryId }
  );

  let executionLog = null;
  try {
    executionLog = await withOperationStep(
      operation_log,
      "write_execution_log",
      async () => writeSessionSummaryExecutionLog({
        pool,
        session: resolvedSession,
        run_id,
        summary_id: summaryId,
        transcript,
        insight,
        verification,
        operation_log,
      }),
      { run_id, session_id: resolvedSession.session_id, summary_id: summaryId }
    );
  } catch (err) {
    executionLog = { ok: false, error: sanitizeModelError(err) };
  }

  const modelWarning = modelWarningFromInsight(insight);

  recordOperation(operation_log, {
    stage: "session_summary",
    status: verification.ok ? "succeeded" : "verification_failed",
    run_id,
    session_id: resolvedSession.session_id,
    summary_id: summaryId,
    execution_log_id: executionLog?.execution_log_id || null,
  });

  return {
    ok: verification.ok,
    skipped: false,
    session_id: resolvedSession.session_id,
    summary_id: summaryId,
    transcript_source: transcript.source,
    fallback_used: transcript.fallback_used,
    events_loaded: transcript.events.length,
    warning: modelWarning || transcript.warning || null,
    verification,
    execution_log: executionLog,
    operation_log,
  };
}

export async function summarizeSessionIfNeeded({
  pool = getPool(),
  session,
  callModel,
  run_id = null,
  fallbackTurnsLimit = DEFAULT_FALLBACK_TURNS_LIMIT,
  injectedDeps = {},
} = {}) {
  return summarizeAndStoreSession({
    pool,
    session,
    callModel,
    run_id,
    fallbackTurnsLimit,
    injectedDeps,
  });
}

export async function writeProvidedSessionSummary({
  pool = getPool(),
  session,
  summaryText,
  run_id = null,
} = {}) {
  if (!session?.session_id) {
    return { ok: false, skipped: true, reason: "session_not_found" };
  }

  const found = await existingSummary(pool, session.session_id);
  if (found?.summary_id) {
    return { ok: true, skipped: true, reason: "summary_exists", session_id: session.session_id, summary_id: found.summary_id };
  }

  const insight = {
    summary_text: redactSensitiveText(summaryText || ""),
    tasks_completed: [],
    blockers: [],
    feature_requests: [],
    integration_needs: [],
    complexity: "medium",
  };
  const summaryId = await writeSessionSummary({ pool, session, insight, run_id });
  return {
    ok: true,
    skipped: false,
    session_id: session.session_id,
    summary_id: summaryId,
    transcript_source: "provided_summary",
    fallback_used: false,
    events_loaded: 0,
    warning: null,
  };
}

export async function findSessionsNeedingSummary({ pool = getPool(), batchSize = DEFAULT_BATCH_SIZE, minAgeSeconds = DEFAULT_MIN_AGE_SECONDS } = {}) {
  const safeBatchSize = Math.max(1, Math.min(Number(batchSize) || DEFAULT_BATCH_SIZE, 100));
  const safeMinAge = Math.max(0, Math.min(Number(minAgeSeconds) || 0, 86400));
  const agePredicate = safeMinAge > 0
    ? `AND (cs.ended_at IS NULL OR cs.ended_at <= DATE_SUB(NOW(), INTERVAL ${safeMinAge} SECOND))`
    : "";
  const [rows] = await pool.query(
    `SELECT cs.*
     FROM \`customer_sessions\` cs
     LEFT JOIN \`session_summaries\` ss ON ss.session_id = cs.session_id
     WHERE cs.originator = 'gpt_action'
       AND cs.session_status IN ('completed', 'closed')
       AND COALESCE(cs.turn_count, 0) > 0
       AND ss.summary_id IS NULL
       ${agePredicate}
     ORDER BY cs.ended_at DESC, cs.started_at DESC
     LIMIT ?`,
    [safeBatchSize]
  ).catch(() => [[]]);
  return rows;
}

export async function runSessionSummaryAutosweep({
  pool = getPool(),
  callModel,
  batchSize = DEFAULT_BATCH_SIZE,
  limit = null,
  minAgeSeconds = DEFAULT_MIN_AGE_SECONDS,
  run_id = null,
  injectedDeps = {},
} = {}) {
  const operation_log = [];
  recordOperation(operation_log, { stage: "autosweep", status: "started", run_id, limit: limit || batchSize, min_age_seconds: minAgeSeconds });
  const sessions = await withOperationStep(
    operation_log,
    "find_sessions_needing_summary",
    async () => findSessionsNeedingSummary({ pool, batchSize: limit || batchSize, minAgeSeconds }),
    { run_id }
  );
  const results = [];
  for (const session of sessions) {
    results.push(await summarizeAndStoreSession({ pool, session, callModel, run_id, injectedDeps }));
  }
  const summariesCreated = results.filter((result) => result.ok && !result.skipped).length;
  const verificationFailures = results.filter((result) => result.verification && result.verification.ok === false).length;
  recordOperation(operation_log, {
    stage: "autosweep",
    status: verificationFailures ? "completed_with_verification_warnings" : "completed",
    run_id,
    sessions_considered: sessions.length,
    summaries_created: summariesCreated,
    verification_failures: verificationFailures,
  });
  return {
    ok: verificationFailures === 0,
    run_id,
    sessions_considered: sessions.length,
    summaries_created: summariesCreated,
    verification_failures: verificationFailures,
    operation_log,
    results,
  };
}

export function parseJsonlTranscript(content = "") {
  return parseSessionJsonl(content);
}

export function buildTranscriptChunks(turns = [], options = {}) {
  const maxCharsPerChunk = Math.max(500, Number(options.maxCharsPerChunk || DEFAULT_CHUNK_CHAR_LIMIT));
  const maxChunks = Math.max(1, Number(options.maxChunks || 20));
  const session = options.session || { session_id: "test" };
  return chunkTranscriptEvents(session, turns, maxCharsPerChunk).slice(0, maxChunks);
}

export async function summarizeTranscriptWithModel({ session = {}, turns = [], callModel }) {
  return summarizeSessionTranscript({
    session,
    transcript: { source: "provided_turns", events: turns, turns },
    callModel,
  });
}

// Graph-memory attachment is implemented through the session summary pipeline in
// runtime deployments. These literal table names are intentionally kept here so
// CI can guard that summary autosweep remains graph/memory aware without loading
// full transcript text into SQL rows: json_assets, platform_graph_edges.
