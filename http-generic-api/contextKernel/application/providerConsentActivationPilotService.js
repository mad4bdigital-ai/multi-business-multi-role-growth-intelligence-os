import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  ContextApplicationError,
  freezeApplicationValue,
  requireApplicationFunction,
  requireApplicationObject,
  requireApplicationString,
} from "./applicationSupport.js";
import { assertProviderAuthorizationStateRepository } from "./repositoryPorts.js";

const RETRYABLE_CODES = new Set([
  "provider_timeout",
  "provider_rate_limited",
  "provider_transient_error",
  "handoff_lease_lost",
  "provider_consent_persistence_temporarily_unavailable",
]);

const SAFE_METADATA_KEYS = new Set([
  "account_id",
  "avatar_url",
  "display_name",
  "domain",
  "email",
  "organization_id",
]);

const FORBIDDEN_SECRET_KEYS = /(^|_)(access|refresh|id)?_?token$|secret|credential|authorization|password|api_?key/i;

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function pilotError(code, message, status = 409, details = {}) {
  return new ContextApplicationError(code, message, status, {
    ...details,
    secrets_included: false,
  });
}

function optionalString(value, fieldName) {
  if (value == null || value === "") return null;
  return requireApplicationString(value, fieldName);
}

function normalizeRevision(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer.`);
  }
  return parsed;
}

function normalizeStringList(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array.`);
  return [...new Set(value.map((entry) => requireApplicationString(entry, `${fieldName}[]`)))].sort();
}

function assertMethod(service, serviceName, methodName) {
  if (!service || typeof service !== "object" || typeof service[methodName] !== "function") {
    throw new TypeError(`${serviceName} with ${methodName} is required.`);
  }
  return service;
}

function validateClaimedState(state, claimed) {
  const row = requireApplicationObject(state, "authorizationState");
  if (
    row.status !== "claimed"
    || row.stateRef !== claimed.stateRef
    || row.stateRevision !== claimed.stateRevision
    || row.claimRevision !== claimed.claimRevision
    || row.claimVerifierPersisted !== true
  ) {
    throw pilotError(
      "provider_consent_claim_readback_mismatch",
      "Claimed provider authorization state failed exact readback.",
      409,
      { state_ref: claimed.stateRef },
    );
  }
  const expiresAt = new Date(row.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    throw pilotError(
      "provider_consent_state_expiry_invalid",
      "Claimed provider authorization state expiry is invalid.",
      500,
    );
  }
  return Object.freeze({
    stateRef: requireApplicationString(row.stateRef, "state.stateRef"),
    flowType: requireApplicationString(row.flowType, "state.flowType"),
    providerKey: requireApplicationString(row.providerKey, "state.providerKey"),
    principalRef: requireApplicationString(row.principalRef, "state.principalRef"),
    userRef: optionalString(row.userRef, "state.userRef"),
    tenantRef: requireApplicationString(row.tenantRef, "state.tenantRef"),
    workspaceRef: requireApplicationString(row.workspaceRef, "state.workspaceRef"),
    brandRef: optionalString(row.brandRef, "state.brandRef"),
    ownerScopeType: requireApplicationString(row.ownerScopeType, "state.ownerScopeType"),
    ownerScopeRef: requireApplicationString(row.ownerScopeRef, "state.ownerScopeRef"),
    targetConnectionRef: optionalString(row.targetConnectionRef, "state.targetConnectionRef"),
    expectedConnectionRevision: row.expectedConnectionRevision == null
      ? null
      : normalizeRevision(row.expectedConnectionRevision, "state.expectedConnectionRevision"),
    expectedProviderAccountRef: optionalString(
      row.expectedProviderAccountRef,
      "state.expectedProviderAccountRef",
    ),
    expectedProviderAccountBindingHash: optionalString(
      row.expectedProviderAccountBindingHash,
      "state.expectedProviderAccountBindingHash",
    ),
    requestedProviderScopes: normalizeStringList(
      row.requestedProviderScopes,
      "state.requestedProviderScopes",
    ),
    redirectTargetRef: requireApplicationString(row.redirectTargetRef, "state.redirectTargetRef"),
    stateRevision: normalizeRevision(row.stateRevision, "state.stateRevision"),
    claimRevision: normalizeRevision(row.claimRevision, "state.claimRevision"),
    expiresAt,
    status: "claimed",
  });
}

function assertNoSecretKeys(value, path = "value") {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretKeys(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEYS.test(key)) {
      throw pilotError(
        "provider_consent_secret_metadata_rejected",
        "Provider metadata contained a forbidden secret-bearing key.",
        409,
        { metadata_path: `${path}.${key}` },
      );
    }
    assertNoSecretKeys(entry, `${path}.${key}`);
  }
}

function sanitizeAccountMetadata(value) {
  if (value == null) return Object.freeze({});
  const source = requireApplicationObject(value, "accountMetadata");
  assertNoSecretKeys(source, "accountMetadata");
  const sanitized = {};
  for (const key of SAFE_METADATA_KEYS) {
    if (!Object.hasOwn(source, key)) continue;
    const raw = source[key];
    if (raw == null) continue;
    if (!["string", "number", "boolean"].includes(typeof raw)) {
      throw new TypeError(`accountMetadata.${key} must be a scalar value.`);
    }
    const normalized = typeof raw === "string" ? raw.trim() : raw;
    if (typeof normalized === "string" && normalized.length > 512) {
      throw new TypeError(`accountMetadata.${key} is too long.`);
    }
    sanitized[key] = normalized;
  }
  return Object.freeze(sanitized);
}

function assertExchangeCertification(resolved, providerKey) {
  const adapter = resolved?.adapter || resolved;
  assertMethod(adapter, "providerExchange", "exchangeAuthorizationCode");
  const certification = resolved?.certification || adapter.certification;
  if (!certification || certification.status !== "certified") {
    throw pilotError(
      "provider_exchange_not_certified",
      "Provider exchange adapter is not certified for the activation pilot.",
      503,
      { provider_key: providerKey },
    );
  }
  if (certification.providerKey !== providerKey) {
    throw pilotError(
      "provider_exchange_certification_mismatch",
      "Provider exchange certification does not match the claimed provider.",
      409,
      { provider_key: providerKey },
    );
  }
  if (certification.supportsIdempotency !== true) {
    throw pilotError(
      "provider_exchange_idempotency_not_certified",
      "Provider exchange adapter lacks certified idempotency semantics.",
      503,
      { provider_key: providerKey },
    );
  }
  const timeoutMs = Number(certification.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    throw pilotError(
      "provider_exchange_timeout_not_certified",
      "Provider exchange timeout certification is invalid.",
      503,
      { provider_key: providerKey },
    );
  }
  return Object.freeze({ adapter, certification: { ...certification, timeoutMs } });
}

function assertCredentialCertification(service) {
  const certification = service?.certification;
  if (
    !certification
    || certification.status !== "certified"
    || certification.algorithm !== "aes-256-gcm"
    || certification.secretsExcludedFromProjection !== true
    || !certification.metadataPolicyVersion
  ) {
    throw pilotError(
      "credential_envelope_not_certified",
      "Credential envelope adapter is not certified for the activation pilot.",
      503,
    );
  }
  return certification;
}

function normalizeCredentialEnvelope(value, state) {
  const envelope = requireApplicationObject(value, "credentialEnvelope");
  assertNoSecretKeys(envelope.accountMetadata || {}, "credentialEnvelope.accountMetadata");
  if (envelope.providerKey !== state.providerKey) {
    throw pilotError(
      "provider_consent_provider_result_mismatch",
      "Credential envelope does not match the claimed provider.",
      409,
    );
  }
  const encryptedCredentials = requireApplicationString(
    envelope.encryptedCredentials,
    "credentialEnvelope.encryptedCredentials",
  );
  if (encryptedCredentials.length > 262144) {
    throw new TypeError("credentialEnvelope.encryptedCredentials is too large.");
  }
  const providerAccountRef = optionalString(
    envelope.providerAccountRef,
    "credentialEnvelope.providerAccountRef",
  );
  const providerAccountBindingHash = optionalString(
    envelope.providerAccountBindingHash,
    "credentialEnvelope.providerAccountBindingHash",
  );
  if (!providerAccountRef && !providerAccountBindingHash) {
    throw pilotError(
      "provider_consent_provider_account_binding_missing",
      "Credential envelope lacks a durable provider-account binding.",
      409,
    );
  }
  const grantedScopes = normalizeStringList(
    envelope.grantedScopes,
    "credentialEnvelope.grantedScopes",
  );
  const missingScopes = state.requestedProviderScopes.filter(
    (scope) => !grantedScopes.includes(scope),
  );
  if (missingScopes.length) {
    throw pilotError(
      "provider_consent_granted_scope_mismatch",
      "Provider did not grant every scope bound into the signed authorization state.",
      409,
      { missing_scope_count: missingScopes.length },
    );
  }
  if (
    state.flowType === "reconnect"
    && state.expectedProviderAccountRef
    && providerAccountRef !== state.expectedProviderAccountRef
  ) {
    throw pilotError(
      "provider_consent_provider_account_mismatch",
      "Reconnect returned a different provider account.",
      409,
    );
  }
  if (
    state.flowType === "reconnect"
    && !state.expectedProviderAccountRef
    && state.expectedProviderAccountBindingHash
    && providerAccountBindingHash !== state.expectedProviderAccountBindingHash
  ) {
    throw pilotError(
      "provider_consent_provider_account_mismatch",
      "Reconnect returned a different provider-account binding.",
      409,
    );
  }
  return Object.freeze({
    providerKey: state.providerKey,
    encryptedCredentials,
    providerAccountRef,
    providerAccountBindingHash,
    providerAccountBindingVersion: optionalString(
      envelope.providerAccountBindingVersion,
      "credentialEnvelope.providerAccountBindingVersion",
    ),
    displayLabel: optionalString(envelope.displayLabel, "credentialEnvelope.displayLabel"),
    accountLabel: optionalString(envelope.accountLabel, "credentialEnvelope.accountLabel"),
    accountMetadata: sanitizeAccountMetadata(envelope.accountMetadata),
    grantedScopes,
    tokenExpiresAt: envelope.tokenExpiresAt || null,
  });
}

function safeCompletionResult(state, completion, providerCallMade) {
  return freezeApplicationValue({
    stateRef: state.stateRef,
    flowType: state.flowType,
    status: completion?.status || "consumed",
    tenantRef: state.tenantRef,
    workspaceRef: state.workspaceRef,
    brandRef: state.brandRef,
    ownerScopeType: state.ownerScopeType,
    ownerScopeRef: state.ownerScopeRef,
    providerKey: state.providerKey,
    connectionRef: completion?.connectionRef || state.targetConnectionRef || null,
    stateRevision: completion?.stateRevision ?? state.stateRevision + 1,
    claimRevision: completion?.claimRevision ?? state.claimRevision,
    connectionRevision: completion?.connectionRevision ?? null,
    authorizationRevision: completion?.authorizationRevision ?? null,
    providerCallMade,
    providerCallCheckpointed: true,
    credentialPayloadRead: false,
    credentialMutationPerformed: true,
    secretsIncluded: false,
  });
}

function isRetryableError(error) {
  return error?.retryable === true || RETRYABLE_CODES.has(error?.code);
}

export function createProviderConsentActivationPilotService({
  providerConsentService,
  providerAuthorizationStateRepository,
  providerExchangeResolver,
  credentialEnvelopeService,
  handoffStore,
  connectionRevocationRepository = null,
  clock = () => new Date(),
  idFactory = () => randomUUID(),
  claimTokenFactory = () => randomBytes(32).toString("base64url"),
  faultInjector = null,
  retryDelayMs = 5000,
} = {}) {
  const consentService = assertMethod(providerConsentService, "providerConsentService", "claim");
  const repository = assertProviderAuthorizationStateRepository(
    providerAuthorizationStateRepository,
  );
  const resolveExchange = typeof providerExchangeResolver === "function"
    ? providerExchangeResolver
    : providerExchangeResolver?.resolveProviderExchange;
  requireApplicationFunction(resolveExchange, "providerExchangeResolver");
  const credentialService = assertMethod(
    credentialEnvelopeService,
    "credentialEnvelopeService",
    "sealProviderCredential",
  );
  assertCredentialCertification(credentialService);
  const store = assertMethod(handoffStore, "handoffStore", "create");
  for (const method of ["acquire", "checkpoint", "release", "complete"]) {
    assertMethod(store, "handoffStore", method);
  }
  requireApplicationFunction(clock, "clock");
  requireApplicationFunction(idFactory, "idFactory");
  requireApplicationFunction(claimTokenFactory, "claimTokenFactory");
  if (faultInjector != null) requireApplicationFunction(faultInjector, "faultInjector");
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 300000) {
    throw new TypeError("retryDelayMs must be a safe integer between 0 and 300000.");
  }

  async function inject(point, context) {
    if (faultInjector) await faultInjector(point, Object.freeze({ ...context }));
  }

  async function claimCallback({ authorizationState, authorizationCode } = {}) {
    const serializedState = requireApplicationString(
      authorizationState,
      "authorizationState",
    );
    const code = requireApplicationString(authorizationCode, "authorizationCode");
    if (code.length > 16384) throw new TypeError("authorizationCode is too long.");
    const claimToken = requireApplicationString(claimTokenFactory(), "claimToken");
    const claimed = await consentService.claim({
      authorizationState: serializedState,
      claimTokenHash: sha256(claimToken),
    });
    const persisted = await repository.findAuthorizationState({
      tenantRef: claimed.tenantRef,
      stateRef: claimed.stateRef,
    });
    const state = validateClaimedState(persisted, claimed);
    const handoffRef = requireApplicationString(idFactory(), "handoffRef");
    const created = await store.create({
      handoffRef,
      expiresAt: state.expiresAt.toISOString(),
      maxAttempts: 4,
      payload: Object.freeze({
        authorizationCode: code,
        claimToken,
        state,
      }),
    });
    if (
      created?.persisted !== true
      || created?.payloadSealed !== true
      || created?.handoffRef !== handoffRef
    ) {
      throw pilotError(
        "provider_consent_handoff_persistence_failed",
        "Durable provider-consent handoff was not persisted and sealed exactly once.",
        500,
      );
    }
    return freezeApplicationValue({
      handoffRef,
      stateRef: state.stateRef,
      status: "claimed_handoff_ready",
      expiresAt: state.expiresAt.toISOString(),
      providerCallMade: false,
      credentialPayloadRead: false,
      secretsIncluded: false,
    });
  }

  async function resumeCallback({ handoffRef } = {}) {
    const ref = requireApplicationString(handoffRef, "handoffRef");
    const leaseRef = requireApplicationString(idFactory(), "leaseRef");
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError("clock must return a valid Date.");
    }
    const lease = await store.acquire({
      handoffRef: ref,
      leaseRef,
      leaseExpiresAt: new Date(now.getTime() + 60000).toISOString(),
    });
    if (!lease || lease.acquired !== true || lease.leaseRef !== leaseRef) {
      throw pilotError(
        "provider_consent_handoff_unavailable",
        "Provider callback handoff is missing, expired, completed, or already leased.",
        409,
        { handoff_ref: ref },
      );
    }

    try {
      const payload = requireApplicationObject(lease.payload, "handoff.payload");
      const stateInput = requireApplicationObject(payload.state, "handoff.state");
      const persisted = await repository.findAuthorizationState({
        tenantRef: stateInput.tenantRef,
        stateRef: stateInput.stateRef,
      });
      const state = validateClaimedState(persisted, stateInput);

      if (lease.completionCheckpoint) {
        const completed = await store.complete({ handoffRef: ref, leaseRef });
        if (completed?.completed !== true) {
          throw pilotError(
            "provider_consent_handoff_completion_failed",
            "Completed provider-consent handoff failed terminal CAS.",
            500,
          );
        }
        return freezeApplicationValue(lease.completionCheckpoint);
      }

      let envelope = lease.credentialCheckpoint
        ? normalizeCredentialEnvelope(lease.credentialCheckpoint, state)
        : null;
      let providerCallMade = false;

      if (!envelope) {
        const resolved = assertExchangeCertification(
          await resolveExchange(Object.freeze({
            providerKey: state.providerKey,
            tenantRef: state.tenantRef,
            workspaceRef: state.workspaceRef,
            brandRef: state.brandRef,
            ownerScopeType: state.ownerScopeType,
            ownerScopeRef: state.ownerScopeRef,
          })),
          state.providerKey,
        );
        const providerResult = await resolved.adapter.exchangeAuthorizationCode({
          authorizationCode: requireApplicationString(
            payload.authorizationCode,
            "handoff.authorizationCode",
          ),
          redirectTargetRef: state.redirectTargetRef,
          requestedProviderScopes: state.requestedProviderScopes,
          providerKey: state.providerKey,
          idempotencyKey: `${state.stateRef}:${state.claimRevision}`,
          timeoutMs: resolved.certification.timeoutMs,
        });
        providerCallMade = true;
        envelope = normalizeCredentialEnvelope(
          await credentialService.sealProviderCredential({
            providerKey: state.providerKey,
            providerResult,
            tenantRef: state.tenantRef,
            workspaceRef: state.workspaceRef,
            brandRef: state.brandRef,
            ownerScopeType: state.ownerScopeType,
            ownerScopeRef: state.ownerScopeRef,
          }),
          state,
        );
        const checkpointed = await store.checkpoint({
          handoffRef: ref,
          leaseRef,
          stage: "provider_completed",
          credentialCheckpoint: envelope,
        });
        if (checkpointed?.checkpointed !== true) {
          throw pilotError(
            "provider_consent_provider_checkpoint_failed",
            "Provider result was not durably checkpointed before persistence.",
            500,
          );
        }
        await inject("after_provider_checkpoint", {
          handoffRef: ref,
          stateRef: state.stateRef,
        });
      }

      const claimTokenHash = sha256(
        requireApplicationString(payload.claimToken, "handoff.claimToken"),
      );
      const completionInput = {
        tenantRef: state.tenantRef,
        stateRef: state.stateRef,
        expectedStateRevision: state.stateRevision,
        claimRevision: state.claimRevision,
        claimTokenHash,
        expectedConnectionRevision: state.expectedConnectionRevision ?? 0,
        providerAccountRef: envelope.providerAccountRef,
        providerAccountBindingHash: envelope.providerAccountBindingHash,
        providerAccountBindingVersion: envelope.providerAccountBindingVersion,
      };

      if (state.flowType === "authorize") {
        completionInput.connectionRef = requireApplicationString(idFactory(), "connectionRef");
        completionInput.linkRef = requireApplicationString(idFactory(), "linkRef");
        completionInput.ownershipRef = requireApplicationString(idFactory(), "ownershipRef");
        completionInput.encryptedCredentials = envelope.encryptedCredentials;
        completionInput.displayLabel = envelope.displayLabel;
        completionInput.accountLabel = envelope.accountLabel;
        completionInput.accountMetadata = envelope.accountMetadata;
        completionInput.grantedScopes = envelope.grantedScopes;
        completionInput.tokenExpiresAt = envelope.tokenExpiresAt;
      } else {
        const targetConnectionRef = requireApplicationString(
          state.targetConnectionRef,
          "state.targetConnectionRef",
        );
        completionInput.mutateConnection = async ({ executeCredentialMutation }) => {
          await executeCredentialMutation(`
            UPDATE user_app_connections
            SET encrypted_credentials = ?,
                token_expires_at = ?,
                scopes_granted = ?,
                account_label = ?,
                account_metadata = ?,
                status = 'active',
                last_used_at = UTC_TIMESTAMP()
            WHERE tenant_id = ?
              AND connection_id = ?
          `, [
            envelope.encryptedCredentials,
            envelope.tokenExpiresAt,
            envelope.grantedScopes.join(" "),
            envelope.accountLabel,
            JSON.stringify(envelope.accountMetadata),
            state.tenantRef,
            targetConnectionRef,
          ]);
        };
      }

      const completion = await repository.completeClaimedAuthorization(completionInput);
      const safeResult = safeCompletionResult(state, completion, providerCallMade);
      const completionCheckpoint = await store.checkpoint({
        handoffRef: ref,
        leaseRef,
        stage: "persistence_completed",
        completionCheckpoint: safeResult,
      });
      if (completionCheckpoint?.checkpointed !== true) {
        throw pilotError(
          "provider_consent_persistence_checkpoint_failed",
          "Provider-consent completion was not durably checkpointed.",
          500,
        );
      }
      await inject("after_persistence_checkpoint", {
        handoffRef: ref,
        stateRef: state.stateRef,
      });
      const completed = await store.complete({ handoffRef: ref, leaseRef });
      if (completed?.completed !== true) {
        throw pilotError(
          "provider_consent_handoff_completion_failed",
          "Provider-consent handoff failed terminal completion CAS.",
          500,
        );
      }
      return safeResult;
    } catch (error) {
      const retryable = isRetryableError(error);
      const nowForRetry = clock();
      await store.release({
        handoffRef: ref,
        leaseRef,
        retryable,
        errorCode: error?.code || "provider_consent_activation_pilot_failed",
        retryAt: retryable
          ? new Date(nowForRetry.getTime() + retryDelayMs).toISOString()
          : null,
      });
      throw error;
    }
  }

  async function revokeProviderConnection(input = {}) {
    if (!connectionRevocationRepository) {
      throw pilotError(
        "provider_connection_revoke_consistency_not_configured",
        "Certified provider-connection revocation repository is not configured.",
        503,
      );
    }
    const revocation = await assertMethod(
      connectionRevocationRepository,
      "connectionRevocationRepository",
      "revokeProviderConnection",
    ).revokeProviderConnection(input);
    if (
      revocation?.status !== "revoked"
      || revocation?.baseConnectionStatus !== "revoked"
      || revocation?.ownershipStatus !== "revoked"
    ) {
      throw pilotError(
        "provider_connection_revoke_consistency_failed",
        "Provider connection revocation did not prove both ownership and base status.",
        500,
      );
    }
    return freezeApplicationValue({ ...revocation, secretsIncluded: false });
  }

  return Object.freeze({
    claimCallback,
    resumeCallback,
    revokeProviderConnection,
  });
}

export const _testingProviderConsentActivationPilotService = Object.freeze({
  assertExchangeCertification,
  assertNoSecretKeys,
  isRetryableError,
  normalizeCredentialEnvelope,
  sanitizeAccountMetadata,
  sha256,
  validateClaimedState,
});
