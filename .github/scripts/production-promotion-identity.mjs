import crypto from "node:crypto";

const SHA_RE = /^[0-9a-f]{40}$/u;
const SAFE_PREFIX_RE = /^[a-z0-9]+(?:[/-][a-z0-9.-]+)*$/u;
const RUN_RE = /^[1-9][0-9]*$/u;
const SESSION_PREFIX_RE = /^[0-9a-f]{16}$/u;
const DOMAIN = "mad4b.production-promotion.identity.v2\0";

const DETERMINISTIC_RELEASE_REF = /^release\/production-candidate-([0-9a-f]{12})-([0-9a-f]{12})$/u;
const CANONICAL_V2_RELEASE_REF = /^release\/production-candidate-v2-([0-9a-f]{12})-([0-9a-f]{12})-([0-9a-f]{16})$/u;
const CERTIFIED_RUN_RELEASE_REF = /^release\/production-candidate-([0-9a-f]{12})-([0-9a-f]{12})-([1-9]\d*)-([1-9]\d*)$/u;
const LEGACY_BRIDGE_RELEASE_REF = /^release\/production-candidate-([0-9a-f]{12})-([0-9a-f]{12})-(bridge|push)-([1-9]\d*)$/u;

export function requireSha(name, value) {
  const normalized = String(value ?? "");
  if (!SHA_RE.test(normalized)) throw new Error(`${name} must be an exact lowercase SHA`);
  return normalized;
}

function requireSafePrefix(name, value) {
  const normalized = String(value ?? "");
  if (!SAFE_PREFIX_RE.test(normalized)) throw new Error(`${name} contains unsafe branch characters`);
  return normalized;
}

function normalizeRepository(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "repository-unbound";
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/u.test(normalized)) {
    throw new Error("repository must use owner/name form when supplied");
  }
  return normalized;
}

export function buildPromotionSessionId({ repository = "", releaseCutSha, productionSha }) {
  const cut = requireSha("releaseCutSha", releaseCutSha);
  const production = requireSha("productionSha", productionSha);
  const repo = normalizeRepository(repository);
  return crypto
    .createHash("sha256")
    .update(`${DOMAIN}${repo}\0${cut}\0${production}`)
    .digest("hex");
}

export function buildOperationId({ releaseCutSha, productionSha }) {
  const cut = requireSha("releaseCutSha", releaseCutSha);
  const production = requireSha("productionSha", productionSha);
  return `promo-${cut.slice(0, 12)}-${production.slice(0, 12)}`;
}

export function buildPromotionSurfaceNames({
  releaseBranchPrefix,
  validationBranchPrefix,
  validationBaseBranchPrefix,
  releaseCutSha,
  productionSha,
  repository = "",
}) {
  const cut = requireSha("releaseCutSha", releaseCutSha);
  const production = requireSha("productionSha", productionSha);
  const operationId = buildOperationId({ releaseCutSha: cut, productionSha: production });
  const sessionId = buildPromotionSessionId({ repository, releaseCutSha: cut, productionSha: production });
  return Object.freeze({
    operationId,
    promotionSessionId: sessionId,
    identityVersion: "governed_production_promotion_identity.v2",
    surfaceFormat: "deterministic_release_cut_v1",
    releaseBranch: `${requireSafePrefix("releaseBranchPrefix", releaseBranchPrefix)}-${cut.slice(0, 12)}-${production.slice(0, 12)}`,
    validationBranch: `${requireSafePrefix("validationBranchPrefix", validationBranchPrefix)}-${cut.slice(0, 12)}-${production.slice(0, 12)}`,
    validationBaseBranch: `${requireSafePrefix("validationBaseBranchPrefix", validationBaseBranchPrefix)}-${cut.slice(0, 12)}-${production.slice(0, 12)}`,
  });
}

export function buildCanonicalV2ReleaseBranch({ releaseCutSha, productionSha, repository = "" }) {
  const cut = requireSha("releaseCutSha", releaseCutSha);
  const production = requireSha("productionSha", productionSha);
  const sessionId = buildPromotionSessionId({ repository, releaseCutSha: cut, productionSha: production });
  return `release/production-candidate-v2-${cut.slice(0, 12)}-${production.slice(0, 12)}-${sessionId.slice(0, 16)}`;
}

export function parseProductionCandidateSurfaceRef(headRef) {
  const value = String(headRef ?? "");

  let match = CANONICAL_V2_RELEASE_REF.exec(value);
  if (match) {
    return Object.freeze({
      kind: "canonical_v2",
      release_cut_prefix: match[1],
      production_prefix: match[2],
      session_prefix: match[3],
      launcher_run_id: null,
      launcher_run_attempt: null,
      legacy_transport: null,
    });
  }

  match = DETERMINISTIC_RELEASE_REF.exec(value);
  if (match) {
    return Object.freeze({
      kind: "deterministic_release_cut_v1",
      release_cut_prefix: match[1],
      production_prefix: match[2],
      session_prefix: null,
      launcher_run_id: null,
      launcher_run_attempt: null,
      legacy_transport: null,
    });
  }

  match = CERTIFIED_RUN_RELEASE_REF.exec(value);
  if (match) {
    return Object.freeze({
      kind: "certified_run_v1",
      release_cut_prefix: match[1],
      production_prefix: match[2],
      session_prefix: null,
      launcher_run_id: match[3],
      launcher_run_attempt: match[4],
      legacy_transport: null,
    });
  }

  match = LEGACY_BRIDGE_RELEASE_REF.exec(value);
  if (match) {
    return Object.freeze({
      kind: "legacy_bridge_v1",
      release_cut_prefix: match[1],
      production_prefix: match[2],
      session_prefix: null,
      launcher_run_id: match[4],
      launcher_run_attempt: null,
      legacy_transport: match[3],
    });
  }

  return null;
}

export function validateProductionCandidateSurfaceHint({
  headRef,
  releaseCutSha,
  productionSha,
  repository = "",
}) {
  const cut = requireSha("releaseCutSha", releaseCutSha);
  const production = requireSha("productionSha", productionSha);
  const parsed = parseProductionCandidateSurfaceRef(headRef);
  if (!parsed) return Object.freeze({ ok: false, reason: "unsupported_candidate_surface" });
  if (!cut.startsWith(parsed.release_cut_prefix)) {
    return Object.freeze({ ok: false, reason: "release_cut_prefix_mismatch", surface: parsed });
  }
  if (!production.startsWith(parsed.production_prefix)) {
    return Object.freeze({ ok: false, reason: "production_prefix_mismatch", surface: parsed });
  }

  if (parsed.kind === "canonical_v2") {
    if (!SESSION_PREFIX_RE.test(parsed.session_prefix || "")) {
      return Object.freeze({ ok: false, reason: "candidate_session_prefix_invalid", surface: parsed });
    }
    const sessionId = buildPromotionSessionId({ repository, releaseCutSha: cut, productionSha: production });
    if (!sessionId.startsWith(parsed.session_prefix)) {
      return Object.freeze({ ok: false, reason: "candidate_session_mismatch", surface: parsed });
    }
  }

  if (parsed.launcher_run_id != null && !RUN_RE.test(parsed.launcher_run_id)) {
    return Object.freeze({ ok: false, reason: "launcher_run_id_invalid", surface: parsed });
  }
  if (parsed.launcher_run_attempt != null && !RUN_RE.test(parsed.launcher_run_attempt)) {
    return Object.freeze({ ok: false, reason: "launcher_run_attempt_invalid", surface: parsed });
  }

  return Object.freeze({ ok: true, surface: parsed });
}
