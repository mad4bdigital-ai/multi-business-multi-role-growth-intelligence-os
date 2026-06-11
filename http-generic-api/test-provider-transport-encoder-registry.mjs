import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registrySource = readFileSync("providerTransportEncoderRegistry.js", "utf8");
const recipeSource = readFileSync("platformResourceRecipeCapability.js", "utf8");
const manifestSource = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const expected of [
  "PROVIDER_TRANSPORT_ENCODER_REGISTRY",
  "google_drive_api.uploadNewFile.multipart_related_json_v1",
  "multipart_related",
  "listProviderTransportEncoders",
  "resolveProviderTransportEncoder",
  "encodeMultipartRelatedJson",
  "buildGoogleDriveMultipartRelatedJsonPayload",
  "provider_transport_encoder_not_found",
  "provider_transport_encoder_secret_key_rejected",
  "transport_encoder_key",
  "secrets_included: false",
]) {
  assert(registrySource.includes(expected), `provider transport encoder registry must include ${expected}`);
}

for (const expected of [
  "buildGoogleDriveMultipartRelatedJsonPayload",
  "buildManifestUploadPayload",
  "transport_encoder",
]) {
  assert(recipeSource.includes(expected), `resource recipe capability must include ${expected}`);
}

assert(
  manifestSource.includes("node test-provider-transport-encoder-registry.mjs"),
  "provider transport encoder registry test must be included in the test manifest"
);

assert(
  !registrySource.includes("Bearer ") && !registrySource.includes("Authorization"),
  "provider transport encoder registry must not handle provider credentials"
);

console.log("provider transport encoder registry source contract passed");
