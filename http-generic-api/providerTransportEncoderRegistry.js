import { createHash } from "node:crypto";

function asString(value = "") {
  return String(value || "").trim();
}

function stableJson(value = {}) {
  return JSON.stringify(value ?? {}, null, 2);
}

function sha256Hex(value = "") {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function boolValue(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export const PROVIDER_TRANSPORT_ENCODER_REGISTRY = [
  {
    encoder_key: "google_drive_api.uploadNewFile.multipart_related_json_v1",
    provider_key: "google_drive_api",
    parent_action_key: "google_drive_api",
    endpoint_key: "uploadNewFile",
    transport_mode: "multipart_related",
    content_type: "multipart/related",
    media_type: "application/json",
    status: "active",
    mutating: true,
    requires_same_cycle_readback: true,
    supported_payload_shape: "metadata_plus_json_media_body",
    policy: {
      boundary_prefix: "manifest_boundary",
      supports_all_drives: true,
      forbids_secret_fields: true,
      overwrite_allowed: false,
    },
    secrets_included: false,
  },
];

export function listProviderTransportEncoders(filters = {}) {
  const parentActionKey = asString(filters.parent_action_key || filters.provider_key);
  const endpointKey = asString(filters.endpoint_key);
  const status = asString(filters.status || "active");
  return PROVIDER_TRANSPORT_ENCODER_REGISTRY.filter((encoder) => {
    if (status && encoder.status !== status) return false;
    if (parentActionKey && encoder.parent_action_key !== parentActionKey && encoder.provider_key !== parentActionKey) return false;
    if (endpointKey && encoder.endpoint_key !== endpointKey) return false;
    return true;
  }).map((encoder) => ({ ...encoder, secrets_included: false }));
}

export function resolveProviderTransportEncoder({ parent_action_key, provider_key, endpoint_key, encoder_key } = {}) {
  const requestedEncoderKey = asString(encoder_key);
  const parentActionKey = asString(parent_action_key || provider_key);
  const endpointKey = asString(endpoint_key);
  const encoder = PROVIDER_TRANSPORT_ENCODER_REGISTRY.find((candidate) => {
    if (requestedEncoderKey) return candidate.encoder_key === requestedEncoderKey;
    return candidate.status === "active" && candidate.parent_action_key === parentActionKey && candidate.endpoint_key === endpointKey;
  });
  if (!encoder) {
    return {
      ok: false,
      reason_code: "provider_transport_encoder_not_found",
      parent_action_key: parentActionKey || null,
      endpoint_key: endpointKey || null,
      encoder_key: requestedEncoderKey || null,
      secrets_included: false,
    };
  }
  return { ok: true, encoder: { ...encoder, secrets_included: false }, secrets_included: false };
}

function assertNoSecretKeys(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (/secret|token|api[_-]?key|private[_-]?key|ciphertext|password|refresh[_-]?token|access[_-]?token/i.test(key)) {
      const err = new Error(`Provider transport encoder refused sensitive field at ${path}.${key}`);
      err.code = "provider_transport_encoder_secret_key_rejected";
      throw err;
    }
    assertNoSecretKeys(nested, `${path}.${key}`);
  }
}

export function encodeMultipartRelatedJson({ metadata = {}, media_body = {}, media_type = "application/json", boundary_seed = "" } = {}) {
  assertNoSecretKeys(metadata, "metadata");
  assertNoSecretKeys(media_body, "media_body");
  const mediaJson = typeof media_body === "string" ? media_body : stableJson(media_body);
  const boundary = `${PROVIDER_TRANSPORT_ENCODER_REGISTRY[0].policy.boundary_prefix}_${sha256Hex(`${boundary_seed}:${mediaJson}`).slice(0, 16)}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${media_type}; charset=UTF-8`,
    "",
    mediaJson,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return {
    ok: true,
    boundary,
    body,
    content_type: `multipart/related; boundary=${boundary}`,
    content_sha256: sha256Hex(mediaJson),
    content_size_bytes: Buffer.byteLength(mediaJson, "utf8"),
    secrets_included: false,
  };
}

export function buildGoogleDriveMultipartRelatedJsonPayload({
  filename = "",
  mime_type = "application/json",
  parent_folder_id = "",
  media_body = {},
  content_sha256 = "",
  credential_scope = "platform",
  connection_id,
  tenant_id,
  user_id,
  allow_platform_fallback = true,
  query = {},
  timeout_seconds = 25,
} = {}) {
  const encoderResolution = resolveProviderTransportEncoder({
    parent_action_key: "google_drive_api",
    endpoint_key: "uploadNewFile",
    encoder_key: "google_drive_api.uploadNewFile.multipart_related_json_v1",
  });
  if (!encoderResolution.ok) return encoderResolution;

  const metadata = {
    name: asString(filename),
    mimeType: mime_type || "application/json",
    ...(asString(parent_folder_id) ? { parents: [asString(parent_folder_id)] } : {}),
  };
  const encoded = encodeMultipartRelatedJson({
    metadata,
    media_body,
    media_type: mime_type || "application/json",
    boundary_seed: `${filename}:${content_sha256}`,
  });

  return {
    parent_action_key: "google_drive_api",
    endpoint_key: "uploadNewFile",
    transport_encoder_key: encoderResolution.encoder.encoder_key,
    credential_scope: credential_scope || "platform",
    connection_id,
    tenant_id,
    user_id,
    allow_platform_fallback: boolValue(allow_platform_fallback, true),
    timeout_seconds,
    query: {
      uploadType: "multipart",
      fields: "id,name,mimeType,parents,size,createdTime,modifiedTime,webViewLink",
      supportsAllDrives: true,
      ...(query || {}),
    },
    headers: {
      "Content-Type": encoded.content_type,
    },
    raw_body_mode: "multipart_related",
    body: encoded.body,
    readback: { required: true, mode: "same_cycle_metadata_readback" },
    transport_encoder: {
      encoder_key: encoderResolution.encoder.encoder_key,
      transport_mode: encoderResolution.encoder.transport_mode,
      content_sha256: encoded.content_sha256,
      content_size_bytes: encoded.content_size_bytes,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
