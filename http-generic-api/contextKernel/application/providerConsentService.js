import { createHash, randomBytes, randomUUID } from "node:crypto";

import { assertProviderConsentStateRepository } from "./repositoryPorts.js";
import {
  ContextApplicationError,
  freezeApplicationValue,
  requireApplicationFunction,
  requireApplicationObject,
  requireApplicationString,
} from "./applicationSupport.js";

const FLOW_TYPES = new Set(["authorize", "reconnect"]);
const OWNER_SCOPE_TYPES = new Set(["personal_workspace", "company_workspace", "brand"]);

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function optionalString(value) {
  if (value == null || value === "") return null;
  return requireApplicationString(value, "value");
}

function normalizeRevision(value, fieldName, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
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
    throw new TypeError(`${fieldName} must be a 64-character hexadecimal SHA-256 value.`);
  }
  return normalized;
}

function normalizeScopes(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError("requestedProviderScopes must be an array.");
  return [...new Set(value.map((scope) => requireApplicationString(scope, "requestedProviderScopes[]")))].sort();
}

function normalizeContext(input = {}) {
  const source = requireApplicationObject(input, "providerConsentContext");
  const flowType = requireApplicationString(source.flowType, "flowType");
  if (!FLOW_TYPES.has(flowType)) throw new TypeError("flowType must be authorize or reconnect.");
  const ownerScopeType = requireApplicationString(source.ownerScopeType, "ownerScopeType");
  if (!OWNER_SCOPE_TYPES.has(ownerScopeType)) {
    throw new TypeError("ownerScopeType must be personal_workspace, company_workspace, or brand.");
  }
  const userRef = optionalString(source.userRef);
  const tenantRef = requireApplicationString(source.tenantRef, "tenantRef");
  const workspaceRef = requireApplicationString(source.workspaceRef, "workspaceRef");
  const brandRef = optionalString(source.brandRef);
  const ownerScopeRef = requireApplicationString(source.ownerScopeRef, "ownerScopeRef");
  if (ownerScopeType === "personal_workspace") {
    if (!userRef || ownerScopeRef !== workspaceRef || brandRef) {
      throw new ContextApplicationError(
        "provider_consent_owner_scope_invalid",
        "Personal workspace consent requires the authenticated user and exact workspace owner scope.",
        422,
      );
    }
  }
  if (ownerScopeType === "company_workspace" && (ownerScopeRef !== workspaceRef || brandRef)) {
    throw new ContextApplicationError(
      "provider_consent_owner_scope_invalid",
      "Company workspace consent requires the exact workspace owner scope.",
      422,
    );
  }
  if (ownerScopeType === "brand" && (!brandRef || ownerScopeRef !== brandRef)) {
    throw new ContextApplicationError(
      "provider_consent_owner_scope_invalid",
      "Brand consent requires the exact brand owner scope.",
      422,
    );
  }

  const targetConnectionRef = optionalString(source.targetConnectionRef);
  const expectedConnectionRevision = normalizeRevision(
    source.expectedConnectionRevision,
    "expectedConnectionRevision",
    { nullable: true },
  );
  const expectedProviderAccountRef = optionalString(source.expectedProviderAccountRef);
  const expectedProviderAccountBindingHash = normalizeSha256(
    source.expectedProviderAccountBindingHash,
    "expectedProviderAccountBindingHash",
    { nullable: true },
  );
  if (flowType === "authorize") {
    if (targetConnectionRef || expectedConnectionRevision != null || expectedProviderAccountRef || expectedProviderAccountBindingHash) {
      throw new ContextApplicationError(
        "provider_consent_authorize_binding_forbidden",
        "A new authorization cannot carry reconnect target or provider-account bindings.",
        422,
      );
    }
  } else if (
    !targetConnectionRef
    || expectedConnectionRevision == null
    || (!expectedProviderAccountRef && !expectedProviderAccountBindingHash)
  ) {
    throw new ContextApplicationError(
      "provider_consent_reconnect_binding_required",
      "Reconnect consent requires target connection, expected revision, and durable provider-account binding.",
      422,
    );
  }

  return Object.freeze({
    flowType,
    providerKey: requireApplicationString(source.providerKey, "providerKey"),
    principalRef: requireApplicationString(source.principalRef, "principalRef"),
    userRef,
    tenantRef,
    workspaceRef,
    brandRef,
    ownerScopeType,
    ownerScopeRef,
    targetConnectionRef,
    expectedConnectionRevision,
    expectedProviderAccountRef,
    expectedProviderAccountBindingHash,
    requestedProviderScopes: normalizeScopes(source.requestedProviderScopes),
    redirectTargetRef: requireApplicationString(source.redirectTargetRef, "redirectTargetRef"),
  });
}

function assertCodec(codec) {
  if (!codec || typeof codec.issue !== "function" || typeof codec.verify !== "function") {
    throw new TypeError("stateCodec with issue and verify methods is required.");
  }
  return codec;
}

function payloadFromContext(context, { stateRef, nonce, issuedAt, expiresAt }) {
  return Object.freeze({
    stateRef,
    nonce,
    stateRevision: 1,
    ...context,
    issuedAt,
    expiresAt,
  });
}

function assertVerifiedPayloadMatchesContext(payload, context) {
  const fields = [
    "flowType",
    "providerKey",
    "principalRef",
    "userRef",
    "tenantRef",
    "workspaceRef",
    "brandRef",
    "ownerScopeType",
    "ownerScopeRef",
    "targetConnectionRef",
    "expectedConnectionRevision",
    "expectedProviderAccountRef",
    "expectedProviderAccountBindingHash",
    "redirectTargetRef",
  ];
  for (const field of fields) {
    if ((payload[field] ?? null) !== (context[field] ?? null)) {
      throw new ContextApplicationError(
        "oauth_state_context_mismatch",
        "Signed provider consent state does not match its normalized context.",
        409,
        { field },
      );
    }
  }
  const payloadScopes = normalizeScopes(payload.requestedProviderScopes);
  if (JSON.stringify(payloadScopes) !== JSON.stringify(context.requestedProviderScopes)) {
    throw new ContextApplicationError(
      "oauth_state_context_mismatch",
      "Signed provider consent scopes do not match their normalized context.",
      409,
      { field: "requestedProviderScopes" },
    );
  }
}

export function createProviderConsentService({
  providerConsentStateRepository,
  stateCodec,
  idFactory = () => randomUUID(),
  nonceFactory = () => randomBytes(32).toString("base64url"),
  clock = () => new Date(),
  stateTtlSeconds = 10 * 60,
} = {}) {
  const repository = assertProviderConsentStateRepository(providerConsentStateRepository);
  const codec = assertCodec(stateCodec);
  requireApplicationFunction(idFactory, "idFactory");
  requireApplicationFunction(nonceFactory, "nonceFactory");
  requireApplicationFunction(clock, "clock");
  if (!Number.isSafeInteger(stateTtlSeconds) || stateTtlSeconds <= 0 || stateTtlSeconds > 15 * 60) {
    throw new TypeError("stateTtlSeconds must be between 1 and 900 seconds.");
  }

  async function issue(input) {
    const context = normalizeContext(input);
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("clock must return a valid Date.");
    const stateRef = requireApplicationString(idFactory(), "stateRef");
    const nonce = requireApplicationString(nonceFactory(), "nonce");
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + stateTtlSeconds * 1000).toISOString();
    const payload = payloadFromContext(context, { stateRef, nonce, issuedAt, expiresAt });
    const encoded = codec.issue(payload);
    const signatureHash = normalizeSha256(encoded?.signatureHash, "stateSignatureHash");
    const signatureVersion = requireApplicationString(encoded?.signatureVersion, "signatureVersion");
    const authorizationState = requireApplicationString(encoded?.serializedState, "serializedState");

    const stored = await repository.issueAuthorizationState({
      ...context,
      stateRef,
      nonceHash: sha256(nonce),
      stateSignatureHash: signatureHash,
      signatureVersion,
      issuedAt,
      expiresAt,
    });
    return freezeApplicationValue({
      authorizationState,
      stateRef,
      flowType: context.flowType,
      providerKey: context.providerKey,
      tenantRef: context.tenantRef,
      workspaceRef: context.workspaceRef,
      brandRef: context.brandRef,
      ownerScopeType: context.ownerScopeType,
      ownerScopeRef: context.ownerScopeRef,
      targetConnectionRef: context.targetConnectionRef,
      expectedConnectionRevision: context.expectedConnectionRevision,
      expiresAt,
      persistedStatus: stored?.status || "issued",
      stateRevision: stored?.stateRevision ?? 1,
      providerCallMade: false,
      credentialPayloadRead: false,
      secretsIncluded: false,
    });
  }

  async function claim({ authorizationState, claimTokenHash }) {
    const rawState = requireApplicationString(authorizationState, "authorizationState");
    const verified = codec.verify(rawState);
    const payload = requireApplicationObject(verified?.payload, "verifiedStatePayload");
    const context = normalizeContext(payload);
    assertVerifiedPayloadMatchesContext(payload, context);
    const stateRef = requireApplicationString(payload.stateRef, "stateRef");
    const nonce = requireApplicationString(payload.nonce, "nonce");
    const stateRevision = normalizeRevision(payload.stateRevision, "stateRevision");
    const signatureHash = normalizeSha256(verified?.signatureHash, "stateSignatureHash");
    const signatureVersion = requireApplicationString(verified?.signatureVersion, "signatureVersion");
    const verifierHash = normalizeSha256(claimTokenHash, "claimTokenHash");

    const claimed = await repository.claimAuthorizationState({
      ...context,
      stateRef,
      expectedStateRevision: stateRevision,
      nonceHash: sha256(nonce),
      stateSignatureHash: signatureHash,
      signatureVersion,
      claimTokenHash: verifierHash,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
    });
    return freezeApplicationValue({
      stateRef: claimed.stateRef,
      status: claimed.status,
      stateRevision: claimed.stateRevision,
      claimRevision: claimed.claimRevision,
      claimedAt: claimed.claimedAt,
      claimVerifierPersisted: claimed.claimVerifierPersisted,
      providerKey: claimed.providerKey,
      tenantRef: claimed.tenantRef,
      workspaceRef: claimed.workspaceRef,
      brandRef: claimed.brandRef,
      ownerScopeType: claimed.ownerScopeType,
      ownerScopeRef: claimed.ownerScopeRef,
      targetConnectionRef: claimed.targetConnectionRef,
      expectedConnectionRevision: claimed.expectedConnectionRevision,
      providerCallMade: false,
      credentialPayloadRead: false,
      secretsIncluded: false,
    });
  }

  return Object.freeze({ issue, claim });
}

export const _testingProviderConsentService = Object.freeze({
  assertVerifiedPayloadMatchesContext,
  normalizeContext,
  normalizeScopes,
  payloadFromContext,
  sha256,
});
