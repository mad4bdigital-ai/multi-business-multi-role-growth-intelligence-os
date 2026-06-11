import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildGoogleDriveMultipartRelatedJsonPayload,
  encodeMultipartRelatedJson,
  listProviderTransportEncoders,
  resolveProviderTransportEncoder,
} from "./providerTransportEncoderRegistry.js";

const registrySource = readFileSync("providerTransportEncoderRegistry.js", "utf8");
const resourceRecipeSource = readFileSync("platformResourceRecipeCapability.js", "utf8");

const encoders = listProviderTransportEncoders({ parent_action_key: "google_drive_api", endpoint_key: "uploadNewFile" });
assert.equal(encoders.length, 1, "google Drive upload encoder should be discoverable");
assert.equal(encoders[0].encoder_key, "google_drive_api.uploadNewFile.multipart_related_json_v1");
assert.equal(encoders[0].transport_mode, "multipart_related");
assert.equal(encoders[0].secrets_included, false);

const resolved = resolveProviderTransportEncoder({ parent_action_key: "google_drive_api", endpoint_key: "uploadNewFile" });
assert.equal(resolved.ok, true);
assert.equal(resolved.encoder.requires_same_cycle_readback, true);

const encoded = encodeMultipartRelatedJson({
  metadata: { name: "manifest.json", mimeType: "application/json", parents: ["folder_123"] },
  media_body: { ok: true, schema_version: "artifact_export_manifest.v1", secrets_included: false },
  boundary_seed: "manifest.json:test",
});
assert.equal(encoded.ok, true);
assert.match(encoded.content_type, /^multipart\/related; boundary=manifest_boundary_/);
assert.match(encoded.body, /Content-Type: application\/json; charset=UTF-8/);
assert.match(encoded.body, /artifact_export_manifest\.v1/);
assert.equal(encoded.secrets_included, false);

const payload = buildGoogleDriveMultipartRelatedJsonPayload({
  filename: "manifest.json",
  parent_folder_id: "folder_123",
  media_body: { ok: true, secrets_included: false },
  content_sha256: "abc123",
});
assert.equal(payload.parent_action_key, "google_drive_api");
assert.equal(payload.endpoint_key, "uploadNewFile");
assert.equal(payload.transport_encoder_key, "google_drive_api.uploadNewFile.multipart_related_json_v1");
assert.equal(payload.raw_body_mode, "multipart_related");
assert.equal(payload.readback.required, true);
assert.equal(payload.secrets_included, false);
assert.equal(payload.transport_encoder.secrets_included, false);

assert.throws(() => encodeMultipartRelatedJson({ metadata: { access_token: "nope" }, media_body: {} }), /sensitive field/);

for (const expected of [
  "PROVIDER_TRANSPORT_ENCODER_REGISTRY",
  "google_drive_api.uploadNewFile.multipart_related_json_v1",
  "resolveProviderTransportEncoder",
  "provider_transport_encoder_secret_key_rejected",
  "secrets_included: false",
]) {
  assert(registrySource.includes(expected), `registry source must include ${expected}`);
}

for (const expected of [
  "buildGoogleDriveMultipartRelatedJsonPayload",
  "buildManifestUploadPayload",
]) {
  assert(resourceRecipeSource.includes(expected), `resource recipe capability must use encoder registry: ${expected}`);
}

assert.throws(() => encodeMultipartRelatedJson({ metadata: { client_secret: "nope" }, media_body: {} }), /sensitive field/);
assert.throws(() => encodeMultipartRelatedJson({ metadata: {}, media_body: { refresh_token: "nope" } }), /sensitive field/);
assert.throws(() => encodeMultipartRelatedJson({ metadata: { private_key: "nope" }, media_body: {} }), /sensitive field/);

console.log("provider transport encoder registry contract passed");
