import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  statusRoutes,
  securityDecision,
  auditEvidence,
  manifest,
  resolver,
] = await Promise.all([
  readFile(new URL("./routes/statusRoutes.js", import.meta.url), "utf8"),
  readFile(new URL("./src/domain/capability/securityDecision.js", import.meta.url), "utf8"),
  readFile(new URL("./auditPayloadEvidence.js", import.meta.url), "utf8"),
  readFile(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8"),
  readFile(new URL("./platformPluginResolver.js", import.meta.url), "utf8"),
]);

for (const expected of [
  "projectComponentReadiness",
  "freshness_status",
  "component_has_no_runtime_observations",
  "component_freshness_${freshnessStatus}",
  "secrets_included: false",
]) {
  assert(statusRoutes.includes(expected), `status readiness projection must include ${expected}`);
}

for (const expected of [
  "createSecurityDecisionTrace",
  "projectSecurityDecisionTrace",
  "deriveSecurityDecisionInvariantMetrics",
  "security_decision_trace.v1",
  "security_decision_metrics.v1",
  "detail_keys",
  "secrets_included: false",
]) {
  assert(securityDecision.includes(expected), `security decision observability must include ${expected}`);
}

for (const expected of [
  "buildAuditEvidenceDigest",
  "tamper_evident",
  "evidence_sha256",
  "previous_evidence_sha256",
  "immutable_fields",
  "secrets_included: false",
]) {
  assert(auditEvidence.includes(expected), `audit evidence controls must include ${expected}`);
}

for (const expected of [
  "persistSecurityDecisionTrace",
  "writeAuditPayloadEvidence",
  "security.decision_trace",
  "decision_trace_persistence",
  "security_decision_trace_persistence.v1",
  "secrets_included: false",
]) {
  assert(resolver.includes(expected), `resolver decision trace persistence must include ${expected}`);
}

for (const expected of [
  "node test-status-component-readiness-freshness.mjs",
  "node test-security-decision-engine.mjs",
  "node test-security-decision-trace-contract.mjs",
  "node test-audit-payload-evidence.mjs",
  "node test-platform-plugin-resolver.mjs",
  "node test-phase10-status-observability-readiness-audit.mjs",
]) {
  assert(manifest.includes(expected), `test manifest must include ${expected}`);
}

console.log("phase10 status observability readiness audit tests passed");
