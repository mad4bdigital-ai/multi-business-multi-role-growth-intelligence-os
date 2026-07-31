import { randomUUID } from "node:crypto";
import {
  GROWTH_CONTROL_MERGE_OPERATORS,
  GROWTH_CONTROL_SCOPE_TYPES,
  GrowthControlPlaneError,
  assertNoSecretFields,
  buildGrowthControlScopeHierarchy,
  normalizeBrandActivityBinding,
  normalizeGrowthControlScope,
  requireCanonicalKey,
  resolveEffectiveConfiguration,
  stableSha256,
  validateActivityPackManifest,
  validateSchemaDefinition,
  validateValueAgainstSchema
} from "../../domain/growthControlPlane/growthControlPlane.js";

function ensureObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_VALIDATION_ERROR", `${field} must be an object.`, 422, [{ field, issue: "must_be_object" }]);
  }
  return value;
}

function actorId(value) {
  return String(value || "platform_admin").trim().slice(0, 128) || "platform_admin";
}

function idempotencyKey(value) {
  const key = String(value || "").trim();
  if (key.length < 8 || key.length > 191) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_IDEMPOTENCY_KEY_INVALID", "Idempotency key must contain 8 to 191 characters.", 400);
  }
  return key;
}

function encodeCursor(offset) {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (value == null || value === "") return 0;
  const cursor = String(value).trim();
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!/^\d+$/.test(decoded) || Buffer.from(decoded, "utf8").toString("base64url") !== cursor) throw new Error("invalid");
    const offset = Number(decoded);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid");
    return offset;
  } catch {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_CURSOR_INVALID", "cursor is invalid.", 400, [{ field: "cursor", issue: "invalid" }]);
  }
}

function normalizeListPage(input = {}) {
  const limit = input.limit == null || input.limit === "" ? 25 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_LIMIT_INVALID", "limit must be an integer from 1 to 100.", 400, [{ field: "limit", issue: "out_of_range" }]);
  }
  return Object.freeze({ limit, offset: decodeCursor(input.cursor) });
}

function requiredText(value, field, maxLength = 191) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_VALIDATION_ERROR",
      `${field} is required and must be at most ${maxLength} characters.`,
      400,
      [{ field, issue: "required_or_too_long" }]
    );
  }
  return normalized;
}

function nonNegativeRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_REVISION_INVALID",
      "expectedRevision must be a non-negative integer.",
      422,
      [{ field: "expectedRevision", issue: "invalid" }]
    );
  }
  return revision;
}

export function createGrowthControlPlaneService({
  repository,
  shadowParityObserver = null,
  uuid = randomUUID
}) {
  if (!repository) throw new TypeError("Growth Control Plane repository is required.");

  async function listConfigurationDefinitions(input = {}) {
    const pageInput = normalizeListPage(input);
    const rows = await repository.listConfigurationDefinitions({ limit: pageInput.limit + 1, offset: pageInput.offset });
    const hasMore = rows.length > pageInput.limit;
    const items = hasMore ? rows.slice(0, pageInput.limit) : rows;
    return Object.freeze({
      items,
      page: {
        nextCursor: hasMore ? encodeCursor(pageInput.offset + pageInput.limit) : null,
        hasMore
      },
      secretsIncluded: false
    });
  }

  async function createConfigurationDefinition(input, context = {}) {
    const configKey = requireCanonicalKey(input.configKey, "configKey");
    const schema = ensureObject(input.schema, "schema");
    const defaultValues = input.defaultValues == null ? {} : ensureObject(input.defaultValues, "defaultValues");
    const mergeProfile = input.mergeProfile == null ? {} : ensureObject(input.mergeProfile, "mergeProfile");
    const allowedScopes = Array.isArray(input.allowedScopes) ? [...new Set(input.allowedScopes.map(String))].sort() : [];
    const invalidScopes = allowedScopes.filter((scope) => !GROWTH_CONTROL_SCOPE_TYPES.includes(scope));
    const invalidOperators = Object.entries(mergeProfile).filter(([, operator]) => !GROWTH_CONTROL_MERGE_OPERATORS.includes(operator));
    if (!allowedScopes.length || invalidScopes.length || invalidOperators.length) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_DEFINITION_INVALID",
        "Configuration definition scopes or merge operators are invalid.",
        422,
        [
          ...invalidScopes.map((value) => ({ field: "allowedScopes", issue: "unsupported", value })),
          ...invalidOperators.map(([field, value]) => ({ field: `mergeProfile.${field}`, issue: "unsupported", value }))
        ]
      );
    }
    validateSchemaDefinition(schema);
    assertNoSecretFields({ schema, defaultValues, mergeProfile });
    const issues = validateValueAgainstSchema(defaultValues, schema);
    if (issues.length) throw new GrowthControlPlaneError("GROWTH_CONTROL_DEFAULTS_SCHEMA_INVALID", "Default values do not match the schema.", 422, issues);
    const schemaVersion = Number(input.schemaVersion || 1);
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new GrowthControlPlaneError("GROWTH_CONTROL_SCHEMA_VERSION_INVALID", "schemaVersion must be positive.", 422);
    const securityClassification = String(input.securityClassification || "tenant_internal");
    if (!new Set(["public_metadata","tenant_internal","restricted","security_control"]).has(securityClassification)) {
      throw new GrowthControlPlaneError("GROWTH_CONTROL_SECURITY_CLASSIFICATION_INVALID", "Unsupported security classification.", 422);
    }
    const record = {
      configKey, schemaVersion, schema, defaultValues, allowedScopes, mergeProfile,
      securityClassification, createdBy: actorId(context.actorId)
    };
    record.checksumSha256 = stableSha256(record);
    return repository.createConfigurationDefinition(record);
  }

  async function createConfigurationVersion(configKeyValue, input, context = {}) {
    const configKey = requireCanonicalKey(configKeyValue, "configKey");
    const definition = await repository.getConfigurationDefinition(configKey);
    if (!definition) throw new GrowthControlPlaneError("GROWTH_CONTROL_CONFIG_NOT_FOUND", "Configuration definition was not found.", 404);
    const scope = normalizeGrowthControlScope(input.scope);
    if (!definition.allowedScopes.includes(scope.scopeType)) {
      throw new GrowthControlPlaneError("GROWTH_CONTROL_SCOPE_NOT_ALLOWED", "Configuration does not allow this scope.", 422);
    }
    const values = ensureObject(input.values, "values");
    assertNoSecretFields(values);
    const issues = validateValueAgainstSchema(values, definition.schema);
    if (issues.length) throw new GrowthControlPlaneError("GROWTH_CONTROL_VALUES_SCHEMA_INVALID", "Configuration values do not match the schema.", 422, issues);
    const record = {
      configVersionId: uuid(), configKey, scope, values,
      expectedRevision: Number(input.expectedRevision || 0),
      idempotencyKey: idempotencyKey(context.idempotencyKey),
      createdBy: actorId(context.actorId)
    };
    if (!Number.isInteger(record.expectedRevision) || record.expectedRevision < 0) throw new GrowthControlPlaneError("GROWTH_CONTROL_REVISION_INVALID", "expectedRevision must be non-negative.", 422);
    record.checksumSha256 = stableSha256({ configKey, scope, values });
    return repository.createConfigurationVersion(record);
  }

  async function resolveConfiguration(configKeyValue, input, context = {}) {
    const configKey = requireCanonicalKey(configKeyValue, "configKey");
    const definition = await repository.getConfigurationDefinition(configKey);
    if (!definition) throw new GrowthControlPlaneError("GROWTH_CONTROL_CONFIG_NOT_FOUND", "Configuration definition was not found.", 404);
    const resolutionContext = ensureObject(input.context, "context");
    assertNoSecretFields(resolutionContext);
    const scopeHierarchy = buildGrowthControlScopeHierarchy(resolutionContext);
    const includeDraftVersionIds = Array.isArray(input.includeDraftVersionIds) ? input.includeDraftVersionIds.map(String).slice(0, 100) : [];
    const versions = await repository.listResolvableConfigurationVersions({
      configKey,
      scopeKeys: scopeHierarchy.map((scope) => scope.scopeKey),
      includeDraftVersionIds
    });
    const result = resolveEffectiveConfiguration({ definition, versions, scopeHierarchy });
    const snapshot = await repository.recordResolutionSnapshot({
      resolutionId: uuid(), configKey, context: resolutionContext, result, createdBy: actorId(context.actorId)
    });
    if (shadowParityObserver && typeof shadowParityObserver.observeSafely === "function") {
      await shadowParityObserver.observeSafely({
        configKey,
        resolutionId: snapshot.resolutionId,
        context: resolutionContext,
        growthValue: result
      });
    }
    return Object.freeze({ ...snapshot, scopeHierarchy, providerCalls: false, externalWrites: false, secretsIncluded: false });
  }

  async function listActivityPacks(input = {}) {
    const pageInput = normalizeListPage(input);
    const rows = await repository.listActivityPacks({ limit: pageInput.limit + 1, offset: pageInput.offset });
    const hasMore = rows.length > pageInput.limit;
    const items = hasMore ? rows.slice(0, pageInput.limit) : rows;
    return Object.freeze({
      items,
      page: {
        nextCursor: hasMore ? encodeCursor(pageInput.offset + pageInput.limit) : null,
        hasMore
      },
      secretsIncluded: false
    });
  }

  async function createActivityPackDefinition(input, context = {}) {
    const activityPackKey = requireCanonicalKey(input.activityPackKey, "activityPackKey");
    const activityTypeKey = requireCanonicalKey(input.activityTypeKey, "activityTypeKey");
    const displayName = String(input.displayName || "").trim();
    if (!displayName || displayName.length > 255) throw new GrowthControlPlaneError("GROWTH_CONTROL_DISPLAY_NAME_INVALID", "displayName is required and must be at most 255 characters.", 422);
    assertNoSecretFields(input);
    return repository.createActivityPackDefinition({
      activityPackKey, activityTypeKey, displayName,
      description: input.description ? String(input.description).slice(0, 5000) : null,
      createdBy: actorId(context.actorId)
    });
  }

  async function createActivityPackVersion(activityPackKeyValue, input, context = {}) {
    const activityPackKey = requireCanonicalKey(activityPackKeyValue, "activityPackKey");
    const validated = validateActivityPackManifest(ensureObject(input.manifest, "manifest"));
    return repository.createActivityPackVersion({
      activityPackVersionId: uuid(), activityPackKey,
      manifest: validated.manifest, checksumSha256: validated.checksumSha256,
      idempotencyKey: idempotencyKey(context.idempotencyKey), createdBy: actorId(context.actorId)
    });
  }

  async function createBrandActivityBinding(input, context = {}) {
    const binding = normalizeBrandActivityBinding(input);
    return repository.createBrandActivityBinding({
      activityBindingId: uuid(), binding,
      idempotencyKey: idempotencyKey(context.idempotencyKey), createdBy: actorId(context.actorId)
    });
  }

  async function validateConfigurationVersion(configKeyValue, configVersionIdValue, input = {}, context = {}) {
    const configKey = requireCanonicalKey(configKeyValue, "configKey");
    const configVersionId = requiredText(configVersionIdValue, "configVersionId", 36);
    const definition = await repository.getConfigurationDefinition(configKey);
    const version = await repository.getConfigurationVersion(configVersionId);
    if (!definition || !version || version.configKey !== configKey) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_CONFIG_VERSION_NOT_FOUND",
        "Configuration version was not found.",
        404
      );
    }
    assertNoSecretFields(version.values);
    const issues = validateValueAgainstSchema(version.values, definition.schema);
    if (issues.length) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_VALUES_SCHEMA_INVALID",
        "Configuration values do not match the active definition schema.",
        422,
        issues
      );
    }
    return repository.validateConfigurationVersion({
      configKey,
      configVersionId,
      expectedRevision: nonNegativeRevision(input.expectedRevision),
      validatedBy: actorId(context.actorId)
    });
  }

  async function createConfigurationLifecycleApprovalHold(configKeyValue, configVersionIdValue, input = {}, context = {}) {
    const configKey = requireCanonicalKey(configKeyValue, "configKey");
    const configVersionId = requiredText(configVersionIdValue, "configVersionId", 36);
    const operation = String(input.operation || "").trim();
    if (!new Set(["activate", "rollback"]).has(operation)) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_APPROVAL_OPERATION_INVALID",
        "operation must be activate or rollback.",
        422,
        [{ field: "operation", issue: "unsupported" }]
      );
    }
    const expiresInMinutes = input.expiresInMinutes == null ? 30 : Number(input.expiresInMinutes);
    if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 5 || expiresInMinutes > 1440) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_APPROVAL_EXPIRY_INVALID",
        "expiresInMinutes must be an integer from 5 to 1440.",
        422,
        [{ field: "expiresInMinutes", issue: "out_of_range" }]
      );
    }
    return repository.createConfigurationLifecycleApprovalHold({
      holdId: uuid(),
      runId: uuid(),
      configKey,
      configVersionId,
      operation,
      requestedBy: actorId(context.actorId),
      requestId: context.requestId || null,
      correlationId: context.correlationId || null,
      expiresAt: new Date(Date.now() + expiresInMinutes * 60_000)
    });
  }

  async function applyConfigurationLifecycle(operation, configKeyValue, configVersionIdValue, input = {}, context = {}) {
    const configKey = requireCanonicalKey(configKeyValue, "configKey");
    const configVersionId = requiredText(configVersionIdValue, "configVersionId", 36);
    const approvalHoldId = requiredText(input.approvalHoldId, "approvalHoldId", 36);
    return repository.applyConfigurationLifecycle({
      operation,
      configKey,
      configVersionId,
      approvalHoldId,
      expectedRevision: nonNegativeRevision(input.expectedRevision),
      approvedBy: actorId(context.actorId),
      eventId: uuid(),
      requestId: context.requestId || null,
      correlationId: context.correlationId || null,
      sourceEnvironment: context.sourceEnvironment || "development"
    });
  }

  async function activateConfigurationVersion(configKeyValue, configVersionIdValue, input = {}, context = {}) {
    return applyConfigurationLifecycle("activate", configKeyValue, configVersionIdValue, input, context);
  }

  async function rollbackConfigurationVersion(configKeyValue, configVersionIdValue, input = {}, context = {}) {
    return applyConfigurationLifecycle("rollback", configKeyValue, configVersionIdValue, input, context);
  }

  return Object.freeze({
    listConfigurationDefinitions, createConfigurationDefinition, createConfigurationVersion,
    validateConfigurationVersion, createConfigurationLifecycleApprovalHold,
    activateConfigurationVersion, rollbackConfigurationVersion,
    resolveConfiguration, listActivityPacks, createActivityPackDefinition,
    createActivityPackVersion, createBrandActivityBinding
  });
}

export const _testingGrowthControlPlaneService = Object.freeze({
  ensureObject,
  actorId,
  idempotencyKey,
  encodeCursor,
  decodeCursor,
  normalizeListPage
});
