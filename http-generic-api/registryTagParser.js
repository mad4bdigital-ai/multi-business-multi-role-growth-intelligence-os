export function normalizeRegistryTags(value) {
  const normalize = (items) => [...new Set(items
    .map((item) => String(item ?? "").trim())
    .filter(Boolean))];

  if (Array.isArray(value)) return normalize(value);

  const text = String(value ?? "").trim();
  if (!text) return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return normalize(parsed);
    } catch {
      // Fall through to the legacy CSV representation.
    }
  }

  return normalize(text.split(","));
}
