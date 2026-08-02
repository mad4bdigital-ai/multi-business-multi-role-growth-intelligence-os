export const DEFAULT_MAX_DIAGNOSTIC_CHARS = 12_000;

export function redactDiagnosticOutput(value) {
  return String(value || "")
    .replace(/::add-mask::[^\r\n]*/giu, "::add-mask::[REDACTED]")
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gu, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{16,}\b/gu, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/giu, "Bearer [REDACTED]")
    .replace(/(["']?)(authorization|api[_-]?key|token|secret|password|passwd|private[_-]?key|cookie)\1\s*[:=]\s*(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;]+)/giu, "$1$2$1=[REDACTED]")
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/giu, "$1[REDACTED]@");
}

export function buildDiagnosticStream(value, maxChars = DEFAULT_MAX_DIAGNOSTIC_CHARS) {
  const original = String(value || "");
  const sanitized = redactDiagnosticOutput(original);
  const truncated = sanitized.length > maxChars;
  return Object.freeze({
    tail: truncated ? sanitized.slice(-maxChars) : sanitized,
    truncated,
    original_chars: original.length,
    retained_chars: Math.min(sanitized.length, maxChars)
  });
}
