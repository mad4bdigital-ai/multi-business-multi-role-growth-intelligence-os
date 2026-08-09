import { createHash } from "node:crypto";
import { buildCapabilityDriftSignals } from "./capabilityDriftSignalProjection.js";

export const CAPABILITY_DRIFT_SOURCE = "v_platform_capability_gaps";

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function text(value = "", max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

export function buildCapabilityDriftAlertInputs(rows = [], {
  subject = {},
  persistenceMode = false,
} = {}) {
  const principalScope = subject.is_admin ? "admin" : "tenant";
  const tenantId = subject.tenant_id || null;
  const inputs = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const [signal] = buildCapabilityDriftSignals([row], {
      principalScope,
      tenantId,
      generatedAt: row.observed_at || new Date(),
    });
    if (!signal) continue;
    const capabilityKey = text(row.capability_key, 255);
    const gapKey = text(row.gap_key, 128).toLowerCase() || "capability_gap";
    const alertKey = `capability-drift-alert.${sha256(`${capabilityKey}|${gapKey}`)}`;
    const displayName = text(row.display_name || capabilityKey, 191) || "Capability";
    inputs.push({
      alertKey,
      sourceType: CAPABILITY_DRIFT_SOURCE,
      sourceRef: signal.source_ref,
      sourceRecordId: alertKey,
      tenantId: persistenceMode ? null : (subject.is_admin ? null : tenantId),
      category: "capability_drift",
      severity: signal.severity,
      title: `${displayName} capability readiness requires attention`,
      summary: signal.safe_customer_summary,
      reasonCode: `capability_drift_${gapKey}`,
      verificationState: "verified",
      evidenceType: "platform_capability_gap",
      evidenceRef: signal.source_ref,
      evidence: {
        tenant_visible: true,
        capability_key: capabilityKey,
        gap_key: gapKey,
        source_domain: signal.source_domain,
        recommended_next_action: signal.recommended_next_action,
        repair_class: signal.auto_repair.repair_class,
        auto_repair_eligible: false,
        execution_linked: false,
        ...(signal.admin_evidence ? { admin_evidence: signal.admin_evidence } : {}),
      },
      occurrenceCount: 1,
      firstSeenAt: signal.last_seen_at,
      lastSeenAt: signal.last_seen_at,
      recommendedActionKey: signal.recommended_next_action,
      requiresConfirmation: false,
    });
  }
  return inputs;
}
