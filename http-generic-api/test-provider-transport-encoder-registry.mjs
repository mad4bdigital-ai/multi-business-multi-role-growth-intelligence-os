import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildGoogleDriveMultipartRelatedJsonPayload,
  encodeMultipartRelatedJson,
  listProviderTransportEncoders,
  resolveProviderTransportEncoder,
} from "./providerTransportEncoderRegistry.js";

const manifestSource = readFileSync("scripts/test-manifest.mjs", "utf8");
assert(
  manifestSource.includes("node test-provider-transport-encoder-registry.mjs"),
  "provider transport encoder registry test must be included in the test manifest"
);

const encoders = listProviderTransportEncoders({ parent_action_key: "google_drive_api", endpoint_key: "uploadNewFile" });
assert.equal(encoders.length, 1, "google Drive upload encoder should be discoverable");
assert.equal(encoders[0].encoder_key, "google_drive_api.uploadNewFile.multipart_related_json_v1");
assert.equal(encoders[0].provider_key, "google_drive_api");
assert.equal(encoders[0].transport_mode, "multipart_related");
assert.equal(encoders[0].requires_same_cycle_readback, true);
assert.equal(encoders[0].secrets_included, false);

const resolved = resolveProviderTransportEncoder({ parent_action_key: "google_drive_api", endpoint_key: "uploadNewFile" });
assert.equal(resolved.ok, true);
assert.equal(resolved.encoder.encoder_key, "google_drive_api.uploadNewFile.multipart_related_json_v1");
assert.equal(resolved.secrets_included, false);

const missing = resolveProviderTransportEncoder({ parent_action_key: "google_drive_api", endpoint_key: "missingEndpoint" });
assert.equal(missing.ok, false);
assert.equal(missing.reason_code, "provider_transport_encoder_not_found");
assert.equal(missing.secrets_included, false);

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
assert.ok(encoded.content_size_bytes > 0);

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
assert.equal(payload.query.uploadType, "multipart");
assert.equal(payload.query.supportsAllDrives, true);
assert.equal(payload.readback.required, true);
assert.equal(payload.secrets_included, false);
assert.equal(payload.transport_encoder.secrets_included, false);
assert.match(payload.headers["Content-Type"], /^multipart\/related; boundary=manifest_boundary_/);

for (const badPayload of [
  { metadata: { access_token: "nope" }, media_body: {} },
  { metadata: { client_secret: "nope" }, media_body: {} },
  { metadata: {}, media_body: { refresh_token: "nope" } },
  { metadata: { private_key: "nope" }, media_body: {} },
]) {
  assert.throws(() => encodeMultipartRelatedJson(badPayload), /sensitive field/);
}

console.log("provider transport encoder registry contract passed");
