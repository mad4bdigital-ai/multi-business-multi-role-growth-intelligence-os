import assert from "node:assert/strict";

import {
  createProviderConsentService,
  createProviderConsentStateCodec,
} from "./contextKernel/application/index.js";
import { createProviderConsentStateRepository } from "./contextKernel/infrastructure/sql/index.js";

const FIXED_NOW = new Date("2026-07-30T12:00:00.000Z");
const SECRET = "012-provider-consent-test-secret-material-32-bytes-minimum";
const CLAIM_HASH = "b".repeat(64);
const ACCOUNT_HASH = "c".repeat(64);

function expectCode(error, code) {
  assert.equal(error?.code, code);
  return true;
}

const codec = createProviderConsentStateCodec({
  secret: SECRET,
  clock: () => new Date(FIXED_NOW),
});

const baseContext = Object.freeze({
  flowType: "authorize",
  providerKey: "google_workspace",
  principalRef: "user:user-1",
  userRef: "user-1",
  tenantRef: "tenant-1",
  workspaceRef: "workspace-1",
  brandRef: null,
  ownerScopeType: "personal_workspace",
  ownerScopeRef: "workspace-1",
  targetConnectionRef: null,
  expectedConnectionRevision: null,
  expectedProviderAccountRef: null,
  expectedProviderAccountBindingHash: null,
  requestedProviderScopes: ["drive.readonly", "calendar.readonly", "drive.readonly"],
  redirectTargetRef: "provider-consent://callback/google",
});

const codecPayload = {
  ...baseContext,
  stateRef: "state-codec-1",
  nonce: "nonce-codec-1",
  stateRevision: 1,
  issuedAt: FIXED_NOW.toISOString(),
  expiresAt: new Date(FIXED_NOW.getTime() + 600_000).toISOString(),
};
const encoded = codec.issue(codecPayload);
const verified = codec.verify(encoded.serializedState);
assert.equal(verified.payload.stateRef, "state-codec-1");
assert.equal(verified.signatureHash.length, 64);
assert.equal(verified.signatureVersion, "hmac-sha256.v1");
assert.throws(
  () => codec.verify(`${encoded.serializedState.slice(0, -1)}x`),
  (error) => expectCode(error, "oauth_state_signature_invalid"),
);
const expiredCodec = createProviderConsentStateCodec({
  secret: SECRET,
  clock: () => new Date("2026-07-30T12:11:00.000Z"),
});
assert.throws(
  () => expiredCodec.verify(encoded.serializedState),
  (error) => expectCode(error, "oauth_state_expired"),
);

const serviceCalls = [];
const serviceRepository = {
  async issueAuthorizationState(input) {
    serviceCalls.push({ method: "issue", input });
    assert.equal(Object.hasOwn(input, "nonce"), false);
    assert.equal(Object.hasOwn(input, "authorizationState"), false);
    assert.match(input.nonceHash, /^[a-f0-9]{64}$/);
    assert.match(input.stateSignatureHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(input.requestedProviderScopes, ["calendar.readonly", "drive.readonly"]);
    return {
      ...input,
      status: "issued",
      stateRevision: 1,
      claimRevision: 0,
      claimVerifierPersisted: false,
    };
  },
  async findAuthorizationState() {
    throw new Error("findAuthorizationState is not used by this application slice.");
  },
  async claimAuthorizationState(input) {
    serviceCalls.push({ method: "claim", input });
    assert.equal(input.claimTokenHash, CLAIM_HASH);
    assert.match(input.nonceHash, /^[a-f0-9]{64}$/);
    assert.match(input.stateSignatureHash, /^[a-f0-9]{64}$/);
    return {
      ...input,
      status: "claimed",
      stateRevision: 2,
      claimRevision: 1,
      claimedAt: "2026-07-30T12:00:01.000Z",
      claimVerifierPersisted: true,
    };
  },
};
const service = createProviderConsentService({
  providerConsentStateRepository: serviceRepository,
  stateCodec: codec,
  idFactory: () => "state-service-1",
  nonceFactory: () => "nonce-service-1",
  clock: () => new Date(FIXED_NOW),
});
const issued = await service.issue(baseContext);
assert.equal(issued.persistedStatus, "issued");
assert.equal(issued.providerCallMade, false);
assert.equal(issued.credentialPayloadRead, false);
assert.equal(issued.secretsIncluded, false);
assert.equal(typeof issued.authorizationState, "string");
const claimed = await service.claim({
  authorizationState: issued.authorizationState,
  claimTokenHash: CLAIM_HASH,
});
assert.equal(claimed.status, "claimed");
assert.equal(claimed.stateRevision, 2);
assert.equal(claimed.claimVerifierPersisted, true);
assert.equal(claimed.providerCallMade, false);
assert.equal(claimed.credentialPayloadRead, false);
assert.equal(Object.hasOwn(claimed, "claimTokenHash"), false);
assert.deepEqual(serviceCalls.map((call) => call.method), ["issue", "claim"]);

await assert.rejects(
  () => service.issue({ ...baseContext, ownerScopeRef: "workspace-other" }),
  (error) => expectCode(error, "provider_consent_owner_scope_invalid"),
);
await assert.rejects(
  () => service.issue({
    ...baseContext,
    flowType: "reconnect",
    targetConnectionRef: "connection-1",
    expectedConnectionRevision: 7,
  }),
  (error) => expectCode(error, "provider_consent_reconnect_binding_required"),
);
await assert.rejects(
  () => service.claim({
    authorizationState: `${issued.authorizationState.slice(0, -1)}x`,
    claimTokenHash: CLAIM_HASH,
  }),
  (error) => expectCode(error, "oauth_state_signature_invalid"),
);

let persistedRow = null;
const sqlCalls = [];
const pool = {
  async query(statement, params = []) {
    const compact = String(statement).replace(/\s+/g, " ").trim();
    sqlCalls.push({ compact, params });
    if (/^INSERT INTO provider_authorization_states/i.test(compact)) {
      assert.equal(params.length, 21);
      persistedRow = {
        state_ref: params[0],
        flow_type: params[1],
        provider_key: params[2],
        principal_ref: params[3],
        user_id: params[4],
        tenant_id: params[5],
        workspace_id: params[6],
        brand_id: params[7],
        owner_scope_type: params[8],
        owner_scope_ref: params[9],
        target_connection_id: params[10],
        expected_connection_revision: params[11],
        expected_provider_account_ref: params[12],
        expected_provider_account_binding_hash: params[13],
        requested_provider_scopes_json: params[14],
        redirect_target_ref: params[15],
        nonce_hash: params[16],
        state_signature_hash: params[17],
        signature_version: params[18],
        state_revision: 1,
        claim_revision: 0,
        claim_verifier_persisted: 0,
        claimed_at: null,
        consumed_at: null,
        completion_revision: 0,
        status: "issued",
        failure_code: null,
        issued_at: params[19],
        expires_at: params[20],
        updated_at: params[19],
      };
      return [{ affectedRows: 1 }, []];
    }
    if (/^SELECT state_ref,/i.test(compact)) {
      return [persistedRow ? [persistedRow] : [], []];
    }
    if (/^UPDATE provider_authorization_states SET status = 'claimed'/i.test(compact)) {
      assert.equal(params.length, 17);
      const exactMatch = persistedRow
        && persistedRow.status === "issued"
        && params[1] === persistedRow.tenant_id
        && params[2] === persistedRow.state_ref
        && params[3] === persistedRow.state_revision
        && params[4] === persistedRow.nonce_hash
        && params[5] === persistedRow.state_signature_hash
        && params[6] === persistedRow.signature_version
        && params[7] === persistedRow.provider_key
        && params[8] === persistedRow.principal_ref
        && params[9] === persistedRow.workspace_id
        && (params[10] ?? null) === (persistedRow.brand_id ?? null)
        && params[11] === persistedRow.owner_scope_type
        && params[12] === persistedRow.owner_scope_ref
        && (params[13] ?? null) === (persistedRow.target_connection_id ?? null)
        && (params[14] ?? null) === (persistedRow.expected_connection_revision ?? null)
        && (params[15] ?? null) === (persistedRow.expected_provider_account_ref ?? null)
        && (params[16] ?? null) === (persistedRow.expected_provider_account_binding_hash ?? null);
      if (!exactMatch) return [{ affectedRows: 0 }, []];
      persistedRow = {
        ...persistedRow,
        status: "claimed",
        state_revision: persistedRow.state_revision + 1,
        claim_revision: persistedRow.claim_revision + 1,
        claim_verifier_persisted: 1,
        claimed_at: "2026-07-30T12:00:01.000Z",
      };
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected SQL in provider consent test: ${compact}`);
  },
};

const sqlRepository = createProviderConsentStateRepository({ pool });
const repositoryIssueInput = {
  ...baseContext,
  stateRef: "state-sql-1",
  nonceHash: "d".repeat(64),
  stateSignatureHash: "e".repeat(64),
  signatureVersion: "hmac-sha256.v1",
  issuedAt: FIXED_NOW,
  expiresAt: new Date(FIXED_NOW.getTime() + 600_000),
};
const sqlIssued = await sqlRepository.issueAuthorizationState(repositoryIssueInput);
assert.equal(sqlIssued.status, "issued");
assert.deepEqual(sqlIssued.requestedProviderScopes, ["calendar.readonly", "drive.readonly"]);
const sqlClaimed = await sqlRepository.claimAuthorizationState({
  ...repositoryIssueInput,
  expectedStateRevision: 1,
  claimTokenHash: CLAIM_HASH,
});
assert.equal(sqlClaimed.status, "claimed");
assert.equal(sqlClaimed.stateRevision, 2);
assert.equal(sqlClaimed.claimRevision, 1);
assert.equal(sqlClaimed.claimVerifierPersisted, true);
await assert.rejects(
  () => sqlRepository.claimAuthorizationState({
    ...repositoryIssueInput,
    expectedStateRevision: 1,
    claimTokenHash: CLAIM_HASH,
  }),
  (error) => expectCode(error, "oauth_state_claim_conflict"),
);
assert.equal(sqlCalls.some((call) => call.compact.includes("nonce_hash = ?")), true);
assert.equal(sqlCalls.some((call) => call.compact.includes("state_signature_hash = ?")), true);
assert.equal(sqlCalls.some((call) => call.compact.includes("expected_connection_revision <=> ?")), true);

const reconnectContext = {
  ...baseContext,
  flowType: "reconnect",
  targetConnectionRef: "connection-7",
  expectedConnectionRevision: 7,
  expectedProviderAccountBindingHash: ACCOUNT_HASH,
};
const reconnectCodec = createProviderConsentStateCodec({ secret: SECRET, clock: () => new Date(FIXED_NOW) });
const reconnectRepositoryCalls = [];
const reconnectService = createProviderConsentService({
  providerConsentStateRepository: {
    async issueAuthorizationState(input) {
      reconnectRepositoryCalls.push(input);
      return { ...input, status: "issued", stateRevision: 1 };
    },
    async findAuthorizationState() { return null; },
    async claimAuthorizationState() { throw new Error("not used"); },
  },
  stateCodec: reconnectCodec,
  idFactory: () => "state-reconnect-1",
  nonceFactory: () => "nonce-reconnect-1",
  clock: () => new Date(FIXED_NOW),
});
const reconnectIssued = await reconnectService.issue(reconnectContext);
assert.equal(reconnectIssued.targetConnectionRef, "connection-7");
assert.equal(reconnectIssued.expectedConnectionRevision, 7);
assert.equal(reconnectRepositoryCalls[0].expectedProviderAccountBindingHash, ACCOUNT_HASH);
assert.equal(reconnectRepositoryCalls[0].expectedProviderAccountRef, null);

console.log("context kernel provider consent core tests passed");
