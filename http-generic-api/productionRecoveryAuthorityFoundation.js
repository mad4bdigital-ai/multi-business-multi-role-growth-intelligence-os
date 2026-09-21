import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  timingSafeEqual,
  verify as verifyBytes,
} from "node:crypto";
import { createServerManagedDeploymentIdentityProvider } from "./serverManagedDeploymentIdentityProvider.js";

export const PRODUCTION_RECOVERY_AUTHORITY_FOUNDATION_CONTRACT =
  "mad4b.production-recovery-authority-foundation.v1";

const TICKET_SIGNATURE_CONTRACT = "mad4b.production-recovery-ticket-signature.v1";
const actionBindingSchema = "mad4b.production-recovery-action-binding.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const REQUIRED_STORE_METHODS = Object.freeze([
  "putApproval",
  "getApprovalByPlanStep",
  "putEphemeralCapability",
  "getEphemeralCapability",
]);

const DEFERRED_COMPONENTS = Object.freeze([
  "mutationExecutor",
  "hostLocalMutationExecutor",
  "readbackVerifier",
  "partialReceiptStore",
  "proofResolver",
  "migrationLedger",
]);

function text(value, max = 4096) {
  return String(value ?? "").trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

function digest(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = {
    contract: PRODUCTION_RECOVERY_AUTHORITY_FOUNDATION_CONTRACT,
    production_live_enabled: false,
    production_mutation_performed: false,
    database_connection_performed: false,
    provider_accessed: false,
    secrets_included: false,
    ...details,
  };
  throw error;
}

function requireStore(store) {
  const missing = REQUIRED_STORE_METHODS.filter((method) => typeof store?.[method] !== "function");
  if (missing.length || !store?.recoveryLock) {
    fail(
      "RECOVERY_PRODUCTION_FOUNDATION_STORE_INCOMPLETE",
      "Production Recovery authority foundation requires the canonical durable Recovery control store and fenced lock.",
      { missing_methods: missing, recovery_lock_present: Boolean(store?.recoveryLock) },
    );
  }
  return store;
}

function approvalBinding(value = {}) {
  const record = {
    contract: actionBindingSchema,
    approval_id: text(value.approval_id, 191),
    plan_id: text(value.plan_id, 191),
    plan_hash: text(value.plan_hash, 64).toLowerCase(),
    step_id: text(value.step_id, 191),
    step_hash: text(value.step_hash, 64).toLowerCase(),
    expected_sha: text(value.expected_sha, 40).toLowerCase(),
    target_key: text(value.target_key, 128),
    target_fingerprint: text(value.step_target_fingerprint || value.target_fingerprint, 64).toLowerCase(),
    target_role: text(value.target_role, 64),
    expires_at: text(value.expires_at, 64),
  };
  if (!record.approval_id || !record.plan_id || !SHA256.test(record.plan_hash)
    || !record.step_id || !SHA256.test(record.step_hash)
    || !/^[0-9a-f]{40}$/u.test(record.expected_sha)
    || !record.target_key || !SHA256.test(record.target_fingerprint)
    || !record.target_role || !Number.isFinite(Date.parse(record.expires_at))) {
    fail("RECOVERY_PRODUCTION_APPROVAL_BINDING_INVALID", "Approval material is not bound to a complete Recovery plan step.");
  }
  return Object.freeze(record);
}

function challengeRecordId(planHash, stepId) {
  return `approval-challenge:${digest({ plan_hash: text(planHash, 64).toLowerCase(), step_id: text(stepId, 191) }).slice(0, 48)}`;
}

function normalizeSecret(secret) {
  const bytes = Buffer.isBuffer(secret) ? Buffer.from(secret) : Buffer.from(String(secret ?? ""), "utf8");
  if (bytes.length < 32) {
    fail("RECOVERY_PRODUCTION_APPROVAL_SECRET_INVALID", "Production approval authority requires at least 256 bits of server-owned secret material.");
  }
  return bytes;
}

export function createProductionRecoveryApprovalAuthorities({ recoveryStore, approvalSecret } = {}) {
  const store = requireStore(recoveryStore);
  const secret = normalizeSecret(approvalSecret);

  const deriveToken = (approval) => createHmac("sha256", secret)
    .update(canonical(approvalBinding(approval)))
    .digest("base64url");

  const issuer = Object.freeze({
    contract: "mad4b.production-recovery-approval-issuer.v1",
    async createChallenge(challenge = {}) {
      approvalBinding(challenge);
      return Object.freeze({
        issued: true,
        delivery: "server_managed_confirmation",
        approval_token_returned: false,
        approval_token_persisted: false,
        secrets_included: false,
      });
    },
  });

  const verifier = Object.freeze({
    contract: "mad4b.production-recovery-approval-verifier.v1",
    async verify({ token, approval } = {}) {
      const supplied = Buffer.from(text(token, 512), "utf8");
      const expected = Buffer.from(deriveToken(approval), "utf8");
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    },
  });

  const approvalStore = Object.freeze({
    contract: "mad4b.production-recovery-approval-store-adapter.v1",
    durable: true,
    independent_of_target_databases: true,
    async putChallenge(challenge = {}) {
      const bound = approvalBinding(challenge);
      await store.putEphemeralCapability({
        capability_id: challengeRecordId(bound.plan_hash, bound.step_id),
        ...challenge,
        approval_token_stored: false,
        secrets_included: false,
      });
      return { persisted: true, durable: true, approval_token_stored: false, secrets_included: false };
    },
    async getChallenge(planHash, stepId) {
      return store.getEphemeralCapability(challengeRecordId(planHash, stepId));
    },
    async resolveApprovedExecutionApproval(context = {}) {
      const approval = await store.getApprovalByPlanStep(context.plan_id, context.step_id);
      if (!approval) fail("RECOVERY_PRODUCTION_APPROVAL_NOT_FOUND", "The durable approved Recovery step is unavailable.");
      const bound = approvalBinding(approval);
      const expected = {
        approval_id: text(context.approval_id, 191),
        plan_id: text(context.plan_id, 191),
        plan_hash: text(context.plan_hash, 64).toLowerCase(),
        step_id: text(context.step_id, 191),
        step_hash: text(context.step_hash, 64).toLowerCase(),
        expected_sha: text(context.expected_sha, 40).toLowerCase(),
        target_key: text(context.target_key, 128),
        target_fingerprint: text(context.target_fingerprint, 64).toLowerCase(),
        target_role: text(context.target_role, 64),
      };
      for (const [key, value] of Object.entries(expected)) {
        if (key === "target_fingerprint") {
          if (bound.target_fingerprint !== value) fail("RECOVERY_PRODUCTION_APPROVAL_BINDING_MISMATCH", "Server-side approval target binding does not match the approved step.", { field: key });
        } else if (key !== "expires_at" && bound[key] !== value) {
          fail("RECOVERY_PRODUCTION_APPROVAL_BINDING_MISMATCH", "Server-side approval binding does not match the approved step.", { field: key });
        }
      }
      if (approval.used === true || Date.parse(bound.expires_at) <= Date.now()) {
        fail("RECOVERY_PRODUCTION_APPROVAL_NOT_EXECUTABLE", "The durable approval is expired or already consumed.");
      }
      return Object.freeze({
        approval_token: deriveToken(approval),
        server_resolved: true,
        token_persisted: false,
        secrets_included: false,
      });
    },
  });

  return Object.freeze({ issuer, verifier, approvalStore });
}

function parseJwk(value, field) {
  const candidate = typeof value === "string" ? (() => {
    try { return JSON.parse(value); } catch { return null; }
  })() : value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    fail("RECOVERY_PRODUCTION_TICKET_KEY_INVALID", `${field} must be a server-owned Ed25519 JWK.`);
  }
  return candidate;
}

export function createProductionRecoveryExecutionTicketAuthorities({
  privateKeyJwk,
  publicKeyJwk = null,
} = {}) {
  let privateKey;
  let publicKey;
  try {
    privateKey = createPrivateKey({ key: parseJwk(privateKeyJwk, "privateKeyJwk"), format: "jwk" });
    publicKey = publicKeyJwk
      ? createPublicKey({ key: parseJwk(publicKeyJwk, "publicKeyJwk"), format: "jwk" })
      : createPublicKey(privateKey);
  } catch {
    fail("RECOVERY_PRODUCTION_TICKET_KEY_INVALID", "Production execution-ticket signing keys are invalid.");
  }
  if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") {
    fail("RECOVERY_PRODUCTION_TICKET_KEY_TYPE_INVALID", "Production execution-ticket authority requires Ed25519 keys.");
  }

  const signaturePayload = (ticketHash) => {
    const normalized = text(ticketHash, 64).toLowerCase();
    if (!SHA256.test(normalized)) fail("RECOVERY_PRODUCTION_TICKET_HASH_INVALID", "Execution-ticket hash must be SHA-256.");
    return Buffer.from(canonical({ contract: TICKET_SIGNATURE_CONTRACT, ticket_hash: normalized }), "utf8");
  };

  const signer = Object.freeze({
    contract: "mad4b.production-recovery-execution-ticket-signer.v1",
    async sign({ ticket_hash: ticketHash } = {}) {
      return signBytes(null, signaturePayload(ticketHash), privateKey).toString("base64url");
    },
  });
  const verifier = Object.freeze({
    contract: "mad4b.production-recovery-execution-ticket-verifier.v1",
    async verify({ ticket, ticket_hash: ticketHash } = {}) {
      const signature = text(ticket?.signature, 2048);
      if (!signature) return false;
      try {
        return verifyBytes(null, signaturePayload(ticketHash), publicKey, Buffer.from(signature, "base64url"));
      } catch {
        return false;
      }
    },
  });

  return Object.freeze({ signer, verifier });
}

export function createProductionRecoveryAuthorityFoundation({
  recoveryStoreFactory,
  approvalSecret,
  executionPrivateKeyJwk,
  executionPublicKeyJwk = null,
  readServerAttestation,
} = {}) {
  if (typeof recoveryStoreFactory !== "function") {
    fail("RECOVERY_PRODUCTION_FOUNDATION_STORE_FACTORY_MISSING", "A deployment-owned Recovery control-store factory is required.");
  }
  const ticket = createProductionRecoveryExecutionTicketAuthorities({
    privateKeyJwk: executionPrivateKeyJwk,
    publicKeyJwk: executionPublicKeyJwk,
  });
  const recoveryStore = requireStore(recoveryStoreFactory({ executionTicketVerifier: ticket.verifier }));
  if (recoveryStore.executionTicketVerifier !== ticket.verifier) {
    fail("RECOVERY_PRODUCTION_TICKET_VERIFIER_IDENTITY_MISMATCH", "Recovery Store must retain the exact execution-ticket verifier object supplied by the foundation.");
  }
  const approval = createProductionRecoveryApprovalAuthorities({ recoveryStore, approvalSecret });
  const deploymentIdentityProvider = createServerManagedDeploymentIdentityProvider({
    readServerAttestation,
    environment: "production",
  });
  if (!deploymentIdentityProvider) {
    fail("RECOVERY_PRODUCTION_DEPLOYMENT_IDENTITY_UNAVAILABLE", "A server-derived Production deployment attestation reader is required.");
  }

  return Object.freeze({
    contract: PRODUCTION_RECOVERY_AUTHORITY_FOUNDATION_CONTRACT,
    phase: "canary_foundation",
    production_live_enabled: false,
    activation_eligible: false,
    recoveryStore,
    recoveryLock: recoveryStore.recoveryLock,
    approvalIssuer: approval.issuer,
    approvalVerifier: approval.verifier,
    approvalStore: approval.approvalStore,
    executionTicketSigner: ticket.signer,
    executionTicketVerifier: ticket.verifier,
    deploymentIdentityProvider,
    deferred_components: [...DEFERRED_COMPONENTS],
    complete_authority_graph: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    provider_accessed: false,
    workflow_dispatch_performed: false,
    secrets_included: false,
  });
}

export const _testingProductionRecoveryAuthorityFoundation = Object.freeze({
  approvalBinding,
  challengeRecordId,
  canonical,
  digest,
  DEFERRED_COMPONENTS,
});
