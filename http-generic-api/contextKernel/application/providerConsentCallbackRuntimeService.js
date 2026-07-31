import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  assertProviderAuthorizationStateRepository,
} from "./repositoryPorts.js";
import {
  ContextApplicationError,
  freezeApplicationValue,
  requireApplicationFunction,
  requireApplicationObject,
  requireApplicationString,
} from "./applicationSupport.js";

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function runtimeError(code, message, status = 409, details = {}) {
  return new ContextApplicationError(code, message, status, {
    ...details,
    secrets_included: false,
  });
}

function optionalString(value, fieldName = "value") {
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

function normalizeSha256(value, fieldName, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = requireApplicationString(value, fieldName).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${fieldName} must be a SHA-256 value.`);
  }
  return normalized;
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

function normalizeClaimedState(state, claimed) {
  if (!state || typeof state !== "object") {
    throw runtimeError(
      "provider_consent_claim_readback_missing",
      "Claimed provider authorization state was not readable.",
      500,
    );
  }
  if (
    state.status !== "claimed"
    || state.stateRef !== claimed.stateRef
    || state.stateRevision !== claimed.stateRevision
    || state.claimRevision !== claimed.claimRevision
    || state.claimVerifierPersisted !== true
  ) {
    throw runtimeError(
      "provider_consent_claim_readback_mismatch",
      "Claimed provider authorization state failed exact same-cycle readback.",
      409,
      { state_ref: claimed.stateRef },
    );
  }
  return Object.freeze({
    stateRef: requireApplicationString(state.stateRef, "state.stateRef"),
    flowType: requireApplicationString(state.flowType, "state.flowType"),
    providerKey: requireApplicationString(state.providerKey, "state.providerKey"),
    principalRef: requireApplicationString(state.principalRef, "state.principalRef"),
    userRef: optionalString(state.userRef, "state.userRef"),
    tenantRef: requireApplicationString(state.tenantRef, "state.tenantRef"),
    workspaceRef: requireApplicationString(state.workspaceRef, "state.workspaceRef"),
    brandRef: optionalString(state.brandRef, "state.brandRef"),
    ownerScopeType: requireApplicationString(state.ownerScopeType, "state.ownerScopeType"),
    ownerScopeRef: requireApplicationString(state.ownerScopeRef, "state.ownerScopeRef"),
    targetConnectionRef: optionalString(state.targetConnectionRef, "state.targetConnectionRef"),
    expectedConnectionRevision: state.expectedConnectionRevision == null
      ? null
      : normalizeRevision(state.expectedConnectionRevision, "state.expectedConnectionRevision"),
    expectedProviderAccountRef: optionalString(
      state.expectedProviderAccountRef,
      "state.expectedProviderAccountRef",
    ),
    expectedProviderAccountBindingHash: normalizeSha256(
      state.expectedProviderAccountBindingHash,
      "state.expectedProviderAccountBindingHash",
      { nullable: true },
    ),
    requestedProviderScopes: normalizeStringList(
      state.requestedProviderScopes,
      "state.requestedProviderScopes",
    ),
    redirectTargetRef: requireApplicationString(
      state.redirectTargetRef,
      "state.redirectTargetRef",
    ),
    stateRevision: normalizeRevision(state.stateRevision, "state.stateRevision"),
    claimRevision: normalizeRevision(state.claimRevision, "state.claimRevision"),
    expiresAt: new Date(state.expiresAt),
  });
}

function normalizeCredentialEnvelope(value, state) {
  const envelope = requireApplicationObject(value, "credentialEnvelope");
  if (envelope.providerKey !== state.providerKey) {
    throw runtimeError(
      "provider_consent_provider_result_mismatch",
      "Credential envelope does not match the claimed provider.",
      409,
      { provider_key: state.providerKey },
    );
  }
  const providerAccountRef = optionalString(
    envelope.providerAccountRef,
    "credentialEnvelope.providerAccountRef",
  );
  const providerAccountBindingHash = normalizeSha256(
    envelope.providerAccountBindingHash,
    "credentialEnvelope.providerAccountBindingHash",
    { nullable: true },
  );
  if (!providerAccountRef && !providerAccountBindingHash) {
    throw runtimeError(
      "provider_consent_provider_account_binding_missing",
      "Credential envelope lacks a durable provider-account binding.",
      409,
    );
  }
  if (
    state.flowType === "reconnect"
    && state.expectedProviderAccountRef
    && providerAccountRef !== state.expectedProviderAccountRef
  ) {
    throw runtimeError(
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
    throw runtimeError(
      "provider_consent_provider_account_mismatch",
      "Reconnect returned a different provider-account binding.",
      409,
    );
  }
  return Object.freeze({
    providerKey: state.providerKey,
    encryptedCredentials: requireApplicationString(
      envelope.encryptedCredentials,
      "credentialEnvelope.encryptedCredentials",
    ),
    providerAccountRef,
    providerAccountBindingHash,
    providerAccountBindingVersion: optionalString(
      envelope.providerAccountBindingVersion,
      "credentialEnvelope.providerAccountBindingVersion",
    ),
    displayLabel: optionalString(envelope.displayLabel, "credentialEnvelope.displayLabel"),
    accountLabel: optionalString(envelope.accountLabel, "credentialEnvelope.accountLabel"),
    accountMetadata: envelope.accountMetadata && typeof envelope.accountMetadata === "object"
      ? envelope.accountMetadata
      : {},
    grantedScopes: normalizeStringList(envelope.grantedScopes, "credentialEnvelope.grantedScopes"),
    tokenExpiresAt: envelope.tokenExpiresAt || null,
  });
}

function safeCompletionResult(state, completion) {
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
    providerCallMade: true,
    credentialPayloadRead: false,
    credentialMutationPerformed: true,
    secretsIncluded: false,
  });
}

export function createProviderConsentCallbackRuntimeService({
  providerConsentService,
  providerAuthorizationStateRepository,
  providerExchangeResolver,
  credentialEnvelopeService,
  handoffStore,
  idFactory = () => randomUUID(),
  claimTokenFactory = () => randomBytes(32).toString("base64url"),
} = {}) {
  const consentService = assertMethod(providerConsentService, "providerConsentService", "claim");
  const repository = assertProviderAuthorizationStateRepository(
    providerAuthorizationStateRepository,
  );
  const resolveProviderExchange = typeof providerExchangeResolver === "function"
    ? providerExchangeResolver
    : providerExchangeResolver?.resolveProviderExchange;
  requireApplicationFunction(resolveProviderExchange, "providerExchangeResolver");
  const credentialService = assertMethod(
    credentialEnvelopeService,
    "credentialEnvelopeService",
    "sealProviderCredential",
  );
  const store = assertMethod(handoffStore, "handoffStore", "create");
  assertMethod(store, "handoffStore", "take");
  requireApplicationFunction(idFactory, "idFactory");
  requireApplicationFunction(claimTokenFactory, "claimTokenFactory");

  async function claimCallback({ authorizationState, authorizationCode } = {}) {
    const serializedState = requireApplicationString(
      authorizationState,
      "authorizationState",
    );
    const code = requireApplicationString(authorizationCode, "authorizationCode");
    if (code.length > 16384) throw new TypeError("authorizationCode is too long.");
    const claimToken = requireApplicationString(claimTokenFactory(), "claimToken");
    const claimTokenHash = sha256(claimToken);
    const claimed = await consentService.claim({
      authorizationState: serializedState,
      claimTokenHash,
    });
    const persisted = await repository.findAuthorizationState({
      tenantRef: claimed.tenantRef,
      stateRef: claimed.stateRef,
    });
    const state = normalizeClaimedState(persisted, claimed);
    if (!(state.expiresAt instanceof Date) || Number.isNaN(state.expiresAt.getTime())) {
      throw runtimeError(
        "provider_consent_state_expiry_invalid",
        "Claimed provider authorization state expiry is invalid.",
        500,
      );
    }
    const handoffRef = requireApplicationString(idFactory(), "handoffRef");
    const created = await store.create({
      handoffRef,
      expiresAt: state.expiresAt.toISOString(),
      payload: Object.freeze({
        authorizationCode: code,
        claimToken,
        state,
      }),
    });
    if (!created || created.handoffRef !== handoffRef || created.persisted !== true) {
      throw runtimeError(
        "provider_consent_handoff_persistence_failed",
        "Claimed callback handoff was not persisted exactly once.",
        500,
        { state_ref: state.stateRef },
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
    const handoff = await store.take({ handoffRef: ref });
    if (!handoff || handoff.consumed !== true) {
      throw runtimeError(
        "provider_consent_handoff_unavailable",
        "Provider callback handoff is missing, expired, or already consumed.",
        409,
        { handoff_ref: ref },
      );
    }
    const payload = requireApplicationObject(handoff.payload, "handoff.payload");
    const state = requireApplicationObject(payload.state, "handoff.state");
    const claimToken = requireApplicationString(payload.claimToken, "handoff.claimToken");
    const authorizationCode = requireApplicationString(
      payload.authorizationCode,
      "handoff.authorizationCode",
    );
    const persisted = await repository.findAuthorizationState({
      tenantRef: state.tenantRef,
      stateRef: state.stateRef,
    });
    const claimed = normalizeClaimedState(persisted, state);

    const exchange = await resolveProviderExchange(Object.freeze({
      providerKey: claimed.providerKey,
      tenantRef: claimed.tenantRef,
      workspaceRef: claimed.workspaceRef,
      brandRef: claimed.brandRef,
      ownerScopeType: claimed.ownerScopeType,
      ownerScopeRef: claimed.ownerScopeRef,
    }));
    assertMethod(exchange, "providerExchange", "exchangeAuthorizationCode");
    const providerResult = await exchange.exchangeAuthorizationCode({
      authorizationCode,
      redirectTargetRef: claimed.redirectTargetRef,
      requestedProviderScopes: claimed.requestedProviderScopes,
      providerKey: claimed.providerKey,
    });
    const envelope = normalizeCredentialEnvelope(
      await credentialService.sealProviderCredential({
        providerKey: claimed.providerKey,
        providerResult,
        tenantRef: claimed.tenantRef,
        workspaceRef: claimed.workspaceRef,
        brandRef: claimed.brandRef,
        ownerScopeType: claimed.ownerScopeType,
        ownerScopeRef: claimed.ownerScopeRef,
      }),
      claimed,
    );
    const claimTokenHash = sha256(claimToken);
    const completionInput = {
      tenantRef: claimed.tenantRef,
      stateRef: claimed.stateRef,
      expectedStateRevision: claimed.stateRevision,
      claimRevision: claimed.claimRevision,
      claimTokenHash,
      expectedConnectionRevision: claimed.expectedConnectionRevision ?? 0,
      providerAccountRef: envelope.providerAccountRef,
      providerAccountBindingHash: envelope.providerAccountBindingHash,
      providerAccountBindingVersion: envelope.providerAccountBindingVersion,
    };

    if (claimed.flowType === "authorize") {
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
        claimed.targetConnectionRef,
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
          claimed.tenantRef,
          targetConnectionRef,
        ]);
      };
    }

    const completion = await repository.completeClaimedAuthorization(completionInput);
    return safeCompletionResult(claimed, completion);
  }

  return Object.freeze({ claimCallback, resumeCallback });
}

export const _testingProviderConsentCallbackRuntimeService = Object.freeze({
  normalizeClaimedState,
  normalizeCredentialEnvelope,
  safeCompletionResult,
  sha256,
});
