import { randomUUID } from "node:crypto";
import {
  GrowthControlPlaneError,
  assertNoSecretFields,
  requireCanonicalKey,
  stableSerialize,
  stableSha256
} from "../../domain/growthControlPlane/growthControlPlane.js";

const SHA_RE = /^[a-f0-9]{64}$/;
const EXTRA_SENSITIVE_KEY = /(^|_)(prompt_body|drive_id|file_path)(_|$)/i;

function fail(code, message, field, issue, status = 422, extra = {}) {
  throw new GrowthControlPlaneError(code, message, status, [{ field, issue, ...extra }]);
}

function requiredText(value, field, maxLength = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maxLength) {
    fail(
      "GROWTH_CONTROL_PLAN_SNAPSHOT_INVALID",
      `${field} is required and must be at most ${maxLength} characters.`,
      field,
      "required_or_too_long"
    );
  }
  return normalized;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    fail(
      "GROWTH_CONTROL_PLAN_SNAPSHOT_INVALID",
      `${field} must be a positive integer.`,
      field,
      "invalid_positive_integer"
    );
  }
  return normalized;
}

function sha256(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA_RE.test(normalized)) {
    fail(
      "GROWTH_CONTROL_PLAN_SNAPSHOT_INVALID",
      `${field} must be a lowercase SHA-256 value.`,
      field,
      "invalid_sha256"
    );
  }
  return normalized;
}

function plainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(
      "GROWTH_CONTROL_PLAN_SNAPSHOT_INVALID",
      `${field} must be an object.`,
      field,
      "invalid_type"
    );
  }
  return JSON.parse(JSON.stringify(value));
}

function assertNoSnapshotSensitiveFields(value, path = "$") {
  assertNoSecretFields(value, path);
  const seen = new WeakSet();
  function visit(current, currentPath) {
    if (!current || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      const nextPath = `${currentPath}.${key}`;
      if (EXTRA_SENSITIVE_KEY.test(key)) {
        fail(
          "GROWTH_CONTROL_PLAN_SNAPSHOT_SENSITIVE",
          "Snapshot input contains a forbidden sensitive or unstable pointer field.",
          nextPath,
          "forbidden_sensitive_field"
        );
      }
      visit(child, nextPath);
    }
  }
  visit(value, path);
}

function ensureNoEffects(value, field) {
  for (const key of [
    "providerCalls",
    "providerDispatchAllowed",
    "providerApplyAllowed",
    "externalWrites",
    "secretsIncluded"
  ]) {
    if (value[key] !== false) {
      fail(
        "GROWTH_CONTROL_PLAN_SNAPSHOT_BOUNDARY_VIOLATION",
        `${field}.${key} must be false.`,
        `${field}.${key}`,
        "must_be_false"
      );
    }
  }
}

function normalizeCompiledPlan(value) {
  const plan = plainObject(value, "compiledPlan");
  assertNoSnapshotSensitiveFields(plan, "compiledPlan");
  if (plan.contractVersion !== "spec-006-workflow-compiled-plan-v1") {
    fail(
      "GROWTH_CONTROL_PLAN_SNAPSHOT_PLAN_INVALID",
      "compiledPlan must use the Spec 006 immutable workflow-plan contract.",
      "compiledPlan.contractVersion",
      "unsupported_contract"
    );
  }
  if (plan.immutable !== true) {
    fail(
      "GROWTH_CONTROL_PLAN_SNAPSHOT_PLAN_INVALID",
      "compiledPlan must be immutable.",
      "compiledPlan.immutable",
      "must_be_true"
    );
  }
  ensureNoEffects(plan, "compiledPlan");
  const claimed = sha256(plan.canonicalHashSha256, "compiledPlan.canonicalHashSha256");
  const { canonicalHashSha256: ignored, ...withoutHash } = plan;
  const actual = stableSha256(withoutHash);
  if (claimed !== actual) {
    fail(
      "GROWTH_CONTROL_PLAN_SNAPSHOT_PLAN_HASH_MISMATCH",
      "compiledPlan canonical hash does not match its content.",
      "compiledPlan.canonicalHashSha256",
      "hash_mismatch",
      409,
      { expected: claimed, actual }
    );
  }
  return Object.freeze(plan);
}

function normalizeCompiledPolicy(value) {
  const policy = plainObject(value, "compiledPolicy");
  assertNoSnapshotSensitiveFields(policy, "compiledPolicy");
  const claimed = policy.canonicalHashSha256 == null
    ? null
    : sha256(policy.canonicalHashSha256, "compiledPolicy.canonicalHashSha256");
  if (policy.immutable != null && policy.immutable !== true) {
    fail(
      "GROWTH_CONTROL_PLAN_SNAPSHOT_POLICY_INVALID",
      "compiledPolicy must be immutable when the field is supplied.",
      "compiledPolicy.immutable",
      "must_be_true"
    );
  }
  for (const key of [
    "providerCalls",
    "providerDispatchAllowed",
    "providerApplyAllowed",
    "externalWrites",
    "secretsIncluded"
  ]) {
    if (Object.hasOwn(policy, key) && policy[key] !== false) {
      fail(
        "GROWTH_CONTROL_PLAN_SNAPSHOT_BOUNDARY_VIOLATION",
        `compiledPolicy.${key} must be false when supplied.`,
        `compiledPolicy.${key}`,
        "must_be_false"
      );
    }
  }
  const { canonicalHashSha256: ignored, ...withoutClaim } = policy;
  const normalized = {
    ...withoutClaim,
    immutable: true,
    providerCalls: false,
    providerDispatchAllowed: false,
    providerApplyAllowed: false,
    externalWrites: false,
    secretsIncluded: false
  };
  const actual = stableSha256(normalized);
  if (claimed != null && claimed !== actual) {
    fail(
      "GROWTH_CONTROL_PLAN_SNAPSHOT_POLICY_HASH_MISMATCH",
      "compiledPolicy canonical hash does not match its content.",
      "compiledPolicy.canonicalHashSha256",
      "hash_mismatch",
      409,
      { expected: claimed, actual }
    );
  }
  return Object.freeze({ ...normalized, canonicalHashSha256: actual });
}

function normalizeVersionReferences(source, field, defaultAuthorityType = null) {
  if (!Array.isArray(source)) {
    fail(
      "GROWTH_CONTROL_PLAN_SNAPSHOT_INVALID",
      `${field} must be an array.`,
      field,
      "invalid_type"
    );
  }
  const normalized = source.map((item, index) => {
    const value = plainObject(item, `${field}[${index}]`);
    assertNoSnapshotSensitiveFields(value, `${field}[${index}]`);
    const authorityType = requireCanonicalKey(
      value.authorityType ?? value.authority_type ?? defaultAuthorityType,
      `${field}[${index}].authorityType`
    );
    const authorityKey = requiredText(
      value.authorityKey ?? value.authority_key,
      `${field}[${index}].authorityKey`,
      255
    );
    const versionRef = requiredText(
      value.versionRef ?? value.version_ref ?? value.version,
      `${field}[${index}].versionRef`,
      191
    );
    const hashSha256 = sha256(
      value.hashSha256 ?? value.hash_sha256,
      `${field}[${index}].hashSha256`
    );
    return { authorityType, authorityKey, versionRef, hashSha256 };
  });
  normalized.sort((a, b) =>
    a.authorityType.localeCompare(b.authorityType) ||
    a.authorityKey.localeCompare(b.authorityKey) ||
    a.versionRef.localeCompare(b.versionRef) ||
    a.hashSha256.localeCompare(b.hashSha256)
  );
  const keys = normalized.map((item) =>
    `${item.authorityType}\u0000${item.authorityKey}\u0000${item.versionRef}`
  );
  if (new Set(keys).size !== keys.length) {
    fail(
      "GROWTH_CONTROL_PLAN_SNAPSHOT_INVALID",
      `${field} contains duplicate authority-version references.`,
      field,
      "duplicate_reference"
    );
  }
  return Object.freeze(normalized.map(Object.freeze));
}

function actorId(value) {
  return String(value || "platform_admin").trim().slice(0, 128) || "platform_admin";
}

function verifyServiceReadback(result, expected) {
  if (!result) {
    fail(
      "GROWTH_CONTROL_PLAN_SNAPSHOT_READBACK_MISMATCH",
      "Snapshot persistence did not return same-cycle readback.",
      "readback",
      "missing",
      409
    );
  }
  for (const field of [
    "configResolutionId",
    "tenantId",
    "workspaceId",
    "brandKey",
    "activityBindingId",
    "workflowKey",
    "workflowVersion",
    "configHashSha256",
    "policyHashSha256",
    "planHashSha256",
    "versionSetHashSha256",
    "bundleHashSha256",
    "idempotencyKey"
  ]) {
    if (String(result[field] ?? "") !== String(expected[field] ?? "")) {
      fail(
        "GROWTH_CONTROL_PLAN_SNAPSHOT_READBACK_MISMATCH",
        "Snapshot persistence readback does not match the requested immutable bundle.",
        field,
        "readback_mismatch",
        409,
        { expected: expected[field], actual: result[field] }
      );
    }
  }
  return result;
}

export function createWorkflowPlanSnapshotService({
  repository,
  uuid = randomUUID
} = {}) {
  if (!repository || typeof repository.persistWorkflowPlanSnapshot !== "function") {
    throw new TypeError("Workflow plan snapshot repository must implement persistWorkflowPlanSnapshot().");
  }

  async function persistWorkflowPlanSnapshot(input = {}, context = {}) {
    assertNoSnapshotSensitiveFields(input, "input");
    const compiledPlan = normalizeCompiledPlan(input.compiledPlan);
    const compiledPolicy = normalizeCompiledPolicy(input.compiledPolicy);
    const workflowKey = requireCanonicalKey(
      input.workflowKey ?? compiledPlan.workflowIdentity?.workflowKey,
      "workflowKey"
    );
    const workflowVersion = positiveInteger(
      input.workflowVersion ?? compiledPlan.workflowIdentity?.workflowVersion,
      "workflowVersion"
    );
    if (
      workflowKey !== compiledPlan.workflowIdentity?.workflowKey ||
      workflowVersion !== Number(compiledPlan.workflowIdentity?.workflowVersion)
    ) {
      fail(
        "GROWTH_CONTROL_PLAN_SNAPSHOT_PLAN_IDENTITY_MISMATCH",
        "Requested workflow identity does not match compiledPlan.",
        "workflowKey",
        "identity_mismatch",
        409
      );
    }

    const tenantId = requiredText(input.tenantId, "tenantId", 36);
    const workspaceId = requiredText(input.workspaceId, "workspaceId", 36);
    const brandKey = requiredText(input.brandKey, "brandKey", 255);
    const activityBindingId = requiredText(input.activityBindingId, "activityBindingId", 36);
    const activityPackVersionId = input.activityPackVersionId == null
      ? null
      : requiredText(input.activityPackVersionId, "activityPackVersionId", 36);
    const configResolutionId = requiredText(input.configResolutionId, "configResolutionId", 36);
    const configHashSha256 = sha256(input.configHashSha256, "configHashSha256");
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 184);

    const policyVersions = normalizeVersionReferences(
      input.policyVersionReferences ?? [],
      "policyVersionReferences",
      "policy"
    );
    const resolvedVersions = normalizeVersionReferences(
      input.resolvedVersionReferences ?? [],
      "resolvedVersionReferences"
    );
    const planHashSha256 = compiledPlan.canonicalHashSha256;
    const policyHashSha256 = compiledPolicy.canonicalHashSha256;
    const versionSetHashSha256 = stableSha256({
      config: { resolutionId: configResolutionId, hashSha256: configHashSha256 },
      activityPack: {
        activityPackVersionId,
        activityPackKey: compiledPlan.workflowIdentity?.activityPackKey ?? null,
        activityPackVersion: compiledPlan.workflowIdentity?.activityPackVersion ?? null,
        manifestChecksumSha256: compiledPlan.workflowIdentity?.manifestChecksumSha256 ?? null
      },
      workflow: { workflowKey, workflowVersion },
      policyVersions,
      resolvedVersions
    });
    const bundleHashSha256 = stableSha256({
      tenantId,
      workspaceId,
      brandKey,
      activityBindingId,
      workflowKey,
      workflowVersion,
      configHashSha256,
      policyHashSha256,
      planHashSha256,
      versionSetHashSha256
    });

    const persistence = {
      planSnapshotId: uuid(),
      policySnapshotId: uuid(),
      configResolutionId,
      tenantId,
      workspaceId,
      brandKey,
      activityBindingId,
      activityPackVersionId,
      workflowKey,
      workflowVersion,
      policyVersionsJson: stableSerialize(policyVersions),
      policySnapshotJson: stableSerialize(compiledPolicy),
      resolvedVersionsJson: stableSerialize(resolvedVersions),
      planSnapshotJson: stableSerialize(compiledPlan),
      configHashSha256,
      policyHashSha256,
      planHashSha256,
      versionSetHashSha256,
      bundleHashSha256,
      idempotencyKey,
      createdBy: actorId(context.actorId)
    };
    const readback = await repository.persistWorkflowPlanSnapshot(persistence);
    const verified = verifyServiceReadback(readback, persistence);
    return Object.freeze({
      ...verified,
      immutable: true,
      providerCalls: false,
      providerDispatchAllowed: false,
      providerApplyAllowed: false,
      externalWrites: false,
      secretsIncluded: false
    });
  }

  return Object.freeze({ persistWorkflowPlanSnapshot });
}

export const _testingWorkflowPlanSnapshotService = Object.freeze({
  requiredText,
  positiveInteger,
  sha256,
  assertNoSnapshotSensitiveFields,
  normalizeCompiledPlan,
  normalizeCompiledPolicy,
  normalizeVersionReferences,
  verifyServiceReadback
});
