// Recovery evidence is data, never an authority handle or an arbitrary adapter payload.
const forbidden = /^(?:secret|.*_secret|password|.*_password|token|.*_token|access_token|refresh_token|bearer|bearer_token|api_key|.*_api_key|private_key|.*_private_key|credential|.*_credential|credential_value|client_secret|authorization|authorization_header|.*_authorization)$/i;
export function assertRecoveryData(value, { routing = false } = {}, depth = 0) {
  if (depth > 24) throw Object.assign(new Error('Recovery evidence exceeds maximum depth.'), { code: 'RECOVERY_EVIDENCE_DEPTH_INVALID' });
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw Object.assign(new Error('Recovery evidence must be JSON data.'), { code: 'RECOVERY_EVIDENCE_TYPE_INVALID' });
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.test(key) || (routing && /^(?:repository|repo|workflow|workflow_id|ref|branch|host|hostname|port|path|cwd|command|shell|ssh|credentials|credential)$/i.test(key))) {
      throw Object.assign(new Error('Forbidden field in Recovery evidence.'), { code: 'RECOVERY_EVIDENCE_FIELD_FORBIDDEN' });
    }
    assertRecoveryData(child, { routing }, depth + 1);
  }
}
export function projectRecoveryReceipt(value, allowed, code = 'RECOVERY_RECEIPT_FIELD_FORBIDDEN') {
  assertRecoveryData(value);
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !allowed.includes(key))) {
    throw Object.assign(new Error('Receipt does not match its phase schema.'), { code });
  }
  return Object.fromEntries(allowed.filter(key => Object.hasOwn(value, key)).map(key => [key, structuredClone(value[key])]));
}
export function requireFreshTime(value, nowMs, maximumAgeMs, label) {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(at) || at > nowMs || nowMs - at > maximumAgeMs) {
    throw Object.assign(new Error('Recovery evidence timestamp is invalid or stale.'), { code: label });
  }
  return at;
}
