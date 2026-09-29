import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { verifyRecoveryExternalEvidenceIntegrity } from "./recoveryReadinessEvidence.js";
import { classifyRecoveryDirectDenial } from "./recoveryDirectDenialPolicy.js";

export const RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_CONTRACT =
  "mad4b.recovery-external-acquisition-receipt.v1";
export const RECOVERY_EXTERNAL_ACQUISITION_AUTHORITY_CONTRACT =
  "mad4b.recovery-external-acquisition-authority.v1";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:@/-]{8,200}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const MAX_TTL_MS = 60 * 60 * 1000;
const authorities = new WeakSet();
const sourceVerifications = new WeakSet();

const SOURCE = Object.freeze({
  registration: Object.freeze({
    evidence_kind: "chatgpt_registration",
    source: "chatgpt_live_readback",
  }),
  oauth: Object.freeze({
    evidence_kind: "oauth_browser_round_trip",
    source: "oauth_server_correlation",
  }),
  network: Object.freeze({
    evidence_kind: "origin_network_isolation",
    source: "independent_network_probe",
  }),
});

const SECRET_FIELD =
  /^(?:authorization|password|secret|credential|credentials|private[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|bearer[_-]?token)$|(?:^|[_-])(?:password|secret|credential|private[_-]?key|access[_-]?token|refresh[_-]?token)(?:$|[_-])/iu;
const CAMEL_SECRET_FIELD =
  /(?:Secret|Password|Credential|PrivateKey|AccessToken|RefreshToken|IdToken|ApiKey|BearerToken)(?:$|[A-Z])/u;

const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, stable(value[key])]),
        )
      : value;

export function recoveryExternalAcquisitionCanonicalPayload(value) {
  return JSON.stringify(stable(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hasSecret(value) {
  return (
    value &&
    typeof value === "object" &&
    Object.entries(value).some(
      ([key, nested]) =>
        (key !== "secrets_included" &&
          (SECRET_FIELD.test(key) || CAMEL_SECRET_FIELD.test(key))) ||
        hasSecret(nested),
    )
  );
}

function fail(code, message = code, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.secrets_included = false;
  return error;
}

function receiptPayload(receipt) {
  const payload = { ...receipt };
  delete payload.signature_b64url;
  return payload;
}

export function recoveryExternalSourceProofHash(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  return sha256(
    recoveryExternalAcquisitionCanonicalPayload({
      contract: evidence.contract,
      evidence_kind: evidence.evidence_kind,
      source_provenance: evidence.source_provenance,
      deployment_sha: evidence.deployment_sha,
      target_fingerprint: evidence.target_fingerprint,
      evidence_hash: evidence.evidence_hash,
      observed_at: evidence.observed_at,
      expires_at: evidence.expires_at,
    }),
  );
}

export function recoveryExternalAcquisitionReceiptDigest(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
  return sha256(
    recoveryExternalAcquisitionCanonicalPayload(receiptPayload(receipt)),
  );
}

function invalid(reason_code, detail = null) {
  return Object.freeze({
    verified: false,
    reason_code,
    detail,
    authority_contract: RECOVERY_EXTERNAL_ACQUISITION_AUTHORITY_CONTRACT,
    secrets_included: false,
  });
}

export function brandRecoveryExternalSourceVerification(kind, value, evidence) {
  const source = SOURCE[kind];
  // PR-B1 intentionally permits in-process branding only for the live network
  // probe path. OAuth remains structural-only until a runtime-owned correlation
  // collector exists, and Registration remains closed until provider-backed
  // source attestation exists.
  if (
    kind !== "network" ||
    !source ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.verified !== true ||
    value.source !== source.source ||
    value.evidence_hash !== evidence?.evidence_hash ||
    value.source_proof_hash !== recoveryExternalSourceProofHash(evidence) ||
    value.secrets_included !== false
  ) {
    return value;
  }
  sourceVerifications.add(value);
  return value;
}

function isBrandedSourceVerification(kind, value, evidence) {
  const source = SOURCE[kind];
  return Boolean(
    source &&
      sourceVerifications.has(value) &&
      value?.verified === true &&
      value?.source === source.source &&
      value?.evidence_hash === evidence?.evidence_hash &&
      value?.source_proof_hash === recoveryExternalSourceProofHash(evidence) &&
      value?.secrets_included === false
  );
}

function observationValid(kind, observation, evidence) {
  const source = SOURCE[kind];
  return Boolean(
    source &&
      observation &&
      observation.verified === true &&
      observation.source === source.source &&
      observation.observation_id === evidence?.source_provenance?.observation_id &&
      observation.evidence_hash === evidence?.evidence_hash &&
      observation.source_proof_hash === recoveryExternalSourceProofHash(evidence) &&
      SHA256.test(observation.evidence_hash || "") &&
      SHA256.test(observation.source_proof_hash || ""),
  );
}

function canonicalNetworkDirectDenial(networkEvidence) {
  const denial = classifyRecoveryDirectDenial({
    status: networkEvidence?.direct_recovery_surface_status,
    reason: networkEvidence?.direct_recovery_surface_reason,
  });
  if (
    !denial ||
    networkEvidence?.direct_recovery_surface_denial_class !==
      denial.denial_class
  ) {
    return null;
  }
  return denial;
}

function verifyReceiptInternal(
  receipt,
  {
    publicKey,
    keyId,
    issuer,
    expectedSha,
    expectedTargetFingerprint,
    registrationEvidence,
    oauthEvidence,
    networkEvidence,
    now = Date.now(),
  } = {},
) {
  if (
    !receipt ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    receipt.contract !== RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_CONTRACT ||
    receipt.environment !== "staging" ||
    receipt.issuer !== issuer ||
    receipt.key_id !== keyId ||
    !SHA40.test(expectedSha || "") ||
    !SHA256.test(expectedTargetFingerprint || "") ||
    receipt.deployment_sha !== expectedSha ||
    receipt.target_fingerprint !== expectedTargetFingerprint ||
    !SAFE_ID.test(receipt.acquisition_run_id || "") ||
    receipt.secrets_included !== false ||
    hasSecret(receipt) ||
    !SIGNATURE.test(receipt.signature_b64url || "")
  ) {
    return invalid("RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_INVALID");
  }

  const issued = Date.parse(receipt.issued_at || "");
  const expires = Date.parse(receipt.expires_at || "");
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    issued > now + 60_000 ||
    expires <= now ||
    expires <= issued ||
    expires - issued > MAX_TTL_MS
  ) {
    return invalid("RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_EXPIRED");
  }

  const evidenceByKind = {
    registration: registrationEvidence,
    oauth: oauthEvidence,
    network: networkEvidence,
  };

  for (const kind of Object.keys(SOURCE)) {
    const evidence = evidenceByKind[kind];
    if (
      !verifyRecoveryExternalEvidenceIntegrity(evidence, {
        kind,
        expectedSha,
        expectedTargetFingerprint,
        now,
      })
    ) {
      return invalid("RECOVERY_EXTERNAL_ACQUISITION_EVIDENCE_INVALID", kind);
    }
    if (!observationValid(kind, receipt.observations?.[kind], evidence)) {
      return invalid("RECOVERY_EXTERNAL_ACQUISITION_SOURCE_BINDING_INVALID", kind);
    }
  }

  // Receipt verification uses the same exact canonical direct-denial policy as
  // Network acquisition. The denial class is re-derived from status+reason and
  // compared with the evidence field; arbitrary 4xx values never become authority.
  if (
    !canonicalNetworkDirectDenial(networkEvidence) ||
    networkEvidence?.public_health_identity?.status !== 200 ||
    networkEvidence?.public_health_identity?.ok !== true ||
    networkEvidence?.public_health_identity?.source_commit !== expectedSha ||
    networkEvidence?.public_health_identity?.worker_build_sha !== expectedSha ||
    !SHA256.test(networkEvidence?.public_health_identity?.worker_bundle_sha256 || "") ||
    !SHA256.test(networkEvidence?.public_health_identity?.policy_hash || "") ||
    networkEvidence?.public_health_identity?.secrets_included !== false
  ) {
    return invalid("RECOVERY_EXTERNAL_ACQUISITION_NETWORK_SOURCE_INVALID");
  }

  let key;
  try {
    key =
      publicKey?.type === "public" && publicKey?.asymmetricKeyType
        ? publicKey
        : createPublicKey(publicKey);
  } catch {
    return invalid("RECOVERY_EXTERNAL_ACQUISITION_KEY_INVALID");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    return invalid("RECOVERY_EXTERNAL_ACQUISITION_KEY_INVALID");
  }

  const payload = receiptPayload(receipt);
  let signatureValid = false;
  try {
    signatureValid = cryptoVerify(
      null,
      Buffer.from(recoveryExternalAcquisitionCanonicalPayload(payload)),
      key,
      Buffer.from(receipt.signature_b64url, "base64url"),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return invalid("RECOVERY_EXTERNAL_ACQUISITION_SIGNATURE_INVALID");
  }

  return Object.freeze({
    verified: true,
    reason_code: null,
    authority_contract: RECOVERY_EXTERNAL_ACQUISITION_AUTHORITY_CONTRACT,
    receipt_contract: RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_CONTRACT,
    receipt_digest: recoveryExternalAcquisitionReceiptDigest(receipt),
    deployment_sha: expectedSha,
    target_fingerprint: expectedTargetFingerprint,
    acquisition_run_id: receipt.acquisition_run_id,
    issued_at: receipt.issued_at,
    expires_at: receipt.expires_at,
    secrets_included: false,
  });
}

export function createRecoveryExternalAcquisitionAuthority({
  publicKey,
  keyId,
  issuer,
} = {}) {
  let parsedKey;
  try {
    parsedKey = createPublicKey(publicKey);
  } catch {
    throw fail(
      "RECOVERY_EXTERNAL_ACQUISITION_KEY_INVALID",
      "Recovery external acquisition public key is invalid.",
    );
  }
  if (
    parsedKey.asymmetricKeyType !== "ed25519" ||
    !SAFE_ID.test(keyId || "") ||
    typeof issuer !== "string" ||
    !issuer.startsWith("https://")
  ) {
    throw fail(
      "RECOVERY_EXTERNAL_ACQUISITION_TRUST_INVALID",
      "Recovery external acquisition trust configuration is invalid.",
    );
  }

  const authority = Object.freeze({
    contract: RECOVERY_EXTERNAL_ACQUISITION_AUTHORITY_CONTRACT,
    key_id: keyId,
    issuer,
    verify(input = {}) {
      return verifyReceiptInternal(input.receipt, {
        ...input,
        publicKey: parsedKey,
        keyId,
        issuer,
      });
    },
  });
  authorities.add(authority);
  return authority;
}

export function isRecoveryExternalAcquisitionAuthority(value) {
  return authorities.has(value);
}

export async function verifyRecoveryExternalAcquisitionAuthority(
  authority,
  input = {},
) {
  if (!authorities.has(authority)) {
    return invalid("RECOVERY_EXTERNAL_ACQUISITION_AUTHORITY_UNTRUSTED");
  }
  return authority.verify(input);
}

export function signRecoveryExternalAcquisitionReceipt(
  {
    deploymentSha,
    targetFingerprint,
    acquisitionRunId,
    registrationEvidence,
    oauthEvidence,
    networkEvidence,
    sourceVerification = {},
    issuedAt = new Date().toISOString(),
    expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  } = {},
  { privateKey, keyId, issuer } = {},
) {
  if (
    !SHA40.test(deploymentSha || "") ||
    !SHA256.test(targetFingerprint || "") ||
    !SAFE_ID.test(acquisitionRunId || "") ||
    !SAFE_ID.test(keyId || "") ||
    typeof issuer !== "string" ||
    !issuer.startsWith("https://")
  ) {
    throw fail(
      "RECOVERY_EXTERNAL_ACQUISITION_SIGNING_INPUT_INVALID",
      "Recovery acquisition signing input is invalid.",
    );
  }

  const evidenceByKind = {
    registration: registrationEvidence,
    oauth: oauthEvidence,
    network: networkEvidence,
  };
  for (const kind of Object.keys(SOURCE)) {
    const evidence = evidenceByKind[kind];
    if (
      !verifyRecoveryExternalEvidenceIntegrity(evidence, {
        kind,
        expectedSha: deploymentSha,
        expectedTargetFingerprint: targetFingerprint,
      })
    ) {
      throw fail(
        "RECOVERY_EXTERNAL_ACQUISITION_EVIDENCE_INVALID",
        `Invalid ${kind} evidence.`,
      );
    }
  }

  if (!canonicalNetworkDirectDenial(networkEvidence)) {
    throw fail(
      "RECOVERY_EXTERNAL_ACQUISITION_NETWORK_SOURCE_INVALID",
      "Network acquisition must prove one exact canonical direct-denial pair.",
    );
  }

  for (const kind of Object.keys(SOURCE)) {
    const evidence = evidenceByKind[kind];
    const sourceResult = sourceVerification?.[kind];
    if (!isBrandedSourceVerification(kind, sourceResult, evidence)) {
      const code =
        kind === "registration"
          ? "RECOVERY_REGISTRATION_SOURCE_ATTESTATION_UNAVAILABLE"
          : "RECOVERY_EXTERNAL_SOURCE_ATTESTATION_INVALID";
      throw fail(code, `Verified ${kind} source authority is required.`);
    }
  }

  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    expires <= issued ||
    expires - issued > MAX_TTL_MS
  ) {
    throw fail(
      "RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_EXPIRED",
      "Acquisition receipt lifetime is invalid.",
    );
  }

  let signingKey;
  try {
    signingKey = createPrivateKey(privateKey);
  } catch {
    throw fail(
      "RECOVERY_EXTERNAL_ACQUISITION_PRIVATE_KEY_INVALID",
      "Recovery external acquisition private key is invalid.",
    );
  }
  if (signingKey.asymmetricKeyType !== "ed25519") {
    throw fail(
      "RECOVERY_EXTERNAL_ACQUISITION_PRIVATE_KEY_INVALID",
      "Recovery external acquisition private key must be Ed25519.",
    );
  }

  const receipt = {
    contract: RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_CONTRACT,
    environment: "staging",
    deployment_sha: deploymentSha,
    target_fingerprint: targetFingerprint,
    acquisition_run_id: acquisitionRunId,
    issuer,
    key_id: keyId,
    issued_at: issuedAt,
    expires_at: expiresAt,
    observations: Object.fromEntries(
      Object.entries(evidenceByKind).map(([kind, evidence]) => [
        kind,
        {
          observation_id: evidence.source_provenance.observation_id,
          source: SOURCE[kind].source,
          evidence_hash: evidence.evidence_hash,
          source_proof_hash: recoveryExternalSourceProofHash(evidence),
          verified: true,
        },
      ]),
    ),
    secrets_included: false,
  };
  const signature = cryptoSign(
    null,
    Buffer.from(recoveryExternalAcquisitionCanonicalPayload(receipt)),
    signingKey,
  ).toString("base64url");

  return Object.freeze({
    ...receipt,
    signature_b64url: signature,
  });
}
